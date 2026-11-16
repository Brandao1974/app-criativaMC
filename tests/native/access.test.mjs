import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {criarAcesso,canonical} from '../../server/access.mjs';
import {criarServidorAcesso} from '../../server/http.mjs';
import {instalarAdministrador} from '../../scripts/instalar-administrador.mjs';
import {criarHandlerAcesso} from '../../server/handler.mjs';
import {criarGateway} from '../../js/acesso.js';
import {criarServicos} from '../../js/servicos.js';
import {iniciar} from '../../js/app.js';
import {JSDOM} from 'jsdom';
import {planejarImportacao} from '../../js/importacao.js';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';
import {portaLivre} from '../../scripts/local-postgres.mjs';
const enabled=!!process.env.LOCAL_AUTH_ADMIN_KEY;
const opts={skip:!enabled?'Execute npm run test:access:isolated':false};
let owner,pool,access,installer,auth,server,http,adminId,initial,adminToken;
const passwords=Object.fromEntries(['ildebrando','edson','ivan'].map(u=>[u,randomBytes(24).toString('base64url')]));
const tokens={},ids={};
const context=token=>({token,ip:randomUUID()});
const call=(action,b={},token=adminToken)=>access.dispatch(action,b,context(token));
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
async function login(usuario) {return call('login',{usuario,senha:passwords[usuario]});}
async function code(usuario) {return call('codigo',{usuario});}
async function redeem(usuario,codigo,senha=passwords[usuario]) {return call('ativar',{usuario,codigo,senha});}
async function gatewaySQL(name,args=[]) {return access.sql(name,args);}
async function dbAs(token,query,args=[]) {
 const c=await owner.connect();try {
  await c.query('begin');await c.query('set local role authenticated');
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims(token))]);
  const r=await c.query(query,args);await c.query('commit');return r;
 }catch(e){await c.query('rollback');throw e;}finally{c.release();}
}
async function finance(token,action,data,op=randomUUID()) {
 return (await dbAs(token,'select public.executar_com_identidade($1,$2,$3,$4) as r',[claims(token).sub,action,data,op])).rows[0].r;
}
async function state(token) {return (await dbAs(token,'select public.ler_estado() as s')).rows[0].s;}
before(async()=>{
 if(!enabled)return;
 const url=process.env.LOCAL_SUPABASE_URL;
 if(new URL(url).hostname!=='127.0.0.1')throw new Error('Only isolated loopback stack');
 owner=new pg.Pool({connectionString:process.env.LOCAL_AUTH_PG_URL,max:10});
 pool=new pg.Pool({connectionString:process.env.LOCAL_AUTH_PG_URL,options:'-c role=app_gateway',max:10});
 const settings={url,publicKey:process.env.LOCAL_SUPABASE_PUBLIC_KEY,secretKey:process.env.LOCAL_AUTH_ADMIN_KEY,pepper:randomBytes(48).toString('base64url')};
 access=criarAcesso({...settings,pool});installer=criarAcesso({...settings,pool:owner});
 auth=createClient(url,settings.secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 server=criarServidorAcesso(access,{origins:['https://app.fixture.test']});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));http='http://127.0.0.1:'+server.address().port;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));await pool?.end();await owner?.end();});

