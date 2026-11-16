import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';
export const bootstrap = `create role anon; create role authenticated;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;`;
// Historical 54-case suite remains pinned to reviewed v1/v2. v3 has separate
// real-Auth and financial tests; passing v2 is never presented as proving v3.
export async function migration({latest=false}={}) {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')&&(latest||!f.endsWith('_three_operator_access.sql'))).sort();
  return (await Promise.all(files.map(file=>readFile(new URL(file,dir),'utf8')))).join('\n');
}
export async function seed(db) {
  await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');
    insert into public.profiles(id,nome) values ('${A}','Gustavo'),('${B}','Ivan'),('${C}','Terceiro');
    insert into public.app_membros(usuario_id,lugar) values ('${A}','gustavo'),('${B}','ivan');`);
  await db.exec(`insert into private.importacao_operadores(login_name,ator_id,valido_ate)
    values(session_user,'${A}',now()+interval '1 hour');`);
}
export async function fixture() {
  const db = new PGlite();
  await db.exec(bootstrap);
  await db.exec(await migration());
  await seed(db);
  return db;
}
export async function as(db, uid, fn, role = 'authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || '']);
    const r = await fn(db);
    await db.exec('commit');
    return r;
  } catch (e) { await db.exec('rollback'); throw e; }
}
export async function command(db, uid, action, data, op = randomUUID()) {
  return as(db, uid, async () => (await db.query(
    'select public.executar($1,$2::jsonb,$3::uuid) as r', [action, JSON.stringify(data), op])).rows[0].r);
}
export async function state(db, uid = A) {
  return as(db,uid,async()=> (await db.query('select public.ler_estado() as s')).rows[0].s);
}
