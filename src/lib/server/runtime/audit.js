/** Append-only metadata audit. No form values, passwords, tokens or raw errors stored. */
import { RecordError, sqlFor, normaliseId } from '../../studio/records.js';
import { getRecord } from './store.js';
import { requireRole } from './auth.js';
const actions = new Set(['model.create','model.update','model.delete','workflow.execute']);
const outcomes = new Set(['committed','rejected']);
export async function writeAudit(connection,{actor,action,resourceType,resourceId,outcome,projectId}) {
  requireRole(actor,'viewer');
  if(!actions.has(action)||!outcomes.has(outcome)||!['model','workflow'].includes(resourceType)||
      typeof resourceId !== 'string'||resourceId.length>128 || typeof projectId !== 'string'||projectId.length>128)
    throw new RecordError('Invalid audit metadata',500);
  await connection.execute(
    'INSERT INTO `visual_studio_audit`.`vas_audit_events` (`actor_id`,`action`,`resource_type`,`resource_id`,`outcome`,`project_id`) VALUES (?,?,?,?,?,?)',
    [actor.id,action,resourceType,resourceId,outcome,projectId]
  );
}
export async function auditRejected(db,data) {
  // A rejection cannot share the rolled-back transaction. Best-effort record on a separate connection.
  try{await writeAudit(db,{...data,outcome:'rejected'});}
  catch(error){console.error('Failed to write rejected-action audit event',error);}
}
export async function listAudit(db,{before,limit=50}={}) {
  const bounded=Number(limit);
  if(!Number.isInteger(bounded)||bounded<1||bounded>100)throw new RecordError('Invalid audit page size');
  if(before!==undefined && !/^[1-9]\d{0,19}$/.test(String(before)))throw new RecordError('Invalid audit cursor');
  const statement=before===undefined?
    'SELECT CAST(`id` AS CHAR) AS id, `created_at`, `actor_id`, `action`, `resource_type`, `resource_id`, `outcome`, `project_id` FROM `visual_studio_audit`.`vas_audit_events` ORDER BY `id` DESC LIMIT ?':
    'SELECT CAST(`id` AS CHAR) AS id, `created_at`, `actor_id`, `action`, `resource_type`, `resource_id`, `outcome`, `project_id` FROM `visual_studio_audit`.`vas_audit_events` WHERE `id` < ? ORDER BY `id` DESC LIMIT ?';
  const [rows]=await db.execute(statement,before===undefined?[bounded]:[String(before),bounded]);
  return rows;
}
/** Single-transaction direct CRUD with an append-only audit event before commit. */
export async function executeAuditedMutation({db,project,model,operation,payload,id,actor}) {
  const role=operation==='delete'?'admin':'editor';
  requireRole(actor,role);
  if(!['create','update','delete'].includes(operation))throw new RecordError('Invalid mutation');
  const action=`model.${operation}`;
  const audit={actor,action,resourceType:'model',resourceId:model.id,projectId:project.id};
  let connection, started=false;
  try {
    // Validate before taking a connection where possible.
    const {sql,params}=sqlFor(model,operation,payload??{},id);
    connection=await db.getConnection();
    await connection.beginTransaction();started=true;
    const [result]=await connection.execute(sql,params);
    if(operation!=='create' && !result.affectedRows)throw new RecordError('Record not found',404);
    let record;
    if(operation==='create') {
      const [ids]=await connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
      record=await getRecord(connection,model,ids[0].id);
    } else if(operation==='update')record=await getRecord(connection,model,id);
    await writeAudit(connection,{...audit,outcome:'committed'});
    await connection.commit();started=false;
    return operation==='delete'?{deleted:true,id:normaliseId(model,id)}:{record};
  } catch(error) {
    if(started)try{await connection.rollback();}catch(rollbackError){console.error('CRUD rollback failed',rollbackError);throw new RecordError('Transaction rollback failed; inspect database state',503);}
    // After rollback the connection is back in autocommit mode; avoid pool deadlock.
    if(connection)try{await writeAudit(connection,{...audit,outcome:'rejected'});}catch(auditError){console.error('Failed to record rejected mutation',auditError);}
    else await auditRejected(db,audit);
    throw error;
  } finally {connection?.release();}
}
