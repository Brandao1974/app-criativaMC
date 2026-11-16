// Administrative LOCAL-ONLY runner; never bundled into the browser.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { planejarImportacao } from '../js/importacao.js';
export function validarPlano(bytes,plano) {
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==plano.sha256)throw new Error('SHA-256 do backup diverge do plano aprovado.');
  const refeito=planejarImportacao(JSON.parse(bytes.toString('utf8')),plano.origem_id);
  const {sha256,...conteudo}=plano;
  if(JSON.stringify(refeito)!==JSON.stringify(conteudo))throw new Error('Plano difere da conversão reproduzida.');
  if(refeito.quarentena.length || !refeito.validas.length)throw new Error('Resolva a quarentena ou o lote vazio antes da execução.');
  return refeito;
}
export async function aplicarPlano(client,bytes,plano) {
  const refeito=validarPlano(bytes,plano);
  await client.query('begin');
  try {
    // One exclusive maintenance lock for the ENTIRE batch; application writes
    // acquire the shared lock and cannot interleave with this batch.
    await client.query('select pg_advisory_xact_lock(194762914)');
    const identidade=(await client.query('select private.identidade_importacao() as i')).rows[0].i;
    for(const obra of refeito.validas)await client.query('select private.importar_obra($1,$2,$3,$4,$5)',[
      obra.origem_id,obra.chave,plano.sha256,JSON.stringify(obra.convertido),JSON.stringify(obra.bruto)]);
    const t=refeito.totais;
    const esperado={obras_validas:t.obras_validas,movimentos:t.movimentos,eventos:t.eventos,
      entradas_centavos:t.entradas_centavos,custos_centavos:t.custos_centavos,saldo_centavos:t.saldo_centavos};
    const totais=(await client.query('select private.conferir_importacao($1,$2) as t',[plano.sha256,JSON.stringify(esperado)])).rows[0].t;
    await client.query('commit');return {identidade,sha256:plano.sha256,totais};
  }catch(error){await client.query('rollback');throw error;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [backup,arquivoPlano,confirmacao]=process.argv.slice(2);
  if(!backup || !arquivoPlano || confirmacao!=='--confirmar-local')throw new Error('Uso: node scripts/aplicar-importacao-local.mjs backup.json plano.json --confirmar-local');
  const url=new URL(process.env.LOCAL_IMPORT_PG_URL || '');
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Esta etapa permite somente PostgreSQL local isolado.');
  const client=new pg.Client({connectionString:url.href});await client.connect();
  try{
    const resultado=await aplicarPlano(client,await readFile(backup),JSON.parse(await readFile(arquivoPlano,'utf8')));
    console.log(JSON.stringify(resultado));
  }finally{await client.end();}
}
