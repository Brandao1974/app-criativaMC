import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const path=new URL('../sw.js',import.meta.url);
const src=await readFile(path,'utf8');
const shell=/const SHELL = (\[[\s\S]*?\]);/.exec(src);
if(!shell)throw new Error('Shell não encontrado');
// Literal list is maintained in sw.js; no evaluation of arbitrary source.
const assets=[...shell[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
const hash=createHash('sha256');
for(const file of assets){hash.update(file);hash.update(await readFile(new URL('../'+file,import.meta.url)));}
const build='criativamc-'+hash.digest('hex').slice(0,16);
await writeFile(path,src.replace(/const BUILD = '[^']+';/,`const BUILD = '${build}';`));
console.log('Build PWA: '+build);
