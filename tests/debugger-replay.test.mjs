import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/lib/studio/model.js';
import {
  startWorkflowDebug, stepWorkflowDebug, finishWorkflowDebug,
  continueWorkflowDebug, rewindWorkflowDebug, replayWorkflowDebug
} from '../src/lib/studio/debugger.js';

function example(){const p=createProject();return p.workflows[0];}

test('each workflow step captures a complete reversible, independent simulation snapshot',()=>{
  const flow=example(),trial={fields:{name:'Ada'},selectedRecords:{}};
  const start=startWorkflowDebug(flow,trial);
  const afterCondition=stepWorkflowDebug(flow,start);
  const afterWrite=stepWorkflowDebug(flow,afterCondition);
  assert.equal(start.snapshots.length,1);assert.equal(afterCondition.snapshots.length,2);
  assert.equal(afterWrite.snapshots.length,3);
  assert.equal(afterCondition.trace[0].source,'Form field: name');
  assert.equal(afterCondition.trace[0].actual,'Ada');
  assert.equal(afterCondition.trace[0].outcome,'true');
  assert.equal(afterWrite.effects[0].simulated,true);
  const previous=rewindWorkflowDebug(flow,afterWrite,1);
  assert.equal(previous.currentStepId,'step_create_customer');
  assert.deepEqual(previous.effects,[]);
  assert.equal(previous.trace.length,1);
  assert.equal(stepWorkflowDebug(flow,previous).effects[0].operation,'create');
  assert.deepEqual(trial.fields,{name:'Ada'});
  assert.deepEqual(start.effects,[]);
});

test('deterministic replay reproduces true/false outcomes and detects changes to the graph',()=>{
  const flow=example();
  for(const name of ['Ada','']){
    const state=finishWorkflowDebug(flow,startWorkflowDebug(flow,{fields:{name}}));
    const replay=replayWorkflowDebug(flow,state);
    assert.deepEqual(replay.trace,state.trace);
    assert.deepEqual(replay.effects,state.effects);
    assert.deepEqual(replay.fields,state.fields);
    const modified=structuredClone(flow);
    modified.steps.find(x=>x.id==='step_check_name').operator='empty';
    assert.throws(()=>replayWorkflowDebug(modified,state),/replay diverged/);
    const changedMessage=structuredClone(flow);
    changedMessage.steps.find(x=>x.id===(name?'step_customer_created':'step_name_required')).text='A changed effect';
    assert.throws(()=>replayWorkflowDebug(changedMessage,state),/replay diverged/);
  }
});

test('breakpoint continuation and rewind do not execute data handlers or skip trace steps',()=>{
  const flow=example();
  let state=startWorkflowDebug(flow,{fields:{name:'Ada'},breakpoints:['step_create_customer']});
  state=continueWorkflowDebug(flow,state);
  assert.equal(state.paused,true);assert.equal(state.currentStepId,'step_create_customer');
  state=rewindWorkflowDebug(flow,state,0);
  assert.equal(state.trace.length,0);assert.equal(state.paused,false);
  state=continueWorkflowDebug(flow,state);
  assert.equal(state.paused,true);assert.equal(state.trace.length,1);
  state=continueWorkflowDebug(flow,state);
  assert.equal(state.finished,true);
  assert.equal(state.effects[0].simulated,true);
  assert.deepEqual(replayWorkflowDebug(flow,state).trace,state.trace);
});

test('invalid history, cross-workflow replay and input mutation are rejected',()=>{
  const flow=example(),state=startWorkflowDebug(flow,{fields:{name:'Ada'}});
  assert.throws(()=>rewindWorkflowDebug(flow,state,-1),/history/);
  assert.throws(()=>rewindWorkflowDebug(flow,state,1),/history/);
  assert.throws(()=>replayWorkflowDebug({...flow,id:'wrong'},state),/another workflow/);
  const replay=replayWorkflowDebug(flow,state);
  assert.deepEqual(replay.trace,[]);
});
