import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { publishedProject, runtimeStatus } from '#lib/server/runtime/config.js';
export function GET(event){
  const state=runtimeStatus(event,env);
  if(!state.enabled)return json({error:state.reason},{status:503});
  return json(publishedProject,{headers:{'cache-control':'no-store'}});
}
