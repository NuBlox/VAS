/** Read-only workflow debugger. No SQL, network calls, or user-authored JavaScript. */
import { conditionResult, resolveActionValue, EVENT_VALUE_FIELD } from './workflow.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));

/** Snapshot only the simulated state: no executable closures, SQL or external references. */
const snapshot = state => ({
  currentStepId:state.currentStepId,fields:copy(state.fields),selectedRecords:copy(state.selectedRecords),
  eventContext:state.eventContext?copy(state.eventContext):null,
  trace:copy(state.trace),effects:copy(state.effects),visitedIds:[...state.visitedIds],
  paused:state.paused,finished:state.finished
});
function explainStep(step,state,outcome){
  if(step.type==='condition'){
    const source=step.operator==='selected'?`Selected record: ${step.modelId}`:
      step.field===EVENT_VALUE_FIELD?'Current event value':`Form field: ${step.field}`;
    const raw=step.operator==='selected'?state.selectedRecords?.[step.modelId]:
      step.field===EVENT_VALUE_FIELD?state.eventContext?.value:state.fields?.[step.field];
    return {source,operator:step.operator,actual:raw===undefined?null:copy(raw),
      expected:step.value??'',outcome,explanation:`${source} ${step.operator} → ${outcome}`};
  }
  if(['create','update','delete'].includes(step.type))
    return {source:`Model: ${step.modelId}`,explanation:`${step.type} is simulated; MySQL is not accessed`};
  if(step.type==='invoke_action')return {source:`Reusable action: ${step.actionId}`,explanation:`Action version ${step.actionVersion} is simulated`};
  if(step.type==='set_field')return {source:`Form field: ${step.field}`,explanation:`Simulated assignment to ${step.field}`};
  if(step.type==='reset')return {source:'Form',explanation:'Simulated form and selection reset'};
  if(step.type==='navigate')return {source:`Page: ${step.pageId}`,explanation:'Navigation is simulated'};
  return {source:'Workflow',explanation:`${step.type} is simulated`};
}
/** Create a snapshot of the trial inputs. The caller keeps its own input objects. */
export function startWorkflowDebug(flow, { fields = {}, selectedRecords = {}, eventContext = null, actions = [], breakpoints = [] } = {}) {
  if (!flow || !Array.isArray(flow.steps) || !flow.startStepId || typeof flow.id !== 'string') {
    throw new Error('Select a valid workflow before debugging');
  }
  if (!isRecord(fields) || !isRecord(selectedRecords)) throw new Error('Debugger inputs must be objects');
  if (!Array.isArray(breakpoints) || breakpoints.length > 80 || breakpoints.some(id => typeof id !== 'string' || !flow.steps.some(s => s.id === id))) throw new Error('Invalid workflow breakpoints');
  const state={
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
  return {...state,snapshots:[snapshot(state)]};
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
  const explanation=explainStep(step,state,outcome);
  next.trace.push({ stepId: step.id, type: step.type, ...(outcome ? { outcome } : {}), nextStepId: target, ...explanation });
  next.currentStepId = target;
  next.finished = !target;
  next.snapshots=[...(state.snapshots??[snapshot(state)]),snapshot(next)];
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

/** Restore a previous snapshot. No prior state objects are mutated; forward execution is repeatable. */
export function rewindWorkflowDebug(flow,session,stepCount){
  if(!session||session.workflowId!==flow?.id)throw new Error('Debugger session is for another workflow');
  if(!Number.isInteger(stepCount)||stepCount<0||stepCount>session.trace.length||!session.snapshots?.[stepCount])
    throw new Error('Invalid debugger history position');
  const at=copy(session.snapshots[stepCount]);
  return {...session,...at,paused:false,snapshots:copy(session.snapshots.slice(0,stepCount+1))};
}
/** Re-execute the trace from its recorded initial inputs and detect changed workflow logic.
 * A replay performs only in-memory simulation; it cannot call a data handler. */
export function replayWorkflowDebug(flow,session){
  if(!session||session.workflowId!==flow?.id)throw new Error('Debugger session is for another workflow');
  const expected=copy(session.trace);
  let next=rewindWorkflowDebug(flow,session,0);
  for(const trace of expected){
    next=stepWorkflowDebug(flow,next);
    if(JSON.stringify(next.trace.at(-1))!==JSON.stringify(trace))
      throw new Error(`Workflow replay diverged at ${trace.stepId}`);
  }
  return {...next,paused:session.paused};
}
