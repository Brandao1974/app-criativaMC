import {createServer} from 'node:http';
// No request/body/token logging. Reverse proxy must ALSO disable body logging.
export function criarServidorAcesso(access,{origins}) {
 if(!origins?.length||origins.includes('*')||origins.includes('null'))throw new Error('Origens exatas obrigatórias');
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Origin');
  const origin=req.headers.origin;
  if(origin&&!origins.includes(origin)){res.writeHead(403);res.end();return;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS') {
   res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','content-type,authorization');
   res.writeHead(204);res.end();return;
  }
  try {
   if(req.method!=='POST'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw {status:400};
   if(!/^\/acesso\/(login|ativar|listar|cadastrar|codigo|gerir)$/.test(req.url))throw {status:404};
   let bytes=0;const chunks=[];
   for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw {status:413};chunks.push(chunk);}
   const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!body||Array.isArray(body)||typeof body!=='object')throw {status:400};
   const result=await access.dispatch(req.url.slice(8),body,{
    ip:req.socket.remoteAddress,token:req.headers.authorization?.replace(/^Bearer /,'')});
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(e){
   const status=e.status||(['42501','P0002'].includes(e.code)?403:400);
   res.writeHead(status,{'Content-Type':'application/json'});
   res.end(JSON.stringify({erro:status===429?'Muitas tentativas. Aguarde e tente novamente.':'Não foi possível concluir o acesso.'}));
  }
 });
}
