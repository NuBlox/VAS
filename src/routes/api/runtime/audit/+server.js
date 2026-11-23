import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireRuntime, publicError } from '#lib/server/runtime/config.js';
import { listAudit } from '#lib/server/runtime/audit.js';
import { database } from '#lib/server/runtime/database.js';
export async function GET(event){
  try{
    requireRuntime(event,env,false,'admin');
    const params=event.url.searchParams;
    if([...params.keys()].some(key => !['before','limit'].includes(key)))return json({error:'Invalid audit query'}, {status:400});
    const result=await listAudit(await database(env),{before:params.get('before')??undefined,limit:params.get('limit')??50});
    return json({events:result},{headers:{'cache-control':'no-store'}});
  }catch(e){return publicError(e);}
}
