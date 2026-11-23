/**
 * Local-only published workflow runtime. Never executes client-provided graphs,
 * SQL, JavaScript or arbitrary field names. All mutations share one connection.
 *
 * The localhost-only gate is enforced by the HTTP route, not this module. This
 * module is an execution boundary, NOT a multi-user authorisation system.
 */
import { walkNodes } from '../../studio/model.js';
import { executeWorkflow } from '../../studio/workflow.js';
import { RecordError, normaliseId, sqlFor } from '../../studio/records.js';
import { getPublishedModel, getRecord, deleteRecord } from './store.js';
import { canExecuteWorkflow } from './auth.js';
import { writeAudit } from './audit.js';
import { reserveWorkflowRequest, completeWorkflowRequest } from './idempotency.js';
import { assertWorkflowPermission } from './policy.js';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const FORM_TYPES = new Set(['input', 'textarea', 'checkbox', 'select']);
const MAX_VALUE_LENGTH = 10000;

function formBindings(page) {
  const names = new Set(), bindings = new Map(), tables = new Set();
  walkNodes(page.components, component => {
    if (component.type === 'table' && component.props.bindingModelId) tables.add(component.props.bindingModelId);
    if (!FORM_TYPES.has(component.type)) return;
    const name = component.props.field;
    if (typeof name !== 'string' || !name || names.has(name))
      throw new RecordError('Form field names must be non-empty and unique for server workflows');
    names.add(name);
    if (component.props.bindingModelId && component.props.bindingFieldId) {
      const modelId = component.props.bindingModelId;
      const array = bindings.get(modelId) ?? [];
      array.push({ name, fieldId: component.props.bindingFieldId });
      bindings.set(modelId, array);
    }
  });
  return { names, bindings, tables };
}

/** Request input is an event snapshot, never a workflow definition. */
export function validateWorkflowInvocation(project, workflowId, payload) {
  if (!plain(payload) || Object.keys(payload).some(key => !['pageId', 'componentId', 'fields', 'selectedRecords', 'confirmDelete'].includes(key)))
    throw new RecordError('Invalid workflow invocation');
  const flow = project.workflows.find(item => item.id === workflowId);
  if (!flow) throw new RecordError('Workflow is not published', 404);
  if (payload.pageId !== flow.trigger.pageId || payload.componentId !== flow.trigger.componentId || flow.trigger.event !== 'click')
    throw new RecordError('Workflow trigger does not match the published button', 403);
  const page = project.pages.find(item => item.id === flow.trigger.pageId);
  if (!page) throw new RecordError('Workflow source page is missing', 503);
  const { names, bindings, tables } = formBindings(page);
  if (!plain(payload.fields) || !plain(payload.selectedRecords) || Object.keys(payload.fields).length > 100 || Object.keys(payload.selectedRecords).length > 100)
    throw new RecordError('Invalid workflow field and selection data');
  if (payload.confirmDelete !== undefined && typeof payload.confirmDelete !== 'boolean')
    throw new RecordError('Invalid delete confirmation');

  const fields = Object.create(null);
  for (const [name, value] of Object.entries(payload.fields)) {
    if (!names.has(name) || !['string', 'number', 'boolean'].includes(typeof value) && value !== null ||
        typeof value === 'number' && !Number.isFinite(value) ||
        typeof value === 'string' && value.length > MAX_VALUE_LENGTH)
      throw new RecordError('Unexpected workflow form field or value');
    Object.defineProperty(fields, name, { value, enumerable: true, writable: true, configurable: true });
  }
  const selectedRecords = Object.create(null);
  for (const [modelId, id] of Object.entries(payload.selectedRecords)) {
    if (!tables.has(modelId)) throw new RecordError('Selected record must come from a bound table on the workflow page');
    if (id !== '' && id !== null) {
      const model = getPublishedModel(project, modelId);
      Object.defineProperty(selectedRecords, modelId, { value: normaliseId(model, id), enumerable: true, writable: true, configurable: true });
    }
  }
  return { flow, page, bindings, tables, context: { fields, selectedRecords }, confirmDelete: payload.confirmDelete === true };
}

