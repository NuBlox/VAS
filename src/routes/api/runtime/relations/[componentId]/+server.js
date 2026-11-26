import {env} from '$env/dynamic/private';
import {json} from '@sveltejs/kit';
import {requireRuntime,publicError} from '#lib/server/runtime/config.js';
import {database} from '#lib/server/runtime/database.js';
import {currentActor} from '#lib/server/runtime/auth.js';
import {readRuntimePolicy} from '#lib/server/runtime/policy.js';
import {listRelatedRecords} from '#lib/server/runtime/relations.js';
export async function GET(event){
  try{
    const project=requireRuntime(event,env);
    const params=event.url.searchParams;
    const result=await listRelatedRecords(await database(env),project,params.get('pageId')??'',event.params.componentId,
      params.get('parentId')??'',params.get('page')??'0',params.get('limit')??'20',currentActor(event),readRuntimePolicy());
    return json(result,{headers:{'cache-control':'no-store'}});
  }catch(error){return publicError(error);}
}
