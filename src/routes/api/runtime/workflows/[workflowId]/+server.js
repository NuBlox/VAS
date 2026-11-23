import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { requireRuntime, readPayload, publicError } from '#lib/server/runtime/config.js';
import { database } from '#lib/server/runtime/database.js';
import { executePublishedWorkflow } from '#lib/server/runtime/workflow-execution.js';
import { currentActor, canExecuteWorkflow } from '#lib/server/runtime/auth.js';
import { readRuntimePolicy, assertWorkflowPermission } from '#lib/server/runtime/policy.js';

/** Runtime accepts a workflow ID, never a client-provided graph or SQL. */
export async function POST(event) {
  try {
    const project = requireRuntime(event, env, true);
    const actor=currentActor(event);
    const flow=project.workflows.find(item=>item.id===event.params.workflowId);
    if(!flow)return json({error:'Workflow not published'},{status:404});
    canExecuteWorkflow(actor,flow);
    const policy=readRuntimePolicy();
    assertWorkflowPermission(actor,flow,policy);
    const payload = await readPayload(event.request);
    const result = await executePublishedWorkflow({project, workflowId: event.params.workflowId, payload, db:await database(env),actor,policy,requestKey:event.request.headers.get('idempotency-key')});
    return json(result, {headers:{'cache-control':'no-store'}});
  } catch (error) {
    return publicError(error);
  }
}
