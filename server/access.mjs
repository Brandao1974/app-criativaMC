// Trusted server only. Never import this module into browser bundles.
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
export const canonical=value=>typeof value==='string'&&/^(ildebrando|edson|ivan)$/.test(value.trim().toLowerCase())?value.trim().toLowerCase():null;
const fail=(status=400)=>Object.assign(new Error('Não foi possível concluir o acesso.'),{status});
const authOptions={persistSession:false,autoRefreshToken:false,detectSessionInUrl:false};
export function criarAcesso({pool,url,publicKey,secretKey,pepper}) {
 if(!pepper||pepper.length<32)throw new Error('Segredo HMAC servidor obrigatório (mínimo 32 caracteres).');
 const admin=createClient(url,secretKey,{auth:{...authOptions,storageKey:'server-admin-'+randomUUID()}});
 const sql=async(name,args=[],executor=pool)=>{
  if(!/^[a-z_]+$/.test(name))throw fail();
  return (await executor.query(`select private.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args)).rows[0].r;
 };
 const digest=(purpose,value)=>createHmac('sha256',pepper).update(purpose+'\0'+value).digest('hex');
 async function limiter(origin,user) {
  // Never trust client X-Forwarded-For. The HTTP adapter supplies socket IP.
  const ip=await sql('limitar_acesso',[digest('ip',origin),60]);
  const pair=await sql('limitar_acesso',[digest('pair',origin+'\0'+user),10]);
  if(!ip||!pair)throw fail(429);
 }
 async function actor(token) {
  if(typeof token!=='string'||token.length>8192)throw fail(401);
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data.user)throw fail(401);
  let claims;try{claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{throw fail(401);}
  if(claims.sub!==data.user.id||typeof claims.session_id!=='string')throw fail(401);
  return [data.user.id,claims.session_id]; // SQL checks real Auth session + generation.
 }
 async function ensureAuth(username,alias) {
  let id=await sql('localizar_auth',[username]);
  if(id)return id;
  // Stable alias reserved in SQL makes create timeouts/retries reconcilable.
  const {data,error}=await admin.auth.admin.createUser({email:alias,email_confirm:true,password:randomBytes(48).toString('base64url')});
  if(!error)return data.user.id;
  id=await sql('localizar_auth',[username]);if(id)return id;
  throw fail(503);
 }
 async function issue(a,username) {
  const id=randomUUID(),raw=randomBytes(32).toString('base64url');
  await sql('emitir_ativacao',[...a,username,id,digest('activation',id+'.'+raw)]);
  return {codigo:id+'.'+raw,validade_segundos:900};
 }
 async function dispatch(action,b,context={}) {
  const username=canonical(b.usuario);
  if(action==='login'||action==='ativar') {
   const inicio=Date.now();
   try {
    await limiter(context.ip||'unknown',username||'invalido');
    if(!username||typeof b.senha!=='string'||b.senha.length<12||b.senha.length>128)throw fail();
    if(action==='login') {
     if(Object.keys(b).some(k=>!['usuario','senha'].includes(k)))throw fail();
     const who=await sql('resolver_login',[username]);
     // Same Auth password verification work for unknown/disabled usernames.
     const client=createClient(url,publicKey,{auth:{...authOptions,storageKey:'server-login-'+randomUUID()}});
     const {data,error}=await client.auth.signInWithPassword({email:who?.alias||'nao-autorizado@identidade.invalid',password:b.senha});
     if(error||!who||data.user?.id!==who.id)throw fail();
     const claims=JSON.parse(Buffer.from(data.session.access_token.split('.')[1],'base64url'));
     if(!await sql('admitir_sessao',[who.id,claims.session_id,who.geracao])) {
      await client.auth.signOut();throw fail();
     }
     return {access_token:data.session.access_token,refresh_token:data.session.refresh_token};
    }
    if(Object.keys(b).some(k=>!['usuario','senha','codigo'].includes(k))||typeof b.codigo!=='string')throw fail();
    const [id,raw,...extra]=b.codigo.split('.');
    if(extra.length||!/^[-0-9a-f]{36}$/.test(id)||!raw||raw.length!==43)throw fail();
    const nonce=randomUUID();
    const claim=await sql('consumir_ativacao',[username,id,digest('activation',id+'.'+raw),nonce]);
    if(!claim)throw fail();
    // Consumed is durable BEFORE Auth. Never retry password writes with a code.
    try {
     const {error}=await admin.auth.admin.updateUserById(claim.id,{password:b.senha});
     if(error)throw fail(503);
     if(!await sql('finalizar_ativacao',[id,nonce,true]))throw fail(503);
    }catch {
     await sql('finalizar_ativacao',[id,nonce,false]).catch(()=>{});
     throw fail(503);
    }
    return {ok:true};
   } finally {await delay(Math.max(0,350-(Date.now()-inicio)));}
  }
  const a=await actor(context.token);
  if(action==='listar') {
   if(Object.keys(b).length)throw fail();
   return {operadores:await sql('listar_operadores',a)};
  }
  if(!username)throw fail();
  if(action==='cadastrar') {
   if(Object.keys(b).some(k=>!['usuario'].includes(k)))throw fail();
   const pending=await sql('preparar_cadastro',[...a,username]);
   const id=await ensureAuth(username,pending.alias);
   await sql('cadastrar_operador',[...a,username,id]);return {ok:true};
  }
  if(action==='codigo') {
   if(Object.keys(b).some(k=>!['usuario'].includes(k)))throw fail();
   return issue(a,username); // every explicit issue revokes the previous code
  }
  if(action==='gerir') {
   if(Object.keys(b).some(k=>!['usuario','acao','operacao'].includes(k))||!['ativar','bloquear','reativar'].includes(b.acao)||!/^[-0-9a-f]{36}$/.test(b.operacao||''))throw fail();
   // Database denial is committed first. Auth ban is additional protection.
   const lock=await pool.connect();
   try {
    // Use a direct/session PostgreSQL connection, never transaction pooling.
    await lock.query('select pg_advisory_lock(hashtextextended($1,0))',['auth-ban:'+username]);
    const r=await sql('gerir_operador',[...a,username,b.acao,b.operacao],lock);
    const current=await sql('estado_sincronizacao',[...a,username],lock);
    const {error}=await admin.auth.admin.updateUserById(current.id,{ban_duration:current.bloqueado?'876000h':'none'});
    return {...r,sincronizacao_auth:error?'pendente':'concluida'};
   }finally{await lock.query('select pg_advisory_unlock(hashtextextended($1,0))',['auth-ban:'+username]);lock.release();}
  }
  throw fail(404);
 }
 return {dispatch,sql,digest,ensureAuth};
}
