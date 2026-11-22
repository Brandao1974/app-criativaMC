// Minimal isolated native Auth + PostgREST stack. No Docker, SMTP, remote
// resource, real account, browser configuration or persistent service.
import { iniciarPostgres, portaLivre } from './local-postgres.mjs';
import { readFile, appendFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { migration } from '../tests/harness.mjs';
const authBin=resolve('.local/tools/gotrue.exe'),restBin=resolve('.local/tools/postgrest14/postgrest.exe');
const alltechMode=process.argv.includes('--alltech');
const accessMode=alltechMode || process.argv.includes('--access');
await access(authBin);await access(restBin);
const cluster=await iniciarPostgres();const filhos=[];let proxy,db;
const log=texto=>{void appendFile(resolve(cluster.root,'auth-rest.log'),String(texto)+'\n');};
const localEnv={SystemRoot:process.env.SystemRoot,
  PATH:resolve('node_modules/@embedded-postgres/windows-x64/native/bin')+';'+process.env.PATH,
  TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE,
  APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA,
  HOMEDRIVE:process.env.HOMEDRIVE,HOMEPATH:process.env.HOMEPATH};
function iniciar(bin,env) {
  const p=spawn(bin,[],{cwd:cluster.root,env:{...localEnv,...env},stdio:['ignore','pipe','pipe'],windowsHide:true});
  p.stdout.on('data',log);p.stderr.on('data',log);p.on('error',log);filhos.push(p);return p;
}
async function esperar(url,child) {
  const limite=Date.now()+90000;
  while(Date.now()<limite) {
    if(child.exitCode!==null)throw new Error('Serviço local encerrou, código '+child.exitCode+'; consulte os logs privados em .local.');
    try{if((await fetch(url)).status<500)return;}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('Serviço local não ficou disponível em 90 segundos.');
}
try {
  const authPort=await portaLivre(),restPort=await portaLivre(),proxyPort=await portaLivre();
  const segredo=randomBytes(48).toString('base64url'),senhaDb=randomBytes(24).toString('base64url');
  db=new pg.Client({connectionString:cluster.url});await db.connect();
  await db.query(`create role anon;create role authenticated;create role service_role;
    create role authenticator login noinherit password ${db.escapeLiteral(senhaDb)};
    grant anon,authenticated to authenticator;create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
  const api=`http://127.0.0.1:${proxyPort}`;
  const authDb=new URL(cluster.url);authDb.searchParams.set('search_path','auth');
  const auth=iniciar(authBin,{
    GOTRUE_JWT_SECRET:segredo,GOTRUE_JWT_EXP:'3600',GOTRUE_JWT_AUD:'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',
    GOTRUE_DB_DRIVER:'postgres',DB_NAMESPACE:'auth',DATABASE_URL:authDb.href,
    API_EXTERNAL_URL:api+'/auth/v1',GOTRUE_API_HOST:'127.0.0.1',PORT:String(authPort),
    GOTRUE_DISABLE_SIGNUP:'true',GOTRUE_SITE_URL:api,GOTRUE_MAILER_AUTOCONFIRM:'true',
    GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_EXTERNAL_PHONE_ENABLED:'false',LOG_LEVEL:'error'
  });
  await esperar(`http://127.0.0.1:${authPort}/health`,auth);
  const assinar=claims=>{
    const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const p=Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${h}.${p}.${createHmac('sha256',segredo).update(h+'.'+p).digest('base64url')}`;
  };
  const exp=Math.floor(Date.now()/1000)+3600;
  const adminJwt=assinar({role:'service_role',iss:'supabase',exp});
  const anonJwt=assinar({role:'anon',iss:'supabase',exp});
  const env={LOCAL_SUPABASE_URL:api,LOCAL_SUPABASE_PUBLIC_KEY:anonJwt,
    LOCAL_AUTH_PG_URL:cluster.url,LOCAL_AUTH_JWT_SECRET:segredo};
  const ids=[];
  for(const letra of ['A','B','C']) {
    const email=`qa_${letra.toLowerCase()}_${randomUUID()}@fixture.test`,password=randomBytes(24).toString('base64url');
    const r=await fetch(`http://127.0.0.1:${authPort}/admin/users`,{method:'POST',
      headers:{Authorization:'Bearer '+adminJwt,'Content-Type':'application/json'},
      body:JSON.stringify({email,password,email_confirm:true})});
    if(!r.ok)throw new Error('Falha ao criar fixture Auth LOCAL: HTTP '+r.status);
    const u=await r.json();ids.push(u.id || u.user?.id);
    env[`LOCAL_QA_${letra}_EMAIL`]=email;env[`LOCAL_QA_${letra}_PASSWORD`]=password;
  }
  await db.query(await migration());
  for(let i=0;i<ids.length;i++)await db.query('insert into public.profiles(id,nome) values($1,$2)',[ids[i],['Gustavo','Ivan','Terceiro'][i]]);
  await db.query("insert into public.app_membros(usuario_id,lugar) values($1,'gustavo'),($2,'ivan')",[ids[0],ids[1]]);
  if(accessMode) {
   await db.query(await migration({latest:true}));
   env.LOCAL_AUTH_ADMIN_KEY=adminJwt;
   env.LOCAL_LEGACY_GUSTAVO=ids[0];
   try{await access(resolve('.local/tools/deno.exe'));env.LOCAL_DENO_BIN=resolve('.local/tools/deno.exe');}catch{}
  }
  const restUrl=new URL(cluster.url);restUrl.username='authenticator';restUrl.password=senhaDb;
  const rest=iniciar(restBin,{PGRST_DB_URI:restUrl.href,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',
    PGRST_JWT_SECRET:segredo,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(restPort)});
  await esperar(`http://127.0.0.1:${restPort}/`,rest);
  proxy=createServer(async(req,res)=>{
    try{
      const prefix=req.url.startsWith('/auth/v1')?'/auth/v1':req.url.startsWith('/rest/v1')?'/rest/v1':null;
      if(!prefix){res.writeHead(404);res.end();return;}
      const chunks=[];for await(const b of req)chunks.push(b);
      const headers={...req.headers};delete headers.host;delete headers['content-length'];
      const r=await fetch(`http://127.0.0.1:${prefix==='/auth/v1'?authPort:restPort}`+(req.url.slice(prefix.length)||'/'),{
        method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      res.writeHead(r.status,Object.fromEntries([...r.headers].filter(([k])=>!['content-encoding','content-length','transfer-encoding'].includes(k))));
      res.end(Buffer.from(await r.arrayBuffer()));
    }catch{res.writeHead(502);res.end();}
  });
  await new Promise(r=>proxy.listen(proxyPort,'127.0.0.1',r));
  console.log('Stack exclusivamente local: Auth 2.197.0 (socket Windows adaptado) + PostgREST 14.1 + PostgreSQL 17.11; três fixtures .test.');
  const code=await new Promise((ok,fail)=>{
    const filtro=alltechMode?['--test-name-pattern=^(AC0[1-3]|ALLTECH:)']:[];
    const c=spawn(process.execPath,['--test','--test-reporter=spec',...filtro,accessMode?'tests/native/access.test.mjs':'tests/native/auth-api.test.mjs'],{
      env:{...process.env,...env},stdio:'inherit',windowsHide:true});c.once('error',fail);c.once('exit',ok);
  });
  process.exitCode=code??1;
}finally{
  if(proxy)await new Promise(r=>proxy.close(r));
  for(const p of filhos.reverse())if(p.exitCode===null){const fim=once(p,'exit');p.kill();await fim;}
  await db?.end();await cluster.stop();
}
