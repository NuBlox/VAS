import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireRuntime, readPayload, publicError } from '#lib/server/runtime/config.js';
import { database } from '#lib/server/runtime/database.js';
import { executePublishedWorkflow } from '#lib/server/runtime/workflow-execution.js';

/** Runtime accepts a workflow ID, never a client-provided graph or SQL. */
export async function POST(event) {
  try {
    const project = requireRuntime(event, env, true);
    const payload = await readPayload(event.request);
    const result = await executePublishedWorkflow({project, workflowId: event.params.workflowId, payload, db:await database(env)});
    return json(result, {headers:{'cache-control':'no-store'}});
  } catch (error) {
    return publicError(error);
  }
}
