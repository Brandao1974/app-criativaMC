// Offline dry-run only. Does not connect to any database or change the source.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { planejarImportacao } from '../js/importacao.js';
const [arquivo,origem,saida]=process.argv.slice(2);
if(!arquivo || !origem || !saida)throw new Error('Uso: node scripts/importar-legado.mjs backup.json UUID-origem pasta-privada-saida');
const destino=resolve(saida),repo=resolve('.'),rel=relative(repo,destino);
if(!(rel==='..' || rel.startsWith('..'+sep) || isAbsolute(rel)) && rel!=='.local' && !rel.startsWith('.local'+sep)) {
  throw new Error('Relatório com dados privados só pode ser salvo fora do repositório ou em .local/ (ignorado).');
}
const bytes=await readFile(arquivo);
const sha256=createHash('sha256').update(bytes).digest('hex');
const plano=planejarImportacao(JSON.parse(bytes.toString('utf8')),origem);
await mkdir(destino,{recursive:true});
// wx prevents overwriting an earlier reviewed plan.
await writeFile(resolve(destino,`plano-${sha256}.json`),JSON.stringify({...plano,sha256},null,2),{flag:'wx'});
console.log(JSON.stringify({sha256,totais:plano.totais,quarentena:plano.quarentena.length}));
