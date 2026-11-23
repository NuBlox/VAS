/** Deny-only, server-owned resource permissions for the localhost development runtime.
 * A policy may narrow a role but NEVER grant access above the built-in role hierarchy.
 * The published editor JSON cannot define or override this policy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecordError } from '../../studio/records.js';
import { requireRole } from './auth.js';
const roles = new Set(['viewer','editor','admin']);
const operations = new Set(['read','create','update','delete']);
const name = /^[a-zA-Z0-9_-]{1,128}$/;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export function validateRuntimePolicy(value) {
  if (!plain(value) || value.version !== 1 || Object.keys(value).some(k => !['version','models','workflows'].includes(k))) throw new RecordError('Invalid local resource policy',503);
  const models = value.models ?? {};
  const workflows = value.workflows ?? {};
  if (!plain(models) || !plain(workflows) || Object.keys(models).length > 250 || Object.keys(workflows).length > 250) throw new RecordError('Invalid local resource policy',503);
  const checkRoles = list => Array.isArray(list) && list.length<=3 && new Set(list).size===list.length && list.every(r => roles.has(r));
  for (const [id,perms] of Object.entries(models)) {
    if (!name.test(id) || !plain(perms) || Object.entries(perms).some(([op,list]) => !operations.has(op) || !checkRoles(list))) throw new RecordError('Invalid model resource policy',503);
  }
  for (const [id,list] of Object.entries(workflows)) {
    if (!name.test(id) || !checkRoles(list)) throw new RecordError('Invalid workflow resource policy',503);
  }
  return {version:1,models,workflows};
}

export function readRuntimePolicy(filePath=resolve(process.cwd(),'.vas/policy.local.json')) {
  let raw;
  try { raw=readFileSync(filePath,'utf8'); }
  catch (error) {
    if (error.code==='ENOENT') return null; // No restriction beyond the built-in hierarchy.
    throw new RecordError('Cannot read local resource policy',503);
  }
  try {return validateRuntimePolicy(JSON.parse(raw));}
  catch {throw new RecordError('Invalid local resource policy; runtime requests are blocked',503);}
}

export function assertModelPermission(actor,modelId,operation,policy=null) {
  if (!operations.has(operation)) throw new RecordError('Invalid model permission operation',503);
  requireRole(actor,operation==='delete'?'admin':operation==='read'?'viewer':'editor');
  if (policy) {
    const list = policy.models?.[modelId]?.[operation];
    if (list && !list.includes(actor.role)) throw new RecordError('Resource access denied by local policy',403);
  }
  return actor;
}

export function assertWorkflowPermission(actor,workflow,policy=null) {
  const required=workflow.steps.some(s=>s.type==='delete')?'admin':workflow.steps.some(s=>['create','update'].includes(s.type))?'editor':'viewer';
  requireRole(actor,required);
  if (policy) {
    const list=policy.workflows?.[workflow.id];
    if (list && !list.includes(actor.role)) throw new RecordError('Workflow access denied by local policy',403);
  }
  for (const step of workflow.steps) {
    if (['create','update','delete'].includes(step.type)) assertModelPermission(actor,step.modelId,step.type,policy);
  }
  return actor;
}
