import { createServer } from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
const root=resolve('.');
const tipos={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
createServer(async(req,res)=>{
  try {
    let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(p==='/')p='/index.html';
    if(!/^\/(?:[\w-]+\.html|sw\.js|manifest\.json|(?:js|css|images)\/[\w./-]+)$/.test(p) || p.includes('..') || p.includes('config.local'))throw new Error();
    const file=resolve(root,'.'+p);
    if(!file.startsWith(root+sep) || !(await stat(file)).isFile())throw new Error();
    res.writeHead(200,{'Content-Type':tipos[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Não encontrado');}
}).listen(4173,'127.0.0.1',()=>console.log('Prévia local: http://127.0.0.1:4173'));
