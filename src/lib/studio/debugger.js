/** Read-only workflow debugger. No SQL, network calls, or user-authored JavaScript. */
import { conditionResult } from './workflow.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));

/** Create a snapshot of the trial inputs. The caller keeps its own input objects. */
export function startWorkflowDebug(flow, { fields = {}, selectedRecords = {} } = {}) {
  if (!flow || !Array.isArray(flow.steps) || !flow.startStepId || typeof flow.id !== 'string') {
    throw new Error('Select a valid workflow before debugging');
  }
  if (!isRecord(fields) || !isRecord(selectedRecords)) throw new Error('Debugger inputs must be objects');
  return {
    workflowId: flow.id,
    currentStepId: flow.startStepId,
    fields: copy(fields),
    selectedRecords: copy(selectedRecords),
    trace: [],
    effects: [],
    visitedIds: [],
    finished: false
  };
}

/** Advance exactly one step, returning a new snapshot. Database actions are DESCRIBED, never executed. */
export function stepWorkflowDebug(flow, state) {
  if (!state || state.workflowId !== flow?.id) throw new Error('Debugger session is for another workflow');
  if (state.finished) return state;
  if (state.trace.length >= 80) throw new Error('Workflow debugging step limit reached');
  if (state.visitedIds.includes(state.currentStepId)) throw new Error('Workflow cycle detected');
  const step = flow.steps.find(item => item.id === state.currentStepId);
  if (!step) throw new Error('Workflow debugger encountered a missing step');
  const next = {
    ...state,
    fields: copy(state.fields),
    selectedRecords: copy(state.selectedRecords),
    trace: state.trace.slice(),
    effects: state.effects.slice(),
    visitedIds: [...state.visitedIds, step.id]
  };
  let target = '';
  let outcome;
  if (step.type === 'condition') {
    outcome = conditionResult(step, next) ? 'true' : 'false';
    target = outcome === 'true' ? step.trueId : step.falseId;
  } else {
    target = step.type === 'stop' ? '' : step.nextId;
    if (['create', 'update', 'delete'].includes(step.type)) {
      next.effects.push({ type: 'data', operation: step.type, modelId: step.modelId, simulated: true });
    } else if (step.type === 'navigate') {
      next.effects.push({ type: 'navigate', pageId: step.pageId, simulated: true });
    } else if (step.type === 'message') {
      next.effects.push({ type: 'message', text: step.text, simulated: true });
    } else if (step.type === 'reset') {
      next.fields = {};
      next.selectedRecords = {};
      next.effects.push({ type: 'reset', simulated: true });
    } else if (step.type === 'set_field') {
      next.fields[step.field] = step.value;
      next.effects.push({ type: 'set_field', field: step.field, value: step.value, simulated: true });
    } else if (step.type !== 'stop') throw new Error('Unsupported workflow step');
  }
  next.trace.push({ stepId: step.id, type: step.type, ...(outcome ? { outcome } : {}), nextStepId: target });
  next.currentStepId = target;
  next.finished = !target;
  return next;
}

/** Run remaining steps. Does not execute data operations or other side effects. */
export function finishWorkflowDebug(flow, session) {
  let next = session;
  while (!next.finished) next = stepWorkflowDebug(flow, next);
  return next;
}
