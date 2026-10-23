export const auditSchema=[`CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL,actor_id TEXT,actor_name TEXT NOT NULL,action TEXT NOT NULL,resource TEXT NOT NULL,target_id TEXT,target_name TEXT,status INTEGER NOT NULL)`,`CREATE INDEX IF NOT EXISTS audit_log_time ON audit_log(created_at DESC,id DESC)`];
const ready=new WeakMap();
export async function ensureAudit(env){if(!ready.has(env.DB))ready.set(env.DB,env.DB.batch(auditSchema.map(s=>env.DB.prepare(s))).catch(e=>{ready.delete(env.DB);throw e;}));await ready.get(env.DB);}
export async function auditContext(req,env,user){
 const path=new URL(req.url).pathname;if(req.method==='GET'||!path.startsWith('/api/')||path==='/api/forgot'||!env.DB)return null;
 const resource=path.split('/').slice(2).join('/');let actor=user,b={};try{b=await req.clone().json();}catch{}
 if(!actor&&path==='/api/reset'&&typeof b.token==='string'&&/^[a-f0-9]{64}$/.test(b.token)){
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(b.token))),n=>n.toString(16).padStart(2,'0')).join('');
  actor=await env.DB.prepare('SELECT u.id,u.name FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.hash=? AND t.used_at IS NULL AND t.expires_at>? AND u.active=1').bind(hash,Math.floor(Date.now()/1000)).first();
 }
 if(!actor&&!['/api/login','/api/setup'].includes(path))return null;
 let targetId=null,targetName=null;
 const match=path.match(/^\/api\/(?:admin\/(links|categories|users)|shopping\/(lists|items)|favorites)\/([^/]+)/);
 if(match){targetId=match[3];const table={links:'links',categories:'categories',users:'users',lists:'shopping_lists',items:'shopping_items'}[match[1]||match[2]]||(path.startsWith('/api/favorites/')?'links':null);if(table){try{const column=['links','shopping_lists'].includes(table)?'title':'name';const row=await env.DB.prepare(`SELECT ${column} label FROM ${table} WHERE id=?`).bind(targetId).first();targetName=row?.label||null;}catch{}}}
 if(typeof (b.title||b.name)==='string')targetName=(b.title||b.name).slice(0,120);
 let action=req.method;
 if(path.startsWith('/api/shopping/')){if(typeof b.checked==='boolean')action=b.checked?'Prodotto spuntato':'Prodotto da acquistare';else if(typeof b.archived==='boolean')action=b.archived?'Lista archiviata':'Lista ripristinata';else if(path.endsWith('/move'))action='Prodotto riordinato';else if(path.endsWith('/reuse'))action='Lista preparata per nuova spesa';else if(path.endsWith('/restore'))action='Prodotto ripristinato';}
 return {actor,resource,targetId,targetName,action,path};
}
export async function writeAudit(env,context,response){
 if(!context)return;let {actor,resource,targetId,targetName,action,path}=context;
 if(!actor){if(!response.ok)return;try{actor=(await response.clone().json()).user;}catch{}if(!actor)return;}
 await ensureAudit(env);
 const authActions={'/api/login':'Accesso','/api/logout':'Uscita','/api/setup':'Configurazione iniziale','/api/password':'Cambio password','/api/reset':'Impostazione password'};
 action=authActions[path]||({POST:'Aggiunta / azione',PATCH:'Modifica',DELETE:'Rimozione'}[action]||action);
 if(path.endsWith('/invite'))action='Invito generato';
 if(path.endsWith('/read'))action='Notifiche segnate come lette';
 if(path.endsWith('/test'))action='Notifica di prova';
 await env.DB.prepare('INSERT INTO audit_log(id,created_at,actor_id,actor_name,action,resource,target_id,target_name,status) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),Date.now(),actor.id,actor.name,action,resource,targetId,targetName,response.status).run();
}
export async function auditRequest(req,env,{json,fail}){
 if(req.method!=='GET')fail(405,'Registro in sola lettura.');await ensureAudit(env);const url=new URL(req.url),cursor=url.searchParams.get('before'),query=(url.searchParams.get('q')||'').trim().slice(0,100);const args=[];let where='1=1';
 if(cursor){const parts=cursor.split(':');if(parts.length!==2||!/^\d+$/.test(parts[0])||!/^[a-f0-9-]{36}$/.test(parts[1]))fail(400,'Pagina non valida.');where+=' AND (created_at<? OR (created_at=? AND id<?))';args.push(Number(parts[0]),Number(parts[0]),parts[1]);}
 if(query){where+=" AND (instr(lower(actor_name),lower(?))>0 OR instr(lower(resource),lower(?))>0 OR instr(lower(action),lower(?))>0 OR instr(lower(COALESCE(target_name,'')),lower(?))>0)";args.push(query,query,query,query);}
 const rows=(await env.DB.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 101`).bind(...args).all()).results;const more=rows.length>100;const events=rows.slice(0,100),last=events.at(-1);return json({events,next:more?last.created_at+':'+last.id:null});
}
