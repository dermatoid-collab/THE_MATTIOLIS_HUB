// Additive schema: initialized once per D1 binding, safe on an existing hub.
export const shoppingSchema=[
 `CREATE TABLE IF NOT EXISTS shopping_lists (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'teal' CHECK(color IN ('teal','blue','violet','green','rose','amber')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
 )`,
 `CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES shopping_lists(id),
  name TEXT NOT NULL, quantity TEXT NOT NULL DEFAULT '', checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN (0,1)),
  position REAL NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id), checked_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1
 )`,
 `CREATE INDEX IF NOT EXISTS shopping_items_list ON shopping_items(list_id,deleted,position)`,
 `CREATE INDEX IF NOT EXISTS shopping_lists_archive ON shopping_lists(archived,updated_at)`
];
const initialized=new WeakMap();
async function ensureSchema(db){
 if(!initialized.has(db))initialized.set(db,db.batch(shoppingSchema.map(sql=>db.prepare(sql))).catch(error=>{initialized.delete(db);throw error;}));
 await initialized.get(db);
}
export async function shoppingRequest(req,env,user,{body,json,fail}){
 await ensureSchema(env.DB);
 const db=env.DB,statement=(sql,...v)=>db.prepare(sql).bind(...v);
 const first=(sql,...v)=>statement(sql,...v).first();
 const all=async(sql,...v)=>(await statement(sql,...v).all()).results;
 const path=new URL(req.url).pathname,method=req.method;
 const required=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)fail(400,'Inserisci un testo valido e rispetta la lunghezza indicata.');return v.trim();};
 const quantity=v=>{if(v===undefined)return '';if(typeof v!=='string'||v.trim().length>80)fail(400,'Quantità non valida (massimo 80 caratteri).');return v.trim();};
 const color=v=>{if(!['teal','blue','violet','green','rose','amber'].includes(v))fail(400,'Colore non valido.');return v;};
 const version=v=>{if(!Number.isSafeInteger(v)||v<1)fail(400,'Versione non valida. Aggiorna la lista.');return v;};
 const activeList=async id=>{const row=await first('SELECT * FROM shopping_lists WHERE id=?',id);if(!row)fail(404,'Lista non trovata.');if(row.archived)fail(409,'Questa lista è archiviata. Ripristinala prima di modificarla.');return row;};
 const touch=id=>statement('UPDATE shopping_lists SET updated_at=? WHERE id=?',Date.now(),id);
 const readItem=async id=>{const row=await first('SELECT * FROM shopping_items WHERE id=?',id);if(!row)fail(404,'Prodotto non trovato.');return row;};
 const conflict=()=>fail(409,'La lista è stata aggiornata da un altro familiare. Aggiorna e riprova.');
 if(path==='/api/shopping'&&method==='GET'){
  // Sequential reads avoid interleaving D1 batches and keep all records available to the client.
  const lists=await all('SELECT l.*,u.name AS creator FROM shopping_lists l JOIN users u ON u.id=l.created_by ORDER BY l.archived,l.updated_at DESC,l.id');
  const items=await all('SELECT i.*,u.name AS added_by,c.name AS checked_by_name FROM shopping_items i JOIN users u ON u.id=i.created_by LEFT JOIN users c ON c.id=i.checked_by WHERE i.deleted=0 ORDER BY i.position,i.created_at,i.id');
  return json({lists,items});
 }
 if(path==='/api/shopping/lists'&&method==='POST'){
  const b=await body(req),id=crypto.randomUUID(),t=Date.now();
  await statement('INSERT INTO shopping_lists(id,title,color,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,required(b.title,80),color(b.color),user.id,t,t).run();return json({id},201);
 }
 let match=path.match(/^\/api\/shopping\/lists\/([^/]+)$/);
 if(match&&method==='PATCH'){
  const b=await body(req),id=match[1],row=await first('SELECT * FROM shopping_lists WHERE id=?',id);if(!row)fail(404,'Lista non trovata.');
  const v=version(b.version);let result;
  if(Object.hasOwn(b,'archived')){
   if(typeof b.archived!=='boolean')fail(400,'Stato non valido.');
   result=await statement('UPDATE shopping_lists SET archived=?,updated_at=?,version=version+1 WHERE id=? AND version=?',b.archived?1:0,Date.now(),id,v).run();
  }else{
   if(row.archived)fail(409,'Ripristina la lista prima di modificarla.');
   result=await statement('UPDATE shopping_lists SET title=?,color=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND archived=0',required(b.title,80),color(b.color),Date.now(),id,v).run();
  }
  if(!result.meta.changes)conflict();return json({ok:true});
 }
 match=path.match(/^\/api\/shopping\/lists\/([^/]+)\/reuse$/);
 if(match&&method==='POST'){
  const id=match[1];await activeList(id);
  await db.batch([statement('UPDATE shopping_items SET checked=0,checked_by=NULL,updated_at=?,version=version+1 WHERE list_id=? AND deleted=0 AND checked=1 AND EXISTS(SELECT 1 FROM shopping_lists WHERE id=? AND archived=0)',Date.now(),id,id),touch(id)]);return json({ok:true});
 }
 match=path.match(/^\/api\/shopping\/lists\/([^/]+)\/items$/);
 if(match&&method==='POST'){
  const id=match[1];await activeList(id);const b=await body(req),itemId=crypto.randomUUID(),t=Date.now();
  const name=required(b.name,160),qty=quantity(b.quantity);
  const r=await db.batch([statement('INSERT INTO shopping_items(id,list_id,name,quantity,position,created_by,created_at,updated_at) SELECT ?,?,?,?,COALESCE((SELECT MAX(position) FROM shopping_items WHERE list_id=? AND deleted=0),0)+1024,?,?,? WHERE EXISTS(SELECT 1 FROM shopping_lists WHERE id=? AND archived=0)',itemId,id,name,qty,id,user.id,t,t,id),touch(id)]);
  if(!r[0].meta.changes)conflict();return json({id:itemId},201);
 }
 match=path.match(/^\/api\/shopping\/items\/([^/]+)(?:\/(move|restore))?$/);
 if(match){
  const id=match[1],action=match[2],row=await readItem(id);await activeList(row.list_id);
  if(action==='restore'&&method==='POST'){
   const r=await db.batch([statement('UPDATE shopping_items SET deleted=0,updated_at=?,version=version+1 WHERE id=? AND deleted=1 AND EXISTS(SELECT 1 FROM shopping_lists WHERE id=? AND archived=0)',Date.now(),id,row.list_id),touch(row.list_id)]);if(!r[0].meta.changes)fail(409,'Il prodotto è già stato ripristinato o la lista è archiviata.');return json({ok:true});
  }
  if(row.deleted)fail(404,'Prodotto rimosso.');
  const b=await body(req),v=version(b.version);let update;
  if(action==='move'&&method==='POST'){
   if(!['up','down'].includes(b.direction)||row.checked)fail(400,'Spostamento non valido.');
   const rows=await all('SELECT id,position FROM shopping_items WHERE list_id=? AND deleted=0 AND checked=0 ORDER BY position,created_at,id',row.list_id);
   const index=rows.findIndex(x=>x.id===id),next=b.direction==='up'?index-1:index+1;if(next<0||next>=rows.length)return json({ok:true});
   const neighbor=rows[next],outer=rows[b.direction==='up'?index-2:index+2];
   const position=outer?(neighbor.position+outer.position)/2:neighbor.position+(b.direction==='up'?-1024:1024);
   update=statement('UPDATE shopping_items SET position=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted=0 AND EXISTS(SELECT 1 FROM shopping_lists WHERE id=? AND archived=0)',position,Date.now(),id,v,row.list_id);
  }else if(!action&&method==='DELETE'){
   update=statement('UPDATE shopping_items SET deleted=1,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted=0 AND EXISTS(SELECT 1 FROM shopping_lists WHERE id=? AND archived=0)',Date.now(),id,v,row.list_id);
  }else if(!action&&method==='PATCH'){
   if(Object.hasOwn(b,'checked')){
    if(typeof b.checked!=='boolean')fail(400,'Spunta non valida.');
    update=statement('UPDATE shopping_items SET checked=?,checked_by=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted=0 AND EXISTS(SELECT 1 FROM shopping_lists WHERE id=? AND archived=0)',b.checked?1:0,b.checked?user.id:null,Date.now(),id,v,row.list_id);
   }else update=statement('UPDATE shopping_items SET name=?,quantity=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted=0 AND EXISTS(SELECT 1 FROM shopping_lists WHERE id=? AND archived=0)',required(b.name,160),quantity(b.quantity),Date.now(),id,v,row.list_id);
  }else fail(404,'Operazione non trovata.');
  const r=await db.batch([update,touch(row.list_id)]);if(!r[0].meta.changes)conflict();return json({ok:true});
 }
 fail(404,'Risorsa non trovata.');
}
