import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireRuntime, publicError } from '#lib/server/runtime/config.js';
import { database } from '#lib/server/runtime/database.js';
import { currentActor } from '#lib/server/runtime/auth.js';
import { readRuntimePolicy } from '#lib/server/runtime/policy.js';
import { searchReferences } from '#lib/server/runtime/references.js';
export async function GET(event) {
  try {
    const project = requireRuntime(event,env);
    const pageId = event.url.searchParams.get('pageId') ?? '';
    const search = event.url.searchParams.get('q') ?? '';
    return json({options:await searchReferences(await database(env),project,pageId,event.params.componentId,search,currentActor(event),readRuntimePolicy())},{headers:{'cache-control':'no-store'}});
  } catch(error) {return publicError(error);}
}
