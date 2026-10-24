import {sendMail,mailConfigured} from './mail.mjs';
export {mailConfigured} from './mail.mjs';
import {buildPushPayload} from '@block65/webcrypto-web-push';
export const notificationSchema=[
 `CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,push_enabled INTEGER NOT NULL DEFAULT 0,email_enabled INTEGER NOT NULL DEFAULT 0,links INTEGER NOT NULL DEFAULT 1,shopping INTEGER NOT NULL DEFAULT 1,releases INTEGER NOT NULL DEFAULT 1,ignore_own INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS notification_config(key TEXT PRIMARY KEY,value TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint TEXT NOT NULL UNIQUE,subscription TEXT NOT NULL,device_name TEXT NOT NULL,created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id)`,
 `CREATE TABLE IF NOT EXISTS notification_events(id TEXT PRIMARY KEY,event_key TEXT UNIQUE,category TEXT NOT NULL CHECK(category IN ('links','shopping','releases')),actor_id TEXT REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,url TEXT NOT NULL,created_at INTEGER NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS notification_events_time ON notification_events(created_at)`,
 `CREATE TABLE IF NOT EXISTS notification_reads(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_read_at INTEGER NOT NULL DEFAULT 0)`,
 `CREATE TABLE IF NOT EXISTS notification_jobs(event_id TEXT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,channel TEXT NOT NULL CHECK(channel IN ('push','email')),target_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,PRIMARY KEY(event_id,user_id,channel,target_id))`,
 `CREATE INDEX IF NOT EXISTS notification_jobs_pending ON notification_jobs(status,available_at,lease_until)`
];
const schemaReady=new WeakMap();
export async function ensureNotifications(env){if(!schemaReady.has(env.DB))schemaReady.set(env.DB,env.DB.batch(notificationSchema.map(s=>env.DB.prepare(s))).catch(e=>{schemaReady.delete(env.DB);throw e;}));await schemaReady.get(env.DB);}
const q=(env,sql,...v)=>env.DB.prepare(sql).bind(...v);
const one=(env,sql,...v)=>q(env,sql,...v).first();
const all=async(env,sql,...v)=>(await q(env,sql,...v).all()).results;
const run=(env,sql,...v)=>q(env,sql,...v).run();
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const from64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
export async function vapidKeys(env){
 await ensureNotifications(env);let stored=await one(env,"SELECT value FROM notification_config WHERE key='vapid'");
 if(!stored){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey);const keys={publicKey:b64(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKey:privateJwk.d};await run(env,"INSERT OR IGNORE INTO notification_config(key,value) VALUES('vapid',?)",JSON.stringify(keys));stored=await one(env,"SELECT value FROM notification_config WHERE key='vapid'");}
 return{...JSON.parse(stored.value),subject:env.APP_ORIGIN};
}
async function preferences(env,userId){await run(env,'INSERT OR IGNORE INTO notification_preferences(user_id,updated_at) VALUES(?,?)',userId,Date.now());return one(env,'SELECT * FROM notification_preferences WHERE user_id=?',userId);}
const prefsPublic=p=>Object.fromEntries(['push_enabled','email_enabled','links','shopping','releases','ignore_own'].map(k=>[k,!!p[k]]));
function safeUrl(url){return typeof url==='string'&&/^\/(?:#(?:shopping=[a-zA-Z0-9-]+|notifications))?$/.test(url)?url:'/';}
export function validateSubscription(subscription){
 if(!subscription||typeof subscription.endpoint!=='string'||subscription.endpoint.length>4096)throw Error('SUBSCRIPTION_INVALID');
 let endpoint;try{endpoint=new URL(subscription.endpoint);}catch{throw Error('SUBSCRIPTION_INVALID');}
 const host=endpoint.hostname;
 const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host.endsWith('.notify.windows.com')||host==='wns.windows.com'||host.endsWith('.push.apple.com');
 if(endpoint.protocol!=='https:'||!allowed||endpoint.username||endpoint.password||endpoint.port&&endpoint.port!=='443'||endpoint.hash)throw Error('SUBSCRIPTION_INVALID');
 try{const pub=from64(subscription.keys?.p256dh||''),auth=from64(subscription.keys?.auth||'');if(pub.length!==65||pub[0]!==4||auth.length!==16)throw Error();}catch{throw Error('SUBSCRIPTION_INVALID');}
 return{endpoint:endpoint.href,expirationTime:null,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
}
async function sendPush(env,subscription,data){
 const keys=await vapidKeys(env);const payload=await buildPushPayload({data:JSON.stringify(data),options:{ttl:3600,urgency:'normal'}},subscription,keys);
 return fetch(subscription.endpoint,{...payload,redirect:'error',signal:AbortSignal.timeout(8000)});
}
async function sendEmail(env,to,event,key){return sendMail(env,{to,id:key,subject:`The Mattioli’s Hub · ${event.title}`,text:`${event.body}\n\nApri l’hub:\n${env.APP_ORIGIN}${safeUrl(event.url)}\n\nPuoi gestire le preferenze notifiche nel tuo account:\n${env.APP_ORIGIN}/#notifications`});}
export async function recordEvent(env,{id=crypto.randomUUID(),key=null,category,actorId=null,title,body,url='/'}){
 await ensureNotifications(env);if(!['links','shopping','releases'].includes(category))throw Error('EVENT_CATEGORY');
 const t=Date.now();
 const insertion=await run(env,'INSERT OR IGNORE INTO notification_events(id,event_key,category,actor_id,title,body,url,created_at) VALUES(?,?,?,?,?,?,?,?)',id,key,category,actorId,title.slice(0,100),body.slice(0,500),safeUrl(url),t);
 if(!insertion.meta.changes)return null;
 // Preferences are opt-in for outbound channels. Column names come only from the validated enum.
 const condition=`u.active=1 AND p.${category}=1 AND (? IS NULL OR p.ignore_own=0 OR p.user_id<>?)`;
 await env.DB.batch([
  q(env,`INSERT OR IGNORE INTO notification_jobs(event_id,user_id,channel,target_id,available_at) SELECT ?,p.user_id,'push',s.id,? FROM notification_preferences p JOIN users u ON u.id=p.user_id JOIN push_subscriptions s ON s.user_id=p.user_id WHERE p.push_enabled=1 AND ${condition}`,id,t,actorId,actorId),
  q(env,`INSERT OR IGNORE INTO notification_jobs(event_id,user_id,channel,target_id,available_at) SELECT ?,p.user_id,'email','email',? FROM notification_preferences p JOIN users u ON u.id=p.user_id WHERE p.email_enabled=1 AND ${condition}`,id,t,actorId,actorId)
 ]);return id;
}
export async function recordActivity(req,env,response,user){
 const path=new URL(req.url).pathname,method=req.method;
 if(!response.ok||method==='GET'||!user)return;
 const b=await req.json().catch(()=>({}));let title,body,url='/',category;
 if(path.startsWith('/api/shopping/')){
  category='shopping';let listId=path.match(/^\/api\/shopping\/lists\/([^/]+)/)?.[1];
  const itemId=path.match(/^\/api\/shopping\/items\/([^/]+)/)?.[1];const item=itemId?await one(env,'SELECT * FROM shopping_items WHERE id=?',itemId):null;
  if(item)listId=item.list_id;
  if(path==='/api/shopping/lists'&&method==='POST')listId=(await response.clone().json()).id;
  const list=listId?await one(env,'SELECT title FROM shopping_lists WHERE id=?',listId):null;
  const name=list?.title||b.title||'Lista della spesa';title=name;url=listId?'/#shopping='+listId:'/';
  if(path==='/api/shopping/lists')body=`${user.name} ha creato la lista “${name}”.`;
  else if(path.endsWith('/reuse'))body=`${user.name} ha preparato “${name}” per una nuova spesa.`;
  else if(path.endsWith('/items')&&method==='POST')body=`${user.name} ha aggiunto “${b.name}” a “${name}”.`;
  else if(path.endsWith('/move'))body=`${user.name} ha riordinato “${name}”.`;
  else if(path.endsWith('/restore'))body=`${user.name} ha ripristinato “${item?.name||'un prodotto'}” in “${name}”.`;
  else if(item&&method==='DELETE')body=`${user.name} ha rimosso “${item.name}” da “${name}”.`;
  else if(item&&typeof b.checked==='boolean')body=`${user.name} ha ${b.checked?'spuntato':'rimesso da acquistare'} “${item.name}” in “${name}”.`;
  else if(typeof b.archived==='boolean')body=`${user.name} ha ${b.archived?'archiviato':'ripristinato'} la lista “${name}”.`;
  else body=`${user.name} ha aggiornato ${item?'“'+item.name+'” in ':''}“${name}”.`;
 }else if(path==='/api/covers/family'){category='links';title='La foto della famiglia';body=`${user.name} ha ${method==='DELETE'?'rimosso':'aggiornato'} la copertina della famiglia.`;
 }else if(/^\/api\/admin\/(links|categories)(?:\/|$)/.test(path)){
  category='links';title=path.includes('/categories')?'Categorie aggiornate':'Link della famiglia';
  body=`${user.name} ha ${method==='POST'?'aggiunto':method==='DELETE'?'rimosso':'aggiornato'} ${path.includes('/categories')?'una categoria':'un link'}${b.title||b.name?': “'+(b.title||b.name)+'”':''}.`;
 }else return;
 return recordEvent(env,{category,actorId:user.id,title,body,url});
}
export async function recordRelease(env){
 const version=env.CF_VERSION_METADATA?.id;if(!version)return;await ensureNotifications(env);
 // A stable event key makes overlapping requests and scheduled runs idempotent.
 await recordEvent(env,{key:'release:'+version,category:'releases',title:'Novità dell’hub',body:'È disponibile una nuova versione di The Mattioli’s Hub.',url:'/#notifications'});
}
const sending=new WeakMap();
export async function dispatchNotifications(env){
 if(sending.has(env.DB))return sending.get(env.DB);
 const promise=dispatch(env).finally(()=>sending.delete(env.DB));sending.set(env.DB,promise);return promise;
}
async function dispatch(env){
 await ensureNotifications(env);const t=Date.now();
 const jobs=await all(env,"SELECT * FROM notification_jobs WHERE ((status='pending' AND available_at<=?) OR (status='processing' AND lease_until<?)) AND (channel='push' OR ?=1) ORDER BY available_at LIMIT 10",t,t,mailConfigured(env)?1:0);
 async function deliver(job){
  if(job.channel==='email'&&!mailConfigured(env))return;
  const claimed=await one(env,"UPDATE notification_jobs SET status='processing',lease_until=?,attempts=attempts+1 WHERE event_id=? AND user_id=? AND channel=? AND target_id=? AND ((status='pending' AND available_at<=?) OR (status='processing' AND lease_until<?)) RETURNING attempts",Date.now()+120000,job.event_id,job.user_id,job.channel,job.target_id,t,t);if(!claimed)return;
  const ids=[job.event_id,job.user_id,job.channel,job.target_id];
  async function finish(status,error=null,next=0){await run(env,'UPDATE notification_jobs SET status=?,last_error=?,available_at=?,lease_until=0 WHERE event_id=? AND user_id=? AND channel=? AND target_id=?',status,error,next,...ids);}
  try{
   const user=await one(env,'SELECT u.*,p.push_enabled,p.email_enabled,p.links,p.shopping,p.releases,p.ignore_own FROM users u JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=?',job.user_id);
   const event=await one(env,'SELECT * FROM notification_events WHERE id=?',job.event_id);
   if(!user?.active||!event||!user[event.category]||!user[job.channel+'_enabled']||(user.ignore_own&&event.actor_id===user.id)||event.created_at<Date.now()-7*86400000){await finish('skipped');return;}
   let res;
   if(job.channel==='push'){
    const sub=await one(env,'SELECT * FROM push_subscriptions WHERE id=? AND user_id=?',job.target_id,user.id);if(!sub){await finish('skipped');return;}
    res=await sendPush(env,JSON.parse(sub.subscription),{id:event.id,title:'The Mattioli’s Hub',body:event.body,url:safeUrl(event.url),recipient:user.id});
    if([404,410].includes(res.status)){await run(env,'DELETE FROM push_subscriptions WHERE id=?',sub.id);await finish('skipped','subscription_expired');return;}
   }else res=await sendEmail(env,user.email,event,'hub-'+event.id+'-'+user.id);
   if(res.ok){await finish('sent');return;}
   const permanent=res.status>=400&&res.status<500&&![408,429].includes(res.status);
   const final=permanent||claimed.attempts>=5;
   const retrySeconds=Number(res.headers.get('Retry-After')||0);const delay=Math.min(86400000,Math.max(Math.min(3600000,30000*4**(claimed.attempts-1)),Number.isFinite(retrySeconds)?retrySeconds*1000:0));
   await finish(final?'failed':'pending','provider_'+res.status,Date.now()+delay);
  }catch{await finish(claimed.attempts>=5?'failed':'pending','delivery_error',Date.now()+Math.min(3600000,30000*4**(claimed.attempts-1)));}
 }
 for(let i=0;i<jobs.length;i+=5)await Promise.all(jobs.slice(i,i+5).map(deliver));
 await run(env,'DELETE FROM notification_events WHERE created_at<?',Date.now()-30*86400000);
 await run(env,"INSERT INTO notification_config(key,value) VALUES('last_dispatch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify({at:Date.now(),processed:jobs.length}));
}
export async function notificationsRequest(req,env,user,{body,json,fail,rate}){
 await ensureNotifications(env);const path=new URL(req.url).pathname,method=req.method;
 const p=await preferences(env,user.id);
 if(path==='/api/notifications/preferences'&&method==='GET'){
  const keys=await vapidKeys(env),devices=await all(env,'SELECT id,device_name,created_at,last_seen FROM push_subscriptions WHERE user_id=? ORDER BY last_seen DESC',user.id);
  const failures=await one(env,"SELECT COUNT(*) n FROM notification_jobs WHERE user_id=? AND status='failed' AND available_at>?",user.id,Date.now()-7*86400000);
  return json({preferences:prefsPublic(p),devices,publicKey:keys.publicKey,email:user.email,mailConfigured:mailConfigured(env),failedDeliveries:failures?.n||0});
 }
 if(path==='/api/notifications/preferences'&&method==='PATCH'){
  const b=await body(req),names=['push_enabled','email_enabled','links','shopping','releases','ignore_own'];for(const name of names)if(typeof b[name]!=='boolean')fail(400,'Preferenze non valide.');
  await run(env,'UPDATE notification_preferences SET push_enabled=?,email_enabled=?,links=?,shopping=?,releases=?,ignore_own=?,updated_at=? WHERE user_id=?',...names.map(k=>b[k]?1:0),Date.now(),user.id);return json({ok:true});
 }
 if(path==='/api/notifications/subscriptions'&&method==='POST'){
  const b=await body(req);await rate(env,'subscribe:'+user.id,20,3600);let sub;try{sub=validateSubscription(b.subscription);}catch{fail(400,'Dispositivo push non valido o non supportato.');}
  const id=await sha(sub.endpoint),name=typeof b.deviceName==='string'?b.deviceName.trim().slice(0,80):'Dispositivo';const t=Date.now();
  await env.DB.batch([q(env,'INSERT INTO push_subscriptions(id,user_id,endpoint,subscription,device_name,created_at,last_seen) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription,device_name=excluded.device_name,last_seen=excluded.last_seen',id,user.id,sub.endpoint,JSON.stringify(sub),name||'Dispositivo',t,t),q(env,'UPDATE notification_preferences SET push_enabled=1,updated_at=? WHERE user_id=?',t,user.id)]);
  return json({id},201);
 }
 const subPath=path.match(/^\/api\/notifications\/subscriptions\/([a-f0-9]{64})$/);
 if(subPath&&method==='DELETE'){await run(env,'DELETE FROM push_subscriptions WHERE id=? AND user_id=?',subPath[1],user.id);return json({ok:true});}
 if(path==='/api/notifications/test'&&method==='POST'){
  await rate(env,'notification-test:'+user.id,6,3600);const b=await body(req),event={id:crypto.randomUUID(),title:'Notifica di prova',body:'Le notifiche di The Mattioli’s Hub sono pronte. Questo è un messaggio di prova.',url:'/#notifications'};
  if(b.channel==='email'){
   if(!mailConfigured(env))fail(503,'Le email non sono ancora configurate dall’amministratore. La tua preferenza è comunque salvata.');
   const res=await sendEmail(env,user.email,event,'hub-test-'+event.id);if(!res.ok)fail(502,'Il servizio email non ha accettato l’invio. Contatta l’amministratore.');return json({message:'Email di prova inviata. Controlla anche la cartella Spam.'});
  }
  if(b.channel!=='push')fail(400,'Canale non valido.');
  const sub=await one(env,'SELECT * FROM push_subscriptions WHERE id=? AND user_id=?',b.subscriptionId||'',user.id);if(!sub)fail(404,'Attiva prima questo dispositivo.');
  const res=await sendPush(env,JSON.parse(sub.subscription),{...event,recipient:user.id,title:'The Mattioli’s Hub'});
  if([404,410].includes(res.status)){await run(env,'DELETE FROM push_subscriptions WHERE id=?',sub.id);fail(410,'Iscrizione scaduta. Riattiva le notifiche su questo dispositivo.');}
  if(!res.ok)fail(502,'Il servizio push non ha accettato l’invio. Riprova più tardi.');return json({message:'Notifica di prova inviata al dispositivo.'});
 }
 if(path==='/api/notifications'&&method==='GET'){
  const filter=`(?=1 AND e.category='links' OR ?=1 AND e.category='shopping' OR ?=1 AND e.category='releases') AND (?=0 OR e.actor_id IS NULL OR e.actor_id<>?) AND e.created_at>=?`;
  const args=[p.links,p.shopping,p.releases,p.ignore_own,user.id,user.created_at*1000];
  const read=await one(env,'SELECT last_read_at FROM notification_reads WHERE user_id=?',user.id),since=read?.last_read_at||0;
  const events=await all(env,`SELECT e.id,e.category,e.title,e.body,e.url,e.created_at FROM notification_events e WHERE ${filter} ORDER BY e.created_at DESC,e.id DESC LIMIT 50`,...args);
  const unread=await one(env,`SELECT COUNT(*) n FROM notification_events e WHERE ${filter} AND e.created_at>?`,...args,since);
  return json({events,unread:unread.n,lastReadAt:since,readThrough:Date.now()});
 }
 if(path==='/api/notifications/read'&&method==='POST'){
  const b=await body(req);if(!Number.isSafeInteger(b.through)||b.through<0||b.through>Date.now())fail(400,'Richiesta non valida.');
  await run(env,'INSERT INTO notification_reads(user_id,last_read_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET last_read_at=MAX(last_read_at,excluded.last_read_at)',user.id,b.through);return json({ok:true});
 }
 fail(404,'Risorsa non trovata.');
}
