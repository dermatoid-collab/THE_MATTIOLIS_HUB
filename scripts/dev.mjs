// Development only: local SQLite substitutes for Cloudflare D1. Never deploy this server.
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalD1} from './sqlite-d1.mjs';
import worker from '../src/worker.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');mkdirSync(resolve(root,'.local'),{recursive:true});
const db=new LocalD1(resolve(root,'.local/punto.sqlite'));
if(!db.db.prepare("SELECT name FROM sqlite_master WHERE name='users'").get())db.exec(readFileSync(resolve(root,'migrations/0001_initial.sql'),'utf8'));
const port=Number(process.env.PORT||4173),host=process.env.HOST||'0.0.0.0';
const env={DB:db,LOCAL_DEV:'true',APP_ORIGIN:process.env.APP_ORIGIN||'http://terminal.local:4173',BOOTSTRAP_TOKEN:process.env.PUNTO_BOOTSTRAP_TOKEN};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const staticHeaders=Object.fromEntries([...readFileSync(resolve(root,'public/_headers'),'utf8').matchAll(/^  ([^:]+): (.+)$/gm)].map(m=>[m[1],m[2]]));
const server=createServer(async(req,res)=>{try{const origin=env.APP_ORIGIN,url=new URL(req.url,origin);if(!url.pathname.startsWith('/api/')){let file=resolve(root,'public','.'+decodeURIComponent(url.pathname));if(!file.startsWith(resolve(root,'public')+'/'))file=resolve(root,'public/index.html');if(!existsSync(file)||url.pathname==='/')file=resolve(root,'public/index.html');res.writeHead(200,{...staticHeaders,'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(readFileSync(file));return;}
 const chunks=[];for await(const c of req){chunks.push(c);if(chunks.reduce((n,x)=>n+x.length,0)>(url.pathname.startsWith('/api/covers/')?260000:32768)){res.writeHead(413);res.end();return;}}const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});const result=await worker.fetch(request,env);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
}catch{res.writeHead(500);res.end('Errore del server locale.');}});
server.listen(port,host,()=>console.log(`Punto preview ready on port ${port}. Open /?demo=1 for the interactive sample. No production accounts or emails are used.`));
