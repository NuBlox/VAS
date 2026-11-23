import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireRuntime, readPayload, publicError } from '#lib/server/runtime/config.js';
import { database } from '#lib/server/runtime/database.js';
import { getPublishedModel, getRecord } from '#lib/server/runtime/store.js';
import { executeAuditedMutation } from '#lib/server/runtime/audit.js';
import { currentActor } from '#lib/server/runtime/auth.js';
import { readRuntimePolicy, assertModelPermission } from '#lib/server/runtime/policy.js';
export async function GET(event){
  try{const p=requireRuntime(event,env);const m=getPublishedModel(p,event.params.modelId);assertModelPermission(currentActor(event),m.id,'read',readRuntimePolicy());return json({record:await getRecord(await database(env),m,event.params.recordId)});}
  catch(e){return publicError(e);}
}
export async function PATCH(event){
  try{const p=requireRuntime(event,env,true,'editor');const m=getPublishedModel(p,event.params.modelId);const data=await readPayload(event.request);return json(await executeAuditedMutation({db:await database(env),project:p,model:m,operation:'update',payload:data,id:event.params.recordId,actor:currentActor(event),policy:readRuntimePolicy()}));}
  catch(e){return publicError(e);}
}
export async function DELETE(event){
  try{const p=requireRuntime(event,env,true,'admin');const m=getPublishedModel(p,event.params.modelId);return json(await executeAuditedMutation({db:await database(env),project:p,model:m,operation:'delete',id:event.params.recordId,actor:currentActor(event),policy:readRuntimePolicy()}));}
  catch(e){return publicError(e);}
}
