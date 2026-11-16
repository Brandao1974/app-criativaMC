// Generates an allowlisted static artifact. Never copies server/SQL/env/backups.
import {readFile,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const source=await readFile('sw.js','utf8');
const shell=/const SHELL = (\[[\s\S]*?\]);/.exec(source)?.[1];
if(!shell)throw new Error('Shell ausente');
const files=new Set([...shell.matchAll(/'([^']+)'/g)].map(m=>m[1]));
files.add('sw.js');
for(const file of [...files].filter(f=>f.endsWith('.html'))) {
 const html=await readFile(file,'utf8');
 for(const m of html.matchAll(/(?:href|src)="([^"#?]+)"/g))if(!m[1].includes(':'))files.add(m[1]);
}
const target=resolve('.local','distribuicao-'+randomUUID());await mkdir(target,{recursive:true});
const manifest=[];
for(const file of [...files].sort()) {
 if(!/^(?:[\w-]+\.html|sw\.js|manifest\.json|(?:js|css|images)\/[\w./-]+)$/.test(file)||file.includes('..')||file.includes('config.local'))throw new Error('Arquivo fora da allowlist');
 const bytes=await readFile(file),dest=resolve(target,file);await mkdir(dirname(dest),{recursive:true});await copyFile(file,dest);
 manifest.push({arquivo:file,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(resolve(target,'SHA256.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Artefato estático local: '+target+'; '+manifest.length+' arquivos. Não publicado.');