function boundPayload(project, modelId, bindings, context, operation) {
  const model = getPublishedModel(project, modelId);
  const controls = bindings.get(modelId) ?? [];
  if (!controls.length) throw new RecordError(`Page has no fields bound to ${model.name}`);
  const values = Object.create(null);
  for (const control of controls) {
    const field = model.fields.find(item => item.id === control.fieldId);
    if (!field || field.primary) throw new RecordError('Workflow form binding is invalid');
    if (Object.hasOwn(values, field.name)) throw new RecordError('Duplicate model field binding');
    const raw = context.fields[control.name];
    if (raw !== undefined && raw !== '') Object.defineProperty(values, field.name, { value: raw, enumerable: true });
  }
  // sqlFor performs required-field, type, column and identifier validation.
  return { model, statement: sqlFor(model, operation, values, operation === 'update' ? context.selectedRecords[modelId] : undefined) };
}

async function insertWithinTransaction(connection, model, statement) {
  await connection.execute(statement.sql, statement.params);
  // MySQL's LAST_INSERT_ID() is scoped to this same transactional connection.
  const [rows] = await connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
  if (!rows?.[0]?.id) throw new RecordError('Unable to retrieve new record ID', 500);
  return getRecord(connection, model, rows[0].id);
}

/**
 * Execute a validated, published graph in one transaction. UI effects are only
 * returned after commit, so failed steps cannot leak partial success messages.
 */
export async function executePublishedWorkflow({ project, workflowId, payload, db, actor = null, requestKey, policy }) {
  const invocation = validateWorkflowInvocation(project, workflowId, payload);
  const { flow, bindings, tables, context, confirmDelete } = invocation;
  if(actor){canExecuteWorkflow(actor,flow);assertWorkflowPermission(actor,flow,policy);}
  if (!db || typeof db.getConnection !== 'function') throw new RecordError('Database connection is unavailable', 503);
  const connection = await db.getConnection();
  const effects = [];
  let started = false;
  let skipRejectedAudit = false;
  try {
    await connection.beginTransaction();
    started = true;
    if (actor) {
      const reservation = await reserveWorkflowRequest(connection,{project,workflowId,payload,actor,requestKey});
      if (reservation.replay) {
        await connection.rollback();
        started = false;
        return reservation.replay;
      }
    }
    const trace = await executeWorkflow(flow, context, {
      data: async (operation, modelId) => {
        if (operation === 'create') {
          const { model, statement } = boundPayload(project, modelId, bindings, context, 'create');
          const record = await insertWithinTransaction(connection, model, statement);
          context.selectedRecords[modelId] = String(record[model.fields.find(f => f.primary).name]);
          effects.push({ type:'data', operation, modelId, id:context.selectedRecords[modelId] });
          return;
        }
        if (!tables.has(modelId)) throw new RecordError('Updates and deletes require a model table on this page');
        const model = getPublishedModel(project, modelId);
        const id = context.selectedRecords[modelId];
        if (!id) throw new RecordError('Select a record before updating or deleting it');
        if (operation === 'update') {
          const { statement } = boundPayload(project, modelId, bindings, context, 'update');
          // Validate and apply the same parameterised statement on this connection.
          const [result] = await connection.execute(statement.sql, statement.params);
          if (!result.affectedRows) throw new RecordError('Record not found', 404);
          await getRecord(connection, model, id);
          effects.push({ type:'data', operation, modelId, id });
        } else if (operation === 'delete') {
          if (!confirmDelete) throw new RecordError('Deletion requires explicit confirmation', 403);
          await deleteRecord(connection, model, id);
          delete context.selectedRecords[modelId];
          effects.push({ type:'data', operation, modelId, id });
        }
      },
      navigate: async pageId => effects.push({type:'navigate', pageId}),
      message: async text => effects.push({type:'message', text}),
      reset: async () => effects.push({type:'reset'}),
      setField: async (field, value) => effects.push({type:'set_field', field, value})
    });
    const result = { trace, effects, committed: true, workflowId: flow.id };
    if(actor) {
      await writeAudit(connection,{actor,action:'workflow.execute',resourceType:'workflow',resourceId:flow.id,outcome:'committed',projectId:project.id});
      await completeWorkflowRequest(connection,{project,actor,requestKey,result});
    }
    await connection.commit();
    started = false;
    return result;
  } catch (error) {
    skipRejectedAudit = error?.idempotencyConflict === true;
    if (started) {
      try { await connection.rollback(); } catch (rollbackError) {
        console.error('Workflow rollback failed', rollbackError);
        throw new RecordError('Workflow transaction rollback failed; inspect database state', 503);
      }
    }
    if(actor && !skipRejectedAudit)try{await writeAudit(connection,{actor,action:'workflow.execute',resourceType:'workflow',resourceId:flow.id,outcome:'rejected',projectId:project.id});}
    catch(auditError){console.error('Failed to audit rejected workflow',auditError);}
    throw error;
  } finally {
    connection.release();
  }
}
