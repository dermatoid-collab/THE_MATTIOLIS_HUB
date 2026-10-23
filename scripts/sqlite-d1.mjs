import { DatabaseSync } from 'node:sqlite';
export class LocalD1 {
 constructor(path=':memory:'){this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON;');}
 exec(sql){this.db.exec(sql);}
 prepare(sql){return this.statement(sql,[]);}
 statement(sql,args){const db=this.db;return {bind:(...values)=>this.statement(sql,values),async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return{success:true,meta:{changes:Number(r.changes)}};},_sql:sql,_args:args};}
 async batch(statements){this.db.exec('BEGIN IMMEDIATE');try{const out=[];for(const s of statements)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 close(){this.db.close();}
}
