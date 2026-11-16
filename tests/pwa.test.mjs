import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, access } from 'node:fs/promises';
test('PWA: um build, cache limitado ao shell e preservação de outros aplicativos',async()=>{
  const listeners={},apagados=[],pedidos=[];let ativou=false,aguardado;
  const self={registration:{scope:'https://example.test/app-criativaMC/'},location:{origin:'https://example.test'},
    clients:{claim:async()=>{}},addEventListener:(evento,fn)=>{listeners[evento]=fn;},skipWaiting:()=>{ativou=true;}};
  const fonte=await readFile(new URL('../sw.js',import.meta.url),'utf8');
  const build=/const BUILD = '([^']+)'/.exec(fonte)[1];
  const caches={open:async()=>({addAll:async urls=>{pedidos.push(...urls);},match:async()=>({status:200})}),
    keys:async()=>['outro-app','gestao-obras-v1','criativamc-antigo',build],delete:async k=>{apagados.push(k);}};
  vm.runInNewContext(fonte,{self,caches,URL,Set,fetch:async()=>({status:200})});
  listeners.install({waitUntil:p=>{aguardado=p;}});await aguardado;
  assert.equal(ativou,false);
  for(const url of pedidos)await access(new URL('../'+new URL(url).pathname.replace('/app-criativaMC/',''),import.meta.url));
  assert.ok(pedidos.every(u=>u.startsWith(self.registration.scope)));
  listeners.activate({waitUntil:p=>{aguardado=p;}});await aguardado;
  assert.deepEqual(apagados,['criativamc-antigo']);
  for(const url of ['https://example.supabase.co/auth/v1/token','https://example.supabase.co/rest/v1/rpc/ler_estado','https://example.test/other-app/index.html']) {
    let interceptado=false;
    listeners.fetch({request:{method:'GET',url},respondWith:()=>{interceptado=true;}});
    assert.equal(interceptado,false);
  }
  listeners.message({data:'ACTIVATE_BUILD'});assert.equal(ativou,true);
});