test('AC01 instalação privada cria exclusivamente Ildebrando, sem acesso parcial',opts,async()=>{
 initial=await instalarAdministrador({pool:owner,access:installer});adminId=initial.usuario_id;ids.ildebrando=adminId;
 const row=(await owner.query('select * from private.administracao_app')).rows;
 assert.equal(row.length,1);assert.equal(row[0].usuario_id,adminId);
 await assert.rejects(login('ildebrando'));
 await assert.rejects(gatewaySQL('instalar_admin',[adminId]),{code:'42501'});
});
test('AC02 instalação concorrente/repetida conserva UUID e singleton',opts,async()=>{
 const results=await Promise.all([instalarAdministrador({pool:owner,access:installer}),instalarAdministrador({pool:owner,access:installer})]);
 assert.ok(results.every(r=>r.usuario_id===adminId));
 // Last issuance wins; locate matching emitted invitation without logging codes.
 for(const r of results) {
  const s=(await owner.query('select estado from private.ativacoes where id=$1',[r.codigo.split('.')[0]])).rows[0];
  if(s.estado==='emitida')initial=r;
 }
 assert.equal((await owner.query('select count(*) from public.operadores')).rows[0].count,'1');
});
test('AC03 primeiro acesso e login por username dos três sem e-mail',opts,async()=>{
 await redeem('ildebrando',initial.codigo);adminToken=(await login('ildebrando')).access_token;tokens.ildebrando=adminToken;
 for(const usuario of ['edson','ivan']) {
  await call('cadastrar',{usuario});const c=await code(usuario);await redeem(usuario,c.codigo);
  tokens[usuario]=(await login(usuario)).access_token;ids[usuario]=claims(tokens[usuario]).sub;
 }
 assert.equal(canonical(' ILDEBRANDO '),'ildebrando');assert.equal(canonical('İVAN'),null);
 for(const token of Object.values(tokens))assert.equal((await state(token)).usuario_id,claims(token).sub);
});
test('AC04 Gustavo com JWT Auth preexistente perde RPC/RLS e gateway',opts,async()=>{
 const {data,error}=await auth.auth.signInWithPassword({email:process.env.LOCAL_QA_A_EMAIL,password:process.env.LOCAL_QA_A_PASSWORD});assert.ifError(error);
 await assert.rejects(state(data.session.access_token),{code:'42501'});
 assert.equal((await dbAs(data.session.access_token,'select * from public.obras')).rowCount,0);
 await assert.rejects(call('login',{usuario:'gustavo',senha:process.env.LOCAL_QA_A_PASSWORD}));
});
test('AC05 erros uniformes, CORS fechado e limite persistido por origem/usuário',opts,async()=>{
 const post=(body,origin='https://app.fixture.test')=>fetch(http+'/acesso/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const a=await post({usuario:'ninguem',senha:'invalida-123456'}),b=await post({usuario:'ivan',senha:'invalida-123456'});
 assert.equal(a.status,b.status);assert.equal(await a.text(),await b.text());assert.equal(a.headers.get('cache-control'),'no-store');
 assert.equal((await post({},'https://evil.test')).status,403);
 assert.equal((await post({},'null')).status,403);
 const ctx={ip:randomUUID()};let limited=false;
 for(let i=0;i<11;i++)try{await access.dispatch('login',{usuario:'invalido',senha:'invalida-123456'},ctx);}catch(e){if(e.status===429)limited=true;}
 assert.equal(limited,true);
});
test('AC06 login direto no Auth não admite sessão no aplicativo',opts,async()=>{
 const alias=(await owner.query("select alias from private.identidades_auth where usuario='ivan'")).rows[0].alias;
 const {data,error}=await auth.auth.signInWithPassword({email:alias,password:passwords.ivan});assert.ifError(error);
 await assert.rejects(state(data.session.access_token),{code:'42501'});
});
test('AC07 metadados e payloads não promovem administrador',opts,async()=>{
 await auth.auth.admin.updateUserById(ids.edson,{user_metadata:{admin:true,role:'service_role',usuario:'ildebrando'}});
 await assert.rejects(call('listar',{},tokens.edson));
 await assert.rejects(call('cadastrar',{usuario:'edson',admin:true}));
 assert.equal((await owner.query('select usuario_id from private.administracao_app')).rows[0].usuario_id,adminId);
});
test('AC08 Edson/Ivan não executam nenhuma ação administrativa',opts,async()=>{
 for(const token of [tokens.edson,tokens.ivan])for(const [action,body] of [['listar',{}],['cadastrar',{usuario:'edson'}],['codigo',{usuario:'ivan'}],['gerir',{usuario:'ivan',acao:'bloquear',operacao:randomUUID()}]])await assert.rejects(call(action,body,token));
 await assert.rejects(dbAs(tokens.edson,'select private.listar_operadores($1,$2)',[ids.edson,claims(tokens.edson).session_id]),{code:'42501'});
});
test('AC09 somente Ildebrando gerencia, com idempotência e auditoria',opts,async()=>{
 const op=randomUUID(),b={usuario:'edson',acao:'bloquear',operacao:op};await call('gerir',b);await call('gerir',b);
 const count=(await owner.query("select count(*) from public.auditoria_eventos where acao='BLOQUEAR' and entidade_id=$1",[ids.edson])).rows[0].count;
 assert.equal(count,'1');await call('gerir',{usuario:'edson',acao:'reativar',operacao:randomUUID()});tokens.edson=(await login('edson')).access_token;
});
test('AC10 lista fechada e cadastro repetido sem takeover',opts,async()=>{
 for(const usuario of ['gustavo','quarto','ildebrando'])await assert.rejects(call('cadastrar',{usuario}));
 await call('cadastrar',{usuario:'edson'});assert.equal((await owner.query("select usuario_id from public.operadores where usuario='edson'")).rows[0].usuario_id,ids.edson);
});
test('AC11 administrador único não pode se bloquear/remover',opts,async()=>{
 await assert.rejects(call('gerir',{usuario:'ildebrando',acao:'bloquear',operacao:randomUUID()}));
 await assert.rejects(call('gerir',{usuario:'ildebrando',acao:'remover',operacao:randomUUID()}));
});
test('AC12 código forte, destinatário/prazo/finalidade e nenhum bruto no banco',opts,async()=>{
 const c=await code('edson'),[id,raw]=c.codigo.split('.');assert.equal(raw.length,43);
 const a=(await owner.query('select * from private.ativacoes where id=$1',[id])).rows[0];
 assert.equal(a.usuario_id,ids.edson);assert.equal(a.finalidade,'credencial');assert.equal(a.expira_em-a.criada_em,900000);
 assert.equal(a.digest.includes(raw),false);await redeem('edson',c.codigo);tokens.edson=(await login('edson')).access_token;
});
test('AC13 senha pessoal é definida/verificada pelo Auth real',opts,async()=>{
 const c=await code('edson');await redeem('edson',c.codigo);
 const alias=(await owner.query("select alias from private.identidades_auth where usuario='edson'")).rows[0].alias;
 const r=await auth.auth.signInWithPassword({email:alias,password:passwords.edson});assert.ifError(r.error);
 const columns=(await owner.query("select column_name from information_schema.columns where table_schema in ('private','public')")).rows.map(r=>r.column_name);
 assert.ok(!columns.some(c=>/password|senha/.test(c)));tokens.edson=(await login('edson')).access_token;
});
test('AC14 usado, substituído, expirado e revogado não reutilizam código',opts,async()=>{
 const old=await code('edson'),fresh=await code('edson');await assert.rejects(redeem('edson',old.codigo));
 await owner.query("update private.ativacoes set expira_em=now()-interval '1 second' where id=$1",[fresh.codigo.split('.')[0]]);
 await assert.rejects(redeem('edson',fresh.codigo));
 const current=await code('edson');await redeem('edson',current.codigo);await assert.rejects(redeem('edson',current.codigo));tokens.edson=(await login('edson')).access_token;
});
test('AC15 resgates simultâneos em conexões independentes: só um vencedor',opts,async()=>{
 const c=await code('edson');const r=await Promise.allSettled([redeem('edson',c.codigo),redeem('edson',c.codigo)]);
 assert.equal(r.filter(r=>r.status==='fulfilled').length,1);tokens.edson=(await login('edson')).access_token;
});
test('AC16 código não muda admin, autorização ou bloqueio; campos extras recusados',opts,async()=>{
 const c=await code('edson');await assert.rejects(call('ativar',{usuario:'edson',codigo:c.codigo,senha:passwords.edson,admin:true}));
 await assert.rejects(redeem('ivan',c.codigo));await redeem('edson',c.codigo);
 assert.equal((await owner.query('select usuario_id from private.administracao_app')).rows[0].usuario_id,adminId);tokens.edson=(await login('edson')).access_token;
});
test('AC17 bloqueio entre consumo e conclusão invalida geração e nega acesso',opts,async()=>{
 const c=await code('edson'),id=c.codigo.split('.')[0],nonce=randomUUID();
 const r=await gatewaySQL('consumir_ativacao',['edson',id,access.digest('activation',c.codigo),nonce]);assert.equal(r.id,ids.edson);
 await call('gerir',{usuario:'edson',acao:'bloquear',operacao:randomUUID()});
 assert.equal(await gatewaySQL('finalizar_ativacao',[id,nonce,true]),false);await assert.rejects(login('edson'));
 await call('gerir',{usuario:'edson',acao:'reativar',operacao:randomUUID()});
 const fresh=await code('edson');await redeem('edson',fresh.codigo);tokens.edson=(await login('edson')).access_token;
});
test('AC18 Auth altera senha mas falha final deixa código consumido e acesso fechado',opts,async()=>{
 const c=await code('edson'),id=c.codigo.split('.')[0],nonce=randomUUID();
 await gatewaySQL('consumir_ativacao',['edson',id,access.digest('activation',c.codigo),nonce]);
 assert.ifError((await auth.auth.admin.updateUserById(ids.edson,{password:passwords.edson})).error);
 await assert.rejects(login('edson'));await assert.rejects(redeem('edson',c.codigo));
 assert.equal(await gatewaySQL('finalizar_ativacao',[id,randomUUID(),true]),false);
 const fresh=await code('edson');await redeem('edson',fresh.codigo);tokens.edson=(await login('edson')).access_token;
});
test('AC19 reconciliação de criação Auth parcial reutiliza alias/UUID',opts,async()=>{
 const r=await gatewaySQL('preparar_cadastro',[adminId,claims(adminToken).session_id,'ivan']);
 const id=await access.ensureAuth('ivan',r.alias);assert.equal(id,ids.ivan);
 const concurrent=await Promise.all([call('cadastrar',{usuario:'ivan'}),call('cadastrar',{usuario:'ivan'})]);assert.equal(concurrent.length,2);
 assert.equal((await owner.query('select count(*) from public.operadores')).rows[0].count,'3');
});
test('AC20 autorização e credencial são condições independentes obrigatórias',opts,async()=>{
 await owner.query('update public.operadores set autorizado=false where usuario_id=$1',[ids.edson]);await assert.rejects(login('edson'));
 await owner.query('update public.operadores set autorizado=true,credencial_pronta=false where usuario_id=$1',[ids.edson]);await assert.rejects(login('edson'));
 const c=await code('edson');await redeem('edson',c.codigo);tokens.edson=(await login('edson')).access_token;
});
test('AC21 bloqueio/reativação não ressuscita JWT nem refresh antigo',opts,async()=>{
 const session=await login('edson'),old=session.access_token;
 await call('gerir',{usuario:'edson',acao:'bloquear',operacao:randomUUID()});await assert.rejects(state(old));
 await call('gerir',{usuario:'edson',acao:'reativar',operacao:randomUUID()});await assert.rejects(state(old));
 const client=createClient(process.env.LOCAL_SUPABASE_URL,process.env.LOCAL_SUPABASE_PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const refreshed=await client.auth.refreshSession({refresh_token:session.refresh_token});
 if(!refreshed.error)await assert.rejects(state(refreshed.data.session.access_token));
 tokens.edson=(await login('edson')).access_token;
});
test('AC22 refresh mantém session_id e autorização; logout invalida JWT ainda vigente',opts,async()=>{
 const s=await login('ivan');
 const client=createClient(process.env.LOCAL_SUPABASE_URL,process.env.LOCAL_SUPABASE_PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const refreshed=await client.auth.refreshSession({refresh_token:s.refresh_token});assert.ifError(refreshed.error);
 assert.equal(claims(refreshed.data.session.access_token).session_id,claims(s.access_token).session_id);await state(refreshed.data.session.access_token);
 await client.auth.signOut();await assert.rejects(state(s.access_token),{code:'42501'});
 tokens.ivan=(await login('ivan')).access_token;
});
test('AC23 seis pares ordenados aprovam/rejeitam; autoaprovação sempre negada',opts,async()=>{
 for(const a of Object.keys(tokens))for(const b of Object.keys(tokens))if(a!==b) {
  const obra=await finance(tokens[a],'criar_obra',{cliente:'QA '+a+b,valor_centavos:'10000'});
  for(const decisao of ['aprovada','rejeitada']) {
   const m=await finance(tokens[a],'registrar_movimento',{obra_id:obra.id,tipo:'entrada',descricao:'Teste sintético',valor_centavos:'100'});
   const p=await finance(tokens[a],'solicitar_exclusao',{movimento_id:m.id,motivo:'Teste aprovação'});
   await assert.rejects(finance(tokens[a],'decidir_exclusao',{solicitacao_id:p.id,decisao,motivo:'Auto proibida'}),{code:'42501'});
   const op=randomUUID(),body={solicitacao_id:p.id,decisao,motivo:'Outro operador'};
   const r=await finance(tokens[b],'decidir_exclusao',body,op);assert.deepEqual(await finance(tokens[b],'decidir_exclusao',body,op),r);
  }
 }
});
test('AC24 solicitante bloqueado mantém pedido pendente sem estorno',opts,async()=>{
 const obra=await finance(tokens.edson,'criar_obra',{cliente:'QA bloqueio',valor_centavos:'100'});
 const m=await finance(tokens.edson,'registrar_movimento',{obra_id:obra.id,tipo:'entrada',descricao:'Entrada QA',valor_centavos:'100'});
 const p=await finance(tokens.edson,'solicitar_exclusao',{movimento_id:m.id,motivo:'Teste pendente'});
 await call('gerir',{usuario:'edson',acao:'bloquear',operacao:randomUUID()});
 await assert.rejects(finance(tokens.ivan,'decidir_exclusao',{solicitacao_id:p.id,decisao:'aprovada',motivo:'Não permitido'}),{code:'42501'});
 assert.equal((await owner.query('select estado from public.exclusao_solicitacoes where id=$1',[p.id])).rows[0].estado,'pendente');
 await call('gerir',{usuario:'edson',acao:'reativar',operacao:randomUUID()});tokens.edson=(await login('edson')).access_token;
});
test('AC25 três operadores compartilham mesmos IDs, totais e financeiro',opts,async()=>{
 const snapshots=await Promise.all(Object.values(tokens).map(state));
 for(const s of snapshots.slice(1)){assert.deepEqual(s.obras,snapshots[0].obras);assert.deepEqual(s.movimentos,snapshots[0].movimentos);assert.equal(s.saldo_centavos,snapshots[0].saldo_centavos);}
});
test('AC26 recuperação financeira por UUID continua vinculada ao ator',opts,async()=>{
 const op=randomUUID(),r=await finance(tokens.edson,'criar_obra',{cliente:'QA recuperação',valor_centavos:'1'},op);
 const read=async(token,expected)=>(await dbAs(token,'select public.recuperar_operacao($1,$2,false) as r',[expected,op])).rows[0].r;
 assert.equal((await read(tokens.edson,ids.edson)).resultado.id,r.id);
 await assert.rejects(read(tokens.ivan,ids.edson),{code:'42501'});
 assert.equal((await read(tokens.ivan,ids.ivan)).estado,'ausente');
});
test('AC27 navegador/servidor não persistem senha/código; erros não refletem corpo',opts,async()=>{
 const src=await readFile(new URL('../../js/acesso.js',import.meta.url),'utf8');assert.ok(!/localStorage|sessionStorage|console\./.test(src));
 const secret='nao-refletir-'+randomUUID();const r=await fetch(http+'/acesso/ativar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:'ninguem',senha:secret,codigo:secret})});
 assert.equal((await r.text()).includes(secret),false);
 const audit=JSON.stringify((await owner.query("select depois from public.auditoria_eventos where entidade='operadores'")).rows);
 for(const p of Object.values(passwords))assert.equal(audit.includes(p),false);
});
test('AC28 recuperação offline preserva UUID original e não promove terceiros',opts,async()=>{
 await assert.rejects(owner.query('select private.recuperar_admin($1)',[ids.edson]));
 await assert.rejects(gatewaySQL('recuperar_admin',[adminId]),{code:'42501'});
 const recovered=await instalarAdministrador({pool:owner,access:installer,recuperarUUID:adminId});assert.equal(recovered.usuario_id,adminId);
 await assert.rejects(state(adminToken));await redeem('ildebrando',recovered.codigo);adminToken=(await login('ildebrando')).access_token;tokens.ildebrando=adminToken;
 assert.equal((await owner.query("select count(*) from public.auditoria_eventos where acao='RECUPERACAO_OFFLINE'")).rows[0].count,'1');
});
test('AC29 mudanças de metadados Auth não alteram diretório/admin/permissão',opts,async()=>{
 await auth.auth.admin.updateUserById(ids.ivan,{user_metadata:{usuario:'ildebrando',admin:true}});
 assert.equal((await owner.query('select usuario_id from private.administracao_app')).rows[0].usuario_id,adminId);
 await assert.rejects(call('listar',{},tokens.ivan));assert.equal((await state(tokens.ivan)).usuario_id,ids.ivan);
});
test('AC30 tabelas/funções privadas e caminhos legados não aceitam DML/EXECUTE',opts,async()=>{
 for(const table of ['identidades_auth','ativacoes','administracao_app','sessoes_app','operacoes_identidade'])await assert.rejects(dbAs(tokens.edson,`select * from private.${table}`),{code:'42501'});
 await assert.rejects(dbAs(adminToken,'update public.operadores set autorizado=true'),{code:'42501'});
 await assert.rejects(dbAs(adminToken,'select * from public.app_membros'),{code:'42501'});
 const procs=(await owner.query("select p.proname,pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prokind='f'")).rows;
 assert.ok(!procs.filter(r=>['executar','exigir_membro','membro_ativo','conferir_decisao','exigir_importador'].includes(r.proname)).some(r=>r.def.includes('app_membros')));
 const publicExec=(await owner.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE')")).rows;
 assert.deepEqual(publicExec,[]);
});
test('AC31 formulários reais de ativação/login, gateway, SDK e PostgREST v3',opts,async()=>{
 const c=await code('edson');
 const dom=new JSDOM(await readFile(new URL('../../login.html',import.meta.url),'utf8'),{url:'http://127.0.0.1/login.html'});
 const destinos=[];globalThis.document=dom.window.document;
 globalThis.window={localStorage:dom.window.localStorage,navigator:{},location:{replace:p=>destinos.push(p)}};
 const client=createClient(process.env.LOCAL_SUPABASE_URL,process.env.LOCAL_SUPABASE_PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const servicos=criarServicos(client,criarGateway(client,http+'/acesso'));
 await iniciar(servicos);
 const field=id=>dom.window.document.getElementById(id);
 assert.equal(field('usuario').type,'text');
 field('ativacao-usuario').value='edson';field('ativacao-codigo').value=c.codigo;field('ativacao-senha').value=passwords.edson;
 const submit=async(id)=>{
  field(id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const deadline=Date.now()+15000;while(dom.window.document.body.dataset.ocupado==='true'){if(Date.now()>deadline)throw new Error('Form timeout');await new Promise(r=>setTimeout(r,20));}
 };
 await submit('form-ativacao');assert.equal(field('ativacao-codigo').value,'');assert.equal(field('ativacao-senha').value,'');
 assert.match(field('app-mensagem').textContent,/Senha definida/);
 field('usuario').value='edson';field('senha').value=passwords.edson;await submit('form-login');
 assert.ok(destinos.includes('dashboard.html'));assert.equal(field('senha').value,'');
 const result=await client.rpc('ler_estado');assert.ifError(result.error);assert.equal(result.data.usuario_id,ids.edson);
 assert.equal(dom.window.localStorage.length,0);tokens.edson=(await login('edson')).access_token;dom.window.close();
});
test('AC32 financeiro v3 concorrente: um efeito, decisão única e estorno exato',opts,async()=>{
 const op=randomUUID(),body={cliente:'QA concorrência v3',valor_centavos:'900'};
 const r=await Promise.all([finance(tokens.edson,'criar_obra',body,op),finance(tokens.edson,'criar_obra',body,op)]);assert.equal(r[0].id,r[1].id);
 const m=await finance(tokens.edson,'registrar_movimento',{obra_id:r[0].id,tipo:'entrada',descricao:'QA nativo',valor_centavos:'900'});
 const p=await finance(tokens.edson,'solicitar_exclusao',{movimento_id:m.id,motivo:'QA concorrência'});
 const decision={solicitacao_id:p.id,decisao:'aprovada',motivo:'QA conferido'};
 const decisions=await Promise.allSettled([finance(tokens.ivan,'decidir_exclusao',decision),finance(adminToken,'decidir_exclusao',decision)]);
 assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);
 const s=await state(adminToken);assert.equal(s.movimentos.filter(x=>x.estorna_id===m.id).length,1);assert.equal(s.resumos.find(x=>x.obra_id===r[0].id).saldo_centavos,'0');
});
test('AC33 importação v3 usa diretório novo e mantém idempotência',opts,async()=>{
 const origem=randomUUID();const raw={formato:'app-criativaMC-localstorage-bruto-v1',valoresBrutos:{obras:JSON.stringify([{cliente:'QA importação v3',valor:'1.00',status:'Negociacao',entradas:[],custos:[],historico:[]}])}};
 const item=planejarImportacao(raw,origem).validas[0];assert.ok(item);
 await owner.query("insert into private.importacao_operadores(login_name,ator_id,valido_ate) values(session_user,$1,now()+interval '1 hour')",[adminId]);
 const args=[origem,item.chave,'c'.repeat(64),item.convertido,item.bruto];
 const query='select private.importar_obra($1,$2,$3,$4,$5) as id';
 const r=await owner.query(query,args),again=await owner.query(query,args);assert.equal(r.rows[0].id,again.rows[0].id);
 await owner.query('update private.importacao_operadores set ator_id=$1',[process.env.LOCAL_LEGACY_GUSTAVO]);
 await assert.rejects(owner.query('select private.identidade_importacao()'),{code:'42501'});
});
test('AC34 senha alterada fora da ativação ou duas alterações concorrentes falham fechadas',opts,async()=>{
 const c=await code('edson'),id=c.codigo.split('.')[0],nonce=randomUUID();
 await gatewaySQL('consumir_ativacao',['edson',id,access.digest('activation',c.codigo),nonce]);
 for(let i=0;i<2;i++)assert.ifError((await auth.auth.admin.updateUserById(ids.edson,{password:passwords.edson+'x'.repeat(i+1)})).error);
 assert.equal(await gatewaySQL('finalizar_ativacao',[id,nonce,true]),false);await assert.rejects(login('edson'));
 const fresh=await code('edson');await redeem('edson',fresh.codigo);const token=(await login('edson')).access_token;
 assert.ifError((await auth.auth.admin.updateUserById(ids.edson,{password:passwords.edson+'late'})).error);
 await assert.rejects(state(token));await assert.rejects(login('edson'));
 const final=await code('edson');await redeem('edson',final.codigo);tokens.edson=(await login('edson')).access_token;
});
test('AC35 replay de bloqueio antigo não bane operador já reativado',opts,async()=>{
 const old={usuario:'edson',acao:'bloquear',operacao:randomUUID()};
 await call('gerir',old);await call('gerir',{usuario:'edson',acao:'reativar',operacao:randomUUID()});await call('gerir',old);
 tokens.edson=(await login('edson')).access_token;await state(tokens.edson);
});
test('AC36 adapter Edge: CORS/preflight, limite do corpo e administração real',opts,async()=>{
 const handler=criarHandlerAcesso(access,{origins:['https://app.fixture.test']});
 const req=(body,headers={})=>new Request('https://edge.fixture.test/functions/v1/acesso/listar',{method:'POST',headers:{Origin:'https://app.fixture.test','Content-Type':'application/json',Authorization:'Bearer '+adminToken,...headers},body:JSON.stringify(body)});
 assert.equal((await handler(req({}),randomUUID())).status,200);
 assert.equal((await handler(req({},{Authorization:'Bearer '+tokens.edson}),randomUUID())).status,403);
 assert.equal((await handler(req({},{Origin:'https://evil.test'}),randomUUID())).status,403);
 assert.equal((await handler(req({excesso:'x'.repeat(5000)}),randomUUID())).status,413);
 assert.equal((await handler(new Request('https://edge.fixture.test/acesso/login',{method:'OPTIONS',headers:{Origin:'https://app.fixture.test'}}))).status,204);
});
test('AC37 cinco tentativas invalidam somente convite; reemissão permite primeiro acesso',opts,async()=>{
 const c=await code('edson'),id=c.codigo.split('.')[0];
 for(let i=0;i<5;i++)await assert.rejects(redeem('edson',id+'.'+'z'.repeat(43)));
 await assert.rejects(redeem('edson',c.codigo));
 const a=(await owner.query('select tentativas from private.ativacoes where id=$1',[id])).rows[0];assert.equal(a.tentativas,5);
 const fresh=await code('edson');await redeem('edson',fresh.codigo);tokens.edson=(await login('edson')).access_token;
});
test('AC38 entrypoint Edge executa em Deno real: login e administração locais',{
 skip:!enabled||!process.env.LOCAL_DENO_BIN?'Deno local não preparado':false
},async()=>{
 const port=await portaLivre(),dburl=new URL(process.env.LOCAL_AUTH_PG_URL);dburl.searchParams.set('options','-c role=app_gateway');
 const child=spawn(process.env.LOCAL_DENO_BIN,['run','--cached-only','--allow-env','--allow-net=127.0.0.1','--allow-read='+resolve('.'),'--allow-sys','--config=supabase/functions/acesso/deno.json','supabase/functions/acesso/index.ts'],{
  windowsHide:true,stdio:['ignore','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,
   DENO_DIR:resolve('.local/deno-cache'),ACCESS_LOCAL_PORT:String(port),ACCESS_DATABASE_URL:dburl.href,
   SUPABASE_URL:process.env.LOCAL_SUPABASE_URL,ACCESS_PUBLIC_KEY:process.env.LOCAL_SUPABASE_PUBLIC_KEY,
   ACCESS_AUTH_SECRET_KEY:process.env.LOCAL_AUTH_ADMIN_KEY,ACCESS_PEPPER:randomBytes(48).toString('base64url'),ACCESS_ORIGINS:'https://app.fixture.test'}});
 const stopped=once(child,'exit');let stderr='';child.stderr.on('data',b=>{stderr+=String(b);});
 try {
  const deadline=Date.now()+20000;let ready=false;
  while(Date.now()<deadline){
   if(child.exitCode!==null)throw new Error('Deno local encerrou: '+stderr.replace(/postgres(?:ql)?:\/\/\S+/g,'[DB redigido]'));
   try{await fetch('http://127.0.0.1:'+port+'/acesso/login',{method:'OPTIONS'});ready=true;break;}catch{}
   await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(ready,true);
  const post=(action,body,token)=>fetch('http://127.0.0.1:'+port+'/acesso/'+action,{method:'POST',headers:{Origin:'https://app.fixture.test','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const logged=await post('login',{usuario:'edson',senha:passwords.edson});assert.equal(logged.status,200);const session=await logged.json();await state(session.access_token);
  assert.equal((await post('listar',{},adminToken)).status,200);
  assert.equal((await post('listar',{},session.access_token)).status,403);
 }finally{if(child.exitCode===null)child.kill();await stopped;}
});
