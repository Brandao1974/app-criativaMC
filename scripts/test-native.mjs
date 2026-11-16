// Disposable PostgreSQL; no service, OS user or remote endpoint.
import { iniciarPostgres } from './local-postgres.mjs';
import { spawn } from 'node:child_process';
import pg from 'pg';
const cluster=await iniciarPostgres();
try {
 const c=new pg.Client({connectionString:cluster.url});await c.connect();
 console.log('PostgreSQL nativo: '+(await c.query('select version() as v')).rows[0].v);await c.end();
 const url=cluster.url;
  const code=await new Promise((ok,fail)=>{
    const child=spawn(process.execPath,['--test','--test-reporter=spec','tests/native/concurrency.test.mjs'],{
      env:{...process.env,LOCAL_PG_URL:url},stdio:'inherit',windowsHide:true});
    child.on('error',fail);child.on('exit',ok);
  });
  process.exitCode=code ?? 1;
} finally {await cluster.stop();}
