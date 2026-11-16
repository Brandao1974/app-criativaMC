// Fetch-compatible adapter, also used by the Supabase Edge entrypoint.
export function criarHandlerAcesso(access,{origins}) {
 if(!origins?.length||origins.includes('*')||origins.includes('null'))throw new Error('Origens exatas obrigatórias');
 return async(request,ip='unknown')=>{
  const h=new Headers({'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Vary':'Origin','Content-Type':'application/json'});
  const origin=request.headers.get('origin');
  if(origin&&!origins.includes(origin))return new Response(null,{status:403,headers:h});
  if(origin)h.set('Access-Control-Allow-Origin',origin);
  if(request.method==='OPTIONS') {
   h.set('Access-Control-Allow-Methods','POST');h.set('Access-Control-Allow-Headers','content-type,authorization,apikey,x-client-info');
   return new Response(null,{status:204,headers:h});
  }
  try {
   if(request.method!=='POST'||!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw {status:400};
   const action=/\/acesso\/(login|ativar|listar|cadastrar|codigo|gerir)$/.exec(new URL(request.url).pathname)?.[1];
   if(!action)throw {status:404};
   let text='',bytes=0;const decoder=new TextDecoder();
   if(request.body)for await(const chunk of request.body){bytes+=chunk.length;if(bytes>4096)throw {status:413};text+=decoder.decode(chunk,{stream:true});}
   text+=decoder.decode();const body=JSON.parse(text);
   if(!body||Array.isArray(body)||typeof body!=='object')throw {status:400};
   const result=await access.dispatch(action,body,{ip,token:request.headers.get('authorization')?.replace(/^Bearer /,'')});
   return new Response(JSON.stringify(result),{status:200,headers:h});
  }catch(e){
   const status=e.status||(['42501','P0002'].includes(e.code)?403:400);
   return new Response(JSON.stringify({erro:status===429?'Muitas tentativas. Aguarde e tente novamente.':'Não foi possível concluir o acesso.'}),{status,headers:h});
  }
 };
}
