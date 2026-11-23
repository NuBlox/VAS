/** Durable, transaction-scoped workflow idempotency. No form values are stored in the ledger. */
import { createHash } from 'node:crypto';
import { RecordError } from '../../studio/records.js';
import { projectRevision } from '../../studio/revision.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE = '`visual_studio_audit`.`vas_workflow_requests`';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const next = Object.create(null);
    for (const key of Object.keys(value).sort()) Object.defineProperty(next, key, { value: stable(value[key]), enumerable: true });
    return next;
  }
  return value;
}

export function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new RecordError('A new UUIDv4 Idempotency-Key is required for each workflow submission', 400);
  return value.toLowerCase();
}

export function workflowFingerprint({ project, workflowId, payload }) {
  return createHash('sha256').update(JSON.stringify(stable({projectId:project.id,revision:projectRevision(project),workflowId,payload}))).digest('hex');
}

function collision() {
  const error = new RecordError('Idempotency-Key was already used for a different request',409);
  error.idempotencyConflict = true;
  return error;
}

/** Called after BEGIN, before the first business write. An in-flight competing INSERT waits for its transaction. */
export async function reserveWorkflowRequest(connection, { project, workflowId, payload, actor, requestKey }) {
  const key = validateIdempotencyKey(requestKey);
  if (!actor?.id) throw new RecordError('Workflow actor is required',401);
  const fingerprint = workflowFingerprint({project,workflowId,payload});
  const revision = projectRevision(project);
  try {
    await connection.execute(
      `INSERT INTO ${TABLE} (project_id, actor_id, request_id, workflow_id, project_revision, request_hash, status) VALUES (?,?,?,?,?,?,'pending')`,
      [project.id, actor.id, key, workflowId, revision, fingerprint]
    );
    return { key, fingerprint, replay: null };
  } catch(error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    // Lock the committed row. Rows from rolled-back attempts do not survive.
    const [rows] = await connection.execute(
      `SELECT workflow_id, project_revision, request_hash, status, result_json FROM ${TABLE} WHERE project_id=? AND actor_id=? AND request_id=? FOR UPDATE`,
      [project.id,actor.id,key]
    );
    const entry = rows?.[0];
    if (!entry) throw new RecordError('Idempotency record is unavailable; retry later',503);
    if (entry.workflow_id !== workflowId || entry.project_revision !== revision || entry.request_hash !== fingerprint) throw collision();
    if (entry.status !== 'committed' || entry.result_json == null) throw new RecordError('Previous request is still pending; retry later',503);
    const result = typeof entry.result_json === 'string' ? JSON.parse(entry.result_json) : entry.result_json;
    if (!result || typeof result !== 'object' || result.committed !== true || result.workflowId !== workflowId)
      throw new RecordError('Stored idempotency response is invalid',503);
    return {key,fingerprint,replay:{...result,replayed:true}};
  }
}

/** Must execute on the same connection and inside the same transaction as the business writes. */
export async function completeWorkflowRequest(connection, {project,actor,requestKey,result}) {
  const encoded = JSON.stringify(result);
  if (encoded.length > 65535) throw new RecordError('Workflow result exceeds the replay limit',503);
  const [update] = await connection.execute(
    `UPDATE ${TABLE} SET status='committed', result_json=? WHERE project_id=? AND actor_id=? AND request_id=? AND status='pending'`,
    [encoded,project.id,actor.id,validateIdempotencyKey(requestKey)]
  );
  if (update.affectedRows !== 1) throw new RecordError('Workflow request reservation was lost',503);
}
