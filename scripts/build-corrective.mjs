import { readFile, readdir, writeFile } from 'node:fs/promises';
const dir=new URL('../supabase/migrations/',import.meta.url);
const files=(await readdir(dir)).filter(f=>f.endsWith('_corrective_review.sql'));
if(files.length!==1)throw new Error('Gere a migração corrective_review com a CLI.');
const body=await readFile(new URL('../database/corrective.sql',import.meta.url),'utf8');
await writeFile(new URL(files[0],dir),`-- Generated from database/corrective.sql.\nbegin;\ndo $migration$\ndeclare ddl text := $corrective_body$${body}$corrective_body$; existing text;\nbegin\n perform pg_advisory_xact_lock(194762913);\n select checksum into existing from private.schema_versions where version='corrective_review_v2';\n if found then\n  if existing<>md5(ddl) then raise exception 'Migration checksum mismatch'; end if;\n  return;\n end if;\n execute ddl;\n insert into private.schema_versions values('corrective_review_v2',md5(ddl));\nend $migration$;\ncommit;\n`);
console.log('Migração corretiva gerada: '+files[0]);
