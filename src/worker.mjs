import {notificationsRequest,recordActivity,recordRelease,dispatchNotifications} from './notifications.mjs';
import {shoppingRequest} from './shopping.mjs';
const encoder = new TextEncoder();
const SESSION_TTL = 60 * 60 * 12;
const GENERIC_RESET = 'Se l’indirizzo è associato a un account attivo, riceverai un link per scegliere una nuova password.';
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const now = () => Math.floor(Date.now()/1000);
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n=>n.toString(16).padStart(2,'0')).join('');
export async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),n=>n.toString(16).padStart(2,'0')).join(''); }
export async function hashPassword(password) {
 const salt=random();
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:100000,hash:'SHA-256'},key,256);
 return `pbkdf2-sha256$100000$${salt}$${Array.from(new Uint8Array(bits),n=>n.toString(16).padStart(2,'0')).join('')}`;
}
export async function verifyPassword(password, stored) {
 const [,iterations,salt,expected]=(stored||'').split('$');
 if(!salt||!expected||iterations!=='100000') return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:encoder.encode(salt),iterations:Number(iterations),hash:'SHA-256'},key,256);
 const actual=Array.from(new Uint8Array(bits),n=>n.toString(16).padStart(2,'0')).join('');
 let difference=actual.length^expected.length; for(let i=0;i<actual.length;i++) difference|=actual.charCodeAt(i)^expected.charCodeAt(i);
 return difference===0;
}
const text=(value,max=200)=>{ if(typeof value!=='string'||!value.trim()||value.trim().length>max) fail(400,'Controlla i campi obbligatori e la loro lunghezza.'); return value.trim(); };
const emailOf=value=>{const v=text(value,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail(400,'Inserisci un indirizzo email valido.');return v;};
const passwordOf=v=>{if(typeof v!=='string'||v.length===0)fail(400,'Inserisci una password.');return v;};
const roleOf=v=>{if(!['admin','user'].includes(v))fail(400,'Ruolo non valido.');return v;};
const safeUser=u=>({id:u.id,email:u.email,name:u.name,role:u.role,active:!!u.active,pending:!u.password});
const statement=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const first=(env,sql,...args)=>statement(env,sql,...args).first();
const run=(env,sql,...args)=>statement(env,sql,...args).run();
const all=async(env,sql,...args)=>(await statement(env,sql,...args).all()).results;
function json(data,status=200,headers={}) {return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});}
function cookieName(env){return env.LOCAL_DEV==='true'?'punto_dev':'__Host-punto';}
function cookie(env,value,age=SESSION_TTL){return `${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${env.LOCAL_DEV==='true'?'':'; Secure'}`;}
async function body(req){
 if(!req.headers.get('content-type')?.includes('application/json'))fail(415,'Formato della richiesta non supportato.');
 if(Number(req.headers.get('content-length'))>32768)fail(413,'Richiesta troppo grande.');
 const reader=req.body?.getReader(),chunks=[];let size=0;
 if(reader){for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();fail(413,'Richiesta troppo grande.');}chunks.push(value);}}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Richiesta non valida.');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Richiesta non valida.');return value;
}
function originCheck(req,env){const origin=req.headers.get('origin');if(!env.APP_ORIGIN||origin!==env.APP_ORIGIN||new URL(req.url).origin!==env.APP_ORIGIN)fail(403,'Origine della richiesta non autorizzata.');}
async function rate(env,key,limit,seconds){const k=await digest(key);const t=now();const row=await first(env,`INSERT INTO rate_limits(key,attempts,until_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN until_at<=? THEN 1 ELSE attempts+1 END,until_at=CASE WHEN until_at<=? THEN excluded.until_at ELSE until_at END RETURNING attempts`,k,t+seconds,t,t);if(row.attempts>limit)fail(429,'Troppi tentativi. Riprova più tardi.');}
async function getSession(req,env){const token=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName(env)+'='))?.split('=')[1];if(!token)return null;return first(env,'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires_at>? AND u.active=1',await digest(token),now());}
async function startSession(env,user){const token=random();await env.DB.batch([statement(env,'DELETE FROM sessions WHERE expires_at<=?',now()),statement(env,'INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)',await digest(token),user.id,now()+SESSION_TTL)]);return json({user:safeUser(user)},200,{'Set-Cookie':cookie(env,token)});}
function mailReady(env){return !!(env.RESEND_API_KEY&&env.MAIL_FROM&&!env.MAIL_FROM.includes('INSERIRE'));}
async function sendReset(env,email,url){const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject:'The Mattioli’s Hub · Reimposta la password',text:`Hai richiesto una nuova password per The Mattioli’s Hub.\n\nApri questo link entro 30 minuti:\n${url}\n\nIl link è utilizzabile una sola volta. Se non hai richiesto tu il recupero, ignora questa email.\nThe Mattioli’s Hub non ti chiederà mai di comunicare la tua password.`})});if(!res.ok)throw new Error('MAIL_DELIVERY_FAILED');}
async function handleRequest(req,env){
 try {
 const url=new URL(req.url),path=url.pathname,method=req.method;
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
 if(!env.DB)fail(503,'Database non ancora configurato.');
 if(!['GET','POST','PATCH','DELETE'].includes(method))fail(405,'Metodo non supportato.');
 if(method!=='GET')originCheck(req,env);
 const ip=req.headers.get('CF-Connecting-IP')||'local';
 if(method==='GET'&&path==='/api/status'){const n=await first(env,'SELECT COUNT(*) n FROM users');return json({setupNeeded:n.n===0,mailConfigured:mailReady(env)});}
 if(method==='POST'&&path==='/api/setup'){
  await rate(env,'setup:'+ip,8,3600);const b=await body(req);
  if(!env.BOOTSTRAP_TOKEN||typeof b.token!=='string'||await digest(b.token)!==await digest(env.BOOTSTRAP_TOKEN))fail(403,'Codice di configurazione non valido.');
  const email=emailOf(b.email),name=text(b.name,80),password=await hashPassword(passwordOf(b.password));
  const id=crypto.randomUUID();const result=await run(env,"INSERT INTO users(id,email,name,password,role,active,created_at) SELECT ?,?,?,?,'admin',1,? WHERE NOT EXISTS(SELECT 1 FROM users)",id,email,name,password,now());
  if(result.meta.changes!==1)fail(409,'Il portale è già stato configurato.');
  return startSession(env,await first(env,'SELECT * FROM users WHERE id=?',id));
 }
 if(method==='POST'&&path==='/api/login'){
  const b=await body(req);const email=emailOf(b.email);await rate(env,'login-ip:'+ip,40,900);await rate(env,'login-email:'+email,10,900);
  if(typeof b.password!=='string'||b.password.length===0)fail(401,'Email o password non corrette.');
  const u=await first(env,'SELECT * FROM users WHERE email=?',email);
  // A fixed dummy record keeps unknown-account checks computationally comparable.
  const dummy='pbkdf2-sha256$100000$'+'0'.repeat(64)+'$'+'0'.repeat(64);
  const verified=await verifyPassword(b.password,u?.password||dummy);
  if(!verified||!u?.active||!u?.password)fail(401,'Email o password non corrette.');
  return startSession(env,u);
 }
 if(method==='POST'&&path==='/api/forgot'){
  if(!mailReady(env))fail(503,'Il recupero via email non è ancora attivo. Contatta l’amministratore.');
  const b=await body(req),email=emailOf(b.email);await rate(env,'forgot-ip:'+ip,10,3600);await rate(env,'forgot-email:'+email,3,3600);
  const u=await first(env,'SELECT * FROM users WHERE email=? AND active=1 AND password IS NOT NULL',email);
  if(u){const token=random(),h=await digest(token);await env.DB.batch([statement(env,"DELETE FROM tokens WHERE user_id=? AND purpose='reset'",u.id),statement(env,"INSERT INTO tokens(hash,user_id,purpose,expires_at) VALUES(?,?,'reset',?)",h,u.id,now()+1800)]);
   try{await sendReset(env,email,`${env.APP_ORIGIN}/#reset=${token}`);}catch{await run(env,'DELETE FROM tokens WHERE hash=?',h);/* Same response for unknown account or provider failure; no email/account leakage. */}
  }
  return json({message:GENERIC_RESET},202);
 }
 if(method==='POST'&&path==='/api/reset'){
  await rate(env,'reset:'+ip,20,3600);const b=await body(req);if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))fail(400,'Link non valido o scaduto.');
  const password=await hashPassword(passwordOf(b.password)),h=await digest(b.token);
  const row=await first(env,'SELECT t.*,u.active FROM tokens t JOIN users u ON u.id=t.user_id WHERE hash=? AND used_at IS NULL AND expires_at>?',h,now());
  if(!row||!row.active)fail(400,'Link non valido o scaduto. Richiedine uno nuovo.');
  const claimed=await first(env,'UPDATE tokens SET used_at=? WHERE hash=? AND used_at IS NULL AND expires_at>? RETURNING user_id',now(),h,now());
  if(!claimed)fail(400,'Questo link è già stato utilizzato.');
  await env.DB.batch([statement(env,'UPDATE users SET password=? WHERE id=? AND active=1',password,row.user_id),statement(env,'DELETE FROM sessions WHERE user_id=?',row.user_id),statement(env,'DELETE FROM tokens WHERE user_id=?',row.user_id)]);
  return json({message:'Password impostata. Ora puoi accedere.'},200,{'Set-Cookie':cookie(env,'',0)});
 }
 const user=await getSession(req,env);if(!user)fail(401,'Accedi per continuare.');
 if(path==='/api/notifications'||path.startsWith('/api/notifications/'))return await notificationsRequest(req,env,user,{body,json,fail,rate});
 if(path==='/api/shopping'||path.startsWith('/api/shopping/'))return await shoppingRequest(req,env,user,{body,json,fail});
 if(method==='GET'&&path==='/api/me')return json({user:safeUser(user)});
 if(method==='POST'&&path==='/api/logout'){const token=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(env)+'='))?.split('=')[1];if(token)await run(env,'DELETE FROM sessions WHERE hash=?',await digest(token));return json({ok:true},200,{'Set-Cookie':cookie(env,'',0)});}
 if(method==='POST'&&path==='/api/password'){
  const b=await body(req);await rate(env,'password:'+user.id,5,900);if(typeof b.current!=='string'||!await verifyPassword(b.current,user.password))fail(400,'Password attuale non corretta.');const hash=await hashPassword(passwordOf(b.password));
  await env.DB.batch([statement(env,'UPDATE users SET password=? WHERE id=?',hash,user.id),statement(env,'DELETE FROM sessions WHERE user_id=?',user.id),statement(env,'DELETE FROM tokens WHERE user_id=?',user.id)]);
  return json({message:'Password aggiornata. Accedi nuovamente.'},200,{'Set-Cookie':cookie(env,'',0)});
 }
 if(method==='GET'&&path==='/api/data'){
  const [categories,links,favorites]=await Promise.all([all(env,'SELECT * FROM categories ORDER BY position,name'),all(env,'SELECT * FROM links ORDER BY position,title'),all(env,'SELECT link_id FROM favorites WHERE user_id=?',user.id)]);
  return json({categories,links,favorites:favorites.map(x=>x.link_id)});
 }
 const fav=path.match(/^\/api\/favorites\/([^/]+)$/);
 if(fav&&['POST','DELETE'].includes(method)){if(!await first(env,'SELECT id FROM links WHERE id=?',fav[1]))fail(404,'Link non trovato.');if(method==='POST')await run(env,'INSERT OR IGNORE INTO favorites(user_id,link_id) VALUES(?,?)',user.id,fav[1]);else await run(env,'DELETE FROM favorites WHERE user_id=? AND link_id=?',user.id,fav[1]);return json({ok:true});}
 if(!path.startsWith('/api/admin/'))fail(404,'Risorsa non trovata.');
 if(user.role!=='admin')fail(403,'Questa funzione è riservata agli amministratori.');
 if(method==='GET'&&path==='/api/admin/users')return json({users:(await all(env,'SELECT * FROM users ORDER BY created_at,name')).map(safeUser)});
 if(method==='POST'&&path==='/api/admin/users'){
  const b=await body(req),email=emailOf(b.email),name=text(b.name,80),role=roleOf(b.role),id=crypto.randomUUID();
  await run(env,'INSERT INTO users(id,email,name,role,active,created_at) VALUES(?,?,?,?,1,?)',id,email,name,role,now());
  return json({user:safeUser(await first(env,'SELECT * FROM users WHERE id=?',id))},201);
 }
 const invite=path.match(/^\/api\/admin\/users\/([^/]+)\/invite$/);
 if(invite&&method==='POST'){
  const target=await first(env,'SELECT * FROM users WHERE id=?',invite[1]);if(!target||!target.active)fail(404,'Utente non attivo o inesistente.');if(target.password)fail(400,'L’utente ha già una password. Deve utilizzare il recupero password.');
  const token=random();await env.DB.batch([statement(env,'DELETE FROM tokens WHERE user_id=?',target.id),statement(env,"INSERT INTO tokens(hash,user_id,purpose,expires_at) VALUES(?,?,'invite',?)",await digest(token),target.id,now()+86400)]);
  return json({url:`${env.APP_ORIGIN}/#activate=${token}`,message:'Invito valido per 24 ore, utilizzabile una sola volta. Condividilo privatamente con il destinatario.'});
 }
 const userPath=path.match(/^\/api\/admin\/users\/([^/]+)$/);
 if(userPath&&method==='PATCH'){
  const b=await body(req),id=userPath[1];if(!await first(env,'SELECT id FROM users WHERE id=?',id))fail(404,'Utente non trovato.');
  const name=text(b.name,80),role=roleOf(b.role);if(typeof b.active!=='boolean')fail(400,'Stato non valido.');
  await env.DB.batch([statement(env,'UPDATE users SET name=?,role=?,active=? WHERE id=?',name,role,b.active?1:0,id),statement(env,'DELETE FROM sessions WHERE user_id=?',id),statement(env,'DELETE FROM tokens WHERE user_id=?',id)]);return json({ok:true});
 }
 const linkPath=path.match(/^\/api\/admin\/links(?:\/([^/]+))?$/);
 if(linkPath){const id=linkPath[1];
  if(method==='DELETE'&&id){await run(env,'DELETE FROM links WHERE id=?',id);return json({ok:true});}
  if((method==='POST'&&!id)||(method==='PATCH'&&id)){
   const b=await body(req),title=text(b.title,100),address=text(b.url,2048),description=typeof b.description==='string'?b.description.trim():'';if(description.length>300)fail(400,'Descrizione troppo lunga (massimo 300 caratteri).');
   let parsed;try{parsed=new URL(address);}catch{fail(400,'Indirizzo non valido.');}if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)fail(400,'Usa un indirizzo HTTP o HTTPS senza credenziali.');
   const category=b.category_id||null;if(category&&!await first(env,'SELECT id FROM categories WHERE id=?',category))fail(400,'Categoria inesistente.');const pos=Number(b.position);if(!Number.isSafeInteger(pos)||Math.abs(pos)>100000)fail(400,'Posizione non valida.');
   if(id){const r=await run(env,'UPDATE links SET title=?,url=?,description=?,category_id=?,position=?,updated_at=? WHERE id=?',title,parsed.href,description,category,pos,now(),id);if(!r.meta.changes)fail(404,'Link non trovato.');}
   else await run(env,'INSERT INTO links(id,title,url,description,category_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',crypto.randomUUID(),title,parsed.href,description,category,pos,now(),now());
   return json({ok:true},id?200:201);
  }
 }
 const catPath=path.match(/^\/api\/admin\/categories(?:\/([^/]+))?$/);
 if(catPath){const id=catPath[1];if(method==='DELETE'&&id){await run(env,'DELETE FROM categories WHERE id=?',id);return json({ok:true});}
  if((method==='POST'&&!id)||(method==='PATCH'&&id)){const b=await body(req),name=text(b.name,40);if(!['teal','blue','violet','green','rose','amber'].includes(b.color))fail(400,'Colore non valido.');if(!['folder','home','briefcase','monitor','bike','flask','tool','globe','book','music'].includes(b.icon))fail(400,'Icona non valida.');const pos=Number(b.position);if(!Number.isSafeInteger(pos)||Math.abs(pos)>100000)fail(400,'Posizione non valida.');
   if(id){const r=await run(env,'UPDATE categories SET name=?,color=?,icon=?,position=? WHERE id=?',name,b.color,b.icon,pos,id);if(!r.meta.changes)fail(404,'Categoria non trovata.');}else await run(env,'INSERT INTO categories(id,name,color,icon,position) VALUES(?,?,?,?,?)',crypto.randomUUID(),name,b.color,b.icon,pos);return json({ok:true},id?200:201);
  }
 }
 fail(404,'Risorsa non trovata.');
 }catch(error){if(error instanceof HttpError)return json({error:error.message},error.status);const message=String(error.message||'');if(message.includes('LAST_ADMIN'))return json({error:'Deve rimanere almeno un amministratore attivo.'},409);if(message.includes('UNIQUE constraint'))return json({error:'Esiste già un elemento con questo nome o questa email.'},409);return json({error:'Servizio temporaneamente non disponibile. Riprova più tardi.'},503);}
}

export default {
 async fetch(req,env,ctx){
  const tracked=['POST','PATCH','DELETE'].includes(req.method)&&/^\/api\/(shopping(?:\/|$)|admin\/(links|categories)(?:\/|$))/.test(new URL(req.url).pathname);
  const copy=tracked?req.clone():null;
  const response=await handleRequest(req,env);
  if(tracked&&response.ok){try{const user=await getSession(req,env);if(user)await recordActivity(copy,env,response,user);}catch{console.error('Notification event unavailable');}if(ctx)ctx.waitUntil(dispatchNotifications(env).catch(()=>console.error('Notification dispatch unavailable')));}
  return response;
 },
 async scheduled(controller,env,ctx){const task=(async()=>{await recordRelease(env);await dispatchNotifications(env);})();ctx.waitUntil(task);}
};
