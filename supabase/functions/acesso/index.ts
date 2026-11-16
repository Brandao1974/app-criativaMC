// Deployment artifact only. Nothing in the build deploys this function.
import pg from 'pg';
import {criarAcesso} from '../../../server/access.mjs';
import {criarHandlerAcesso} from '../../../server/handler.mjs';
const required=(key:string)=>{const value=Deno.env.get(key);if(!value)throw new Error('Variável servidor ausente: '+key);return value;};
const pool=new pg.Pool({connectionString:required('ACCESS_DATABASE_URL'),max:3});
const access=criarAcesso({pool,url:required('SUPABASE_URL'),publicKey:required('ACCESS_PUBLIC_KEY'),secretKey:required('ACCESS_AUTH_SECRET_KEY'),pepper:required('ACCESS_PEPPER')});
const handler=criarHandlerAcesso(access,{origins:required('ACCESS_ORIGINS').split(',')});
// Treat the actual peer as the source. Never trust an arbitrary forwarded header.
const localPort=Deno.env.get('ACCESS_LOCAL_PORT');
Deno.serve(localPort?{hostname:'127.0.0.1',port:Number(localPort)}:{},(req,info)=>handler(req,info.remoteAddr.hostname));
