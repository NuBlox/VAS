import published from '../../../../runtime/project.json' with { type:'json' };
import { validateProject } from '#lib/studio/model.js';
import { dev } from '$app/env';
import { projectRevision } from '#lib/studio/revision.js';
import { error, json } from '@sveltejs/kit';

export const publishedProject=validateProject(published);
const localhost=new Set(['localhost','127.0.0.1','[::1]','::1']);
export function runtimeStatus(event,env){
  const local=localhost.has(event.url.hostname);
  const enabled=dev&&local&&env.ENABLE_LOCAL_RUNTIME==='true';
  const configured=Boolean(env.DB_HOST&&env.DB_USER&&env.DB_NAME);
  return {enabled:enabled&&configured,configured,local,projectId:publishedProject.id,projectName:publishedProject.name,revision:projectRevision(publishedProject),
    reason:!dev?'Production runtime blocked until authentication and authorisation are implemented':!local?'Use localhost to access the development runtime':env.ENABLE_LOCAL_RUNTIME!=='true'?'Set ENABLE_LOCAL_RUNTIME=true to enable local MySQL access':!configured?'DB_HOST, DB_USER and DB_NAME are required':''};
}
export function requireRuntime(event,env,mutation=false){
  const status=runtimeStatus(event,env);
  if(!status.enabled)throw error(503,status.reason);
  if(mutation){
    const origin=event.request.headers.get('origin');
    if(origin!==event.url.origin)throw error(403,'Same-origin requests are required');
  }
  const clientId=event.request.headers.get('x-studio-project-id');
  if(clientId!==publishedProject.id||event.request.headers.get('x-studio-project-revision')!==projectRevision(publishedProject))throw error(409,'Editor project differs from published runtime. Export JSON, publish it locally and restart the server.');
  return publishedProject;
}
export async function readPayload(request){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw error(415,'Expected application/json');
  if(Number(request.headers.get('content-length')||0)>65536)throw error(413,'JSON payload exceeds 64 KiB');
  let payload;try{payload=await request.text();}catch{throw error(400,'Unable to read request');}
  if(payload.length>65536)throw error(413,'JSON payload exceeds 64 KiB');
  try{return JSON.parse(payload);}catch{throw error(400,'Invalid JSON');}
}
export function publicError(err) {
  if(err?.status&&Number.isInteger(err.status)&&err.status>=400&&err.status<=599)return json({error:err.message},{status:err.status});
  if(err?.code==='ER_DUP_ENTRY')return json({error:'A unique value already exists'},{status:409});
  if(err?.code==='ER_NO_REFERENCED_ROW_2'||err?.code==='ER_ROW_IS_REFERENCED_2')return json({error:'Record is referenced by another record or its foreign key is invalid'},{status:409});
  if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(err?.code))return json({error:'Database schema is not aligned with the published model. Apply a reviewed migration.'},{status:503});
  if(err?.code?.startsWith?.('ER_')||['ECONNREFUSED','ETIMEDOUT','ENOTFOUND'].includes(err?.code))return json({error:'Database operation failed; check connection, permissions and schema'},{status:503});
  console.error('Runtime request failed',err);
  return json({error:'Runtime request failed'},{status:500});
}
