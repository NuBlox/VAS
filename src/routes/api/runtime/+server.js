import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { runtimeStatus } from '$lib/server/runtime/config.js';
export function GET(event){return json(runtimeStatus(event,env),{headers:{'cache-control':'no-store'}});}
