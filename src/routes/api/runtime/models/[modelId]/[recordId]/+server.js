import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireRuntime, readPayload, publicError } from '#lib/server/runtime/config.js';
import { database } from '#lib/server/runtime/database.js';
import { getPublishedModel, getRecord, updateRecord, deleteRecord } from '#lib/server/runtime/store.js';
export async function GET(event){
  try{const p=requireRuntime(event,env);const m=getPublishedModel(p,event.params.modelId);return json({record:await getRecord(await database(env),m,event.params.recordId)});}
  catch(e){return publicError(e);}
}
export async function PATCH(event){
  try{const p=requireRuntime(event,env,true);const m=getPublishedModel(p,event.params.modelId);const data=await readPayload(event.request);return json({record:await updateRecord(await database(env),m,event.params.recordId,data)});}
  catch(e){return publicError(e);}
}
export async function DELETE(event){
  try{const p=requireRuntime(event,env,true);const m=getPublishedModel(p,event.params.modelId);return json(await deleteRecord(await database(env),m,event.params.recordId));}
  catch(e){return publicError(e);}
}
