import { readFile, readdir, writeFile } from 'node:fs/promises';
const dir = new URL('../supabase/migrations/', import.meta.url);
const files = (await readdir(dir)).filter(f => f.endsWith('_collaborative_ledger.sql'));
if (files.length !== 1) throw new Error('Gere uma migração com supabase migration new collaborative_ledger.');
const body = (await Promise.all(['schema','operations','import','access'].map(f =>
  readFile(new URL(`../database/${f}.sql`, import.meta.url), 'utf8')))).join('\n');
if (body.includes('$migration_body$')) throw new Error('Delimitador reservado');
await writeFile(new URL(files[0], dir), `-- Generated from database/*.sql; do not edit this copy.\n-- Local implementation only; remote execution requires separate approval.\nbegin;\ncreate schema if not exists private;\ncreate table if not exists private.schema_versions(version text primary key, checksum text not null);\nalter table private.schema_versions enable row level security;\nrevoke all on private.schema_versions from public, anon, authenticated;\ndo $migration$\ndeclare ddl text := $migration_body$${body}$migration_body$; existing text;\nbegin\n  perform pg_advisory_xact_lock(194762913);\n  select checksum into existing from private.schema_versions where version = 'collaborative_ledger_v1';\n  if found then\n    if existing <> md5(ddl) then raise exception 'Migration checksum mismatch'; end if;\n    return;\n  end if;\n  execute ddl;\n  insert into private.schema_versions values ('collaborative_ledger_v1',md5(ddl));\nend $migration$;\ncommit;\n`);
console.log(`Migração gerada: ${files[0]}`);
