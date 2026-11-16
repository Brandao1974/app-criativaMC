import EmbeddedPostgres from 'embedded-postgres';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
export async function portaLivre() {
  return new Promise((ok,fail)=>{
    const s=createServer();s.on('error',fail);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});
  });
}
export async function iniciarPostgres() {
  const root=resolve('.local',`pg-corrective-${randomUUID()}`);await mkdir(root,{recursive:true});
  const port=await portaLivre(),password=randomBytes(24).toString('base64url');
  const log=msg=>{void appendFile(resolve(root,'postgres.log'),String(msg)+'\n');};
  const cluster=new EmbeddedPostgres({databaseDir:resolve(root,'data'),user:'postgres',password,port,
    authMethod:'scram-sha-256',persistent:true,createPostgresUser:false,
    initdbFlags:['--encoding=UTF8','--locale=C','--no-sync'],onLog:log,onError:log});
  await cluster.initialise();
  // Explicit native lifecycle avoids the library's Windows taskkill process.
  const bins=await import(`@embedded-postgres/${process.platform==='win32'?'windows':process.platform}-${process.arch}`);
  const child=spawn(bins.postgres,['-D',resolve(root,'data'),'-p',String(port),'-h','127.0.0.1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const saida=once(child,'exit');
  await new Promise((ok,fail)=>{
    child.once('error',fail);child.once('exit',()=>fail(new Error('PostgreSQL encerrou antes de iniciar.')));
    child.stderr.on('data',b=>{const s=String(b);log(s);if(s.includes('ready to accept connections'))ok();});
    child.stdout.on('data',log);
  });
  return {root,url:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`,
    async stop(){
      if(child.exitCode!==null)return;
      await new Promise((ok,fail)=>{
        const ctl=spawn(bins.pg_ctl,['stop','-D',resolve(root,'data'),'-m','fast','-w'],{windowsHide:true,stdio:'ignore'});
        ctl.once('error',fail);ctl.once('exit',code=>code===0?ok():fail(new Error('Falha ao parar instância local.')));
      });
      await saida;
    }};
}
