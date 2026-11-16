// No privileged credential, password or activation-code persistence.
export function criarGateway(client,url,fetcher=globalThis.fetch) {
 const base=new URL(url,globalThis.location?.href||'http://localhost');
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw new Error('Gateway exige HTTPS');
 return async(action,body={},authenticated=false)=>{
  const headers={'Content-Type':'application/json'};
  if(authenticated) {
   const {data,error}=await client.auth.getSession();
   if(error||!data.session)throw Object.assign(new Error('Entre novamente.'),{status:401});
   headers.Authorization='Bearer '+data.session.access_token;
  }
  const response=await fetcher(base.href.replace(/\/$/,'')+'/'+action,{method:'POST',headers,cache:'no-store',credentials:'omit',body:JSON.stringify(body)});
  if(!response.ok)throw Object.assign(new Error('Não foi possível concluir o acesso.'),{status:response.status});
  return response.json();
 };
}
