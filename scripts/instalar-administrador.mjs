// Operator-run CLI. Never executed against a remote target by build/test.
import pg from 'pg';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {criarAcesso} from '../server/access.mjs';
export async function instalarAdministrador({pool,access,recuperarUUID}) {
 const c=await pool.connect();
 try {
  await c.query('select pg_advisory_lock(194762916)');
  if(recuperarUUID) {
   await c.query('select private.recuperar_admin($1)',[recuperarUUID]);
  } else {
   const pending=(await c.query("select private.reservar_identidade('ildebrando') as r")).rows[0].r;
   const id=await access.ensureAuth('ildebrando',pending.alias);
   await c.query('select private.instalar_admin($1)',[id]);
  }
  const id=(await c.query('select usuario_id from private.administracao_app')).rows[0].usuario_id;
  if(recuperarUUID&&id!==recuperarUUID)throw new Error('UUID original divergente');
  const convite=randomUUID(),raw=randomBytes(32).toString('base64url');
  await c.query('select private.criar_ativacao($1,$1,$2,$3)',[id,convite,access.digest('activation',convite+'.'+raw)]);
  return {usuario_id:id,codigo:convite+'.'+raw,validade_segundos:900};
 }finally{await c.query('select pg_advisory_unlock(194762916)');c.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 if(!process.argv.includes('--confirmar-instalacao')||!process.env.INSTALL_DATABASE_URL)throw new Error('Exige INSTALL_DATABASE_URL e --confirmar-instalacao; leia o runbook.');
 if(!process.stdout.isTTY)throw new Error('Execute em terminal interativo privado, sem redirecionamento.');
 const pool=new pg.Pool({connectionString:process.env.INSTALL_DATABASE_URL,max:3});
 const access=criarAcesso({pool,url:process.env.SUPABASE_URL,publicKey:process.env.SUPABASE_PUBLIC_KEY,secretKey:process.env.SUPABASE_SECRET_KEY,pepper:process.env.ACCESS_PEPPER});
 try {
  const flag=process.argv.indexOf('--recuperar-uuid');
  if(flag>=0&&!/^[0-9a-f-]{36}$/.test(process.argv[flag+1]||''))throw new Error('Informe UUID original');
  const result=await instalarAdministrador({pool,access,recuperarUUID:flag>=0?process.argv[flag+1]:undefined});
  // The only intentional secret output: interactive one-time delivery. No file.
  console.log('Ildebrando UUID: '+result.usuario_id+'\nCódigo individual (15 minutos; exibição única): '+result.codigo);
 }finally{await pool.end();}
}
