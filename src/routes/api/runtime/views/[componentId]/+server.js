import {env} from '$env/dynamic/private';
import {json} from '@sveltejs/kit';
import {requireRuntime,publicError} from '#lib/server/runtime/config.js';
import {database} from '#lib/server/runtime/database.js';
import {currentActor} from '#lib/server/runtime/auth.js';
import {readRuntimePolicy} from '#lib/server/runtime/policy.js';
import {executePublishedView} from '#lib/server/runtime/data-views.js';
export async function GET(event){
  try{
    const project=requireRuntime(event,env);
    const query=event.url.searchParams;
    const rawBindings=query.get('bindings')??'{}';
    if(rawBindings.length>1024)throw new Error('Data-view bindings are too long');
    let bindings;
    try{bindings=JSON.parse(rawBindings);}catch{throw new Error('Invalid data-view bindings');}
    const result=await executePublishedView(await database(env),project,{
      pageId:query.get('pageId')??'',componentId:event.params.componentId,
      query:query.get('q')??'',parentId:query.get('parentId')??'',page:query.get('page')??'0',bindings
    },currentActor(event),readRuntimePolicy());
    return json(result,{headers:{'cache-control':'no-store'}});
  }catch(error){return publicError(error);}
}
