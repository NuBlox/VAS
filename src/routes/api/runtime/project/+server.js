import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { publishedProject, runtimeStatus, publicError } from '#lib/server/runtime/config.js';
import { requireRole } from '#lib/server/runtime/auth.js';
export function GET(event){
  const state=runtimeStatus(event,env);
  if(!state.enabled)return json({error:state.reason},{status:503});
  try{requireRole(state.actor,'viewer');return json(publishedProject,{headers:{'cache-control':'no-store'}});}
  catch(e){return publicError(e);}
}
