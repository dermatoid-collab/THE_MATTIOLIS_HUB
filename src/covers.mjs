export const coverSchema=[`CREATE TABLE IF NOT EXISTS hub_covers(owner TEXT PRIMARY KEY,image TEXT NOT NULL,position_x INTEGER NOT NULL DEFAULT 50,position_y INTEGER NOT NULL DEFAULT 50,version TEXT NOT NULL,updated_at INTEGER NOT NULL)`];
const ready=new WeakMap();
export async function ensureCovers(env){if(!ready.has(env.DB))ready.set(env.DB,env.DB.batch(coverSchema.map(s=>env.DB.prepare(s))).catch(e=>{ready.delete(env.DB);throw e;}));await ready.get(env.DB);}
const get=(env,owner)=>env.DB.prepare('SELECT owner,position_x,position_y,version,updated_at FROM hub_covers WHERE owner=?').bind(owner).first();
const view=row=>row?{scope:row.owner==='family'?'family':'personal',x:row.position_x,y:row.position_y,version:row.version}:null;
async function data(env){const family=view(await get(env,'family'));return {family,effective:family};}
async function coverBody(req,fail){const reader=req.body?.getReader();if(!reader)fail(400,'Foto mancante.');const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>260000){reader.cancel().catch(()=>{});fail(413,'Foto troppo grande. Riprova con un’immagine più piccola.');}chunks.push(value);}const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}try{return JSON.parse(new TextDecoder().decode(raw));}catch{fail(400,'Foto non valida.');}}
export async function coversRequest(req,env,user,{json,fail,rate}){
 await ensureCovers(env);const path=new URL(req.url).pathname;
 if(req.method==='GET'&&path==='/api/covers')return json(await data(env,user));
 const match=path.match(/^\/api\/covers\/(personal|family)(?:\/(image))?$/);if(!match)fail(404,'Risorsa non trovata.');const scope=match[1];if(scope!=='family')fail(410,'La copertina è unica per tutti e viene gestita dall’amministratore.');const owner='family';
 if(match[2]){if(req.method!=='GET')fail(405,'Metodo non supportato.');const row=await env.DB.prepare('SELECT image FROM hub_covers WHERE owner=?').bind(owner).first();if(!row)fail(404,'Foto non presente.');const bytes=Uint8Array.from(atob(row.image),c=>c.charCodeAt(0));return new Response(bytes,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}});}
 if(scope==='family'&&user.role!=='admin')fail(403,'Solo gli amministratori possono modificare la copertina della famiglia.');
 if(!['POST','PATCH','DELETE'].includes(req.method))fail(405,'Metodo non supportato.');await rate(env,'cover:'+user.id,40,3600);
 if(req.method==='DELETE'){await env.DB.prepare('DELETE FROM hub_covers WHERE owner=?').bind(owner).run();return json(await data(env,user));}
 const b=await coverBody(req,fail);if(!Number.isInteger(b.x)||b.x<0||b.x>100||!Number.isInteger(b.y)||b.y<0||b.y>100)fail(400,'Posizione non valida.');
 const version=crypto.randomUUID();
 if(req.method==='POST'){
  if(typeof b.image!=='string'||b.image.length>245760||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.image))fail(400,'Foto JPEG non valida.');let bytes;try{bytes=Uint8Array.from(atob(b.image),c=>c.charCodeAt(0));}catch{fail(400,'Foto non valida.');}
  if(bytes.length<4||bytes.length>184320||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)fail(400,'Usa una foto JPEG valida.');
  await env.DB.prepare('INSERT INTO hub_covers(owner,image,position_x,position_y,version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET image=excluded.image,position_x=excluded.position_x,position_y=excluded.position_y,version=excluded.version,updated_at=excluded.updated_at').bind(owner,b.image,b.x,b.y,version,Date.now()).run();
 }else{const result=await env.DB.prepare('UPDATE hub_covers SET position_x=?,position_y=?,version=?,updated_at=? WHERE owner=?').bind(b.x,b.y,version,Date.now(),owner).run();if(!result.meta.changes)fail(404,'Carica prima una foto.');}
 return json(await data(env,user));
}
