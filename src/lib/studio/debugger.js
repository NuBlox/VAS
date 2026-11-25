/** Read-only workflow debugger. No SQL, network calls, or user-authored JavaScript. */
import { conditionResult, resolveActionValue } from './workflow.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));

/** Create a snapshot of the trial inputs. The caller keeps its own input objects. */
export function startWorkflowDebug(flow, { fields = {}, selectedRecords = {}, eventContext = null, actions = [], breakpoints = [] } = {}) {
  if (!flow || !Array.isArray(flow.steps) || !flow.startStepId || typeof flow.id !== 'string') {
    throw new Error('Select a valid workflow before debugging');
  }
  if (!isRecord(fields) || !isRecord(selectedRecords)) throw new Error('Debugger inputs must be objects');
  if (!Array.isArray(breakpoints) || breakpoints.length > 80 || breakpoints.some(id => typeof id !== 'string' || !flow.steps.some(s => s.id === id))) throw new Error('Invalid workflow breakpoints');
  return {
    workflowId: flow.id,
    currentStepId: flow.startStepId,
    fields: copy(fields),
    selectedRecords: copy(selectedRecords),
    eventContext: eventContext ? copy(eventContext) : null,
    actions: copy(actions),
    trace: [],
    effects: [],
    visitedIds: [],
    breakpoints: [...new Set(breakpoints)],
    paused: false,
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
    visitedIds: [...state.visitedIds, step.id],
    paused: false
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
    } else if (step.type === 'invoke_action') {
      const action = next.actions.find(item => item.id === step.actionId && String(item.version) === step.actionVersion);
      if (!action) throw new Error('Debugger action reference is missing or outdated');
      const value = resolveActionValue(action, step, next);
      if (action.kind === 'message') next.effects.push({type:'message',text:String(value),simulated:true});
      else if (action.kind === 'set_field') {
        next.fields[action.targetField] = value;
        next.effects.push({type:'set_field',field:action.targetField,value,simulated:true});
      } else throw new Error('Debugger does not support the selected action');
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

/** Continue a dry run until a breakpoint or completion. A pause occurs BEFORE the step.
 * Continuing an already-paused session executes that step once so it cannot hang. */
export function continueWorkflowDebug(flow, session) {
  if (!session || session.workflowId !== flow?.id) throw new Error('Debugger session is for another workflow');
  let next = session;
  if (next.paused && !next.finished) next = stepWorkflowDebug(flow, next);
  while (!next.finished) {
    if ((next.breakpoints ?? []).includes(next.currentStepId)) return { ...next, paused:true };
    next = stepWorkflowDebug(flow, next);
  }
  return next;
}
