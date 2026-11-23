import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireRuntime, readPayload, publicError } from '#lib/server/runtime/config.js';
import { database } from '#lib/server/runtime/database.js';
import { getPublishedModel, listRecords } from '#lib/server/runtime/store.js';
import { executeAuditedMutation } from '#lib/server/runtime/audit.js';
import { currentActor } from '#lib/server/runtime/auth.js';
export async function GET(event){
  try{const p=requireRuntime(event,env);const m=getPublishedModel(p,event.params.modelId);return json({records:await listRecords(await database(env),m)},{headers:{'cache-control':'no-store'}});}
  catch(e){return publicError(e);}
}
export async function POST(event){
  try{const p=requireRuntime(event,env,true,'editor');const m=getPublishedModel(p,event.params.modelId);const data=await readPayload(event.request);const result=await executeAuditedMutation({db:await database(env),project:p,model:m,operation:'create',payload:data,actor:currentActor(event)});return json(result,{status:201});}
  catch(e){return publicError(e);}
}
