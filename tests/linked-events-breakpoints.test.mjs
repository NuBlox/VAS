import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, cloneProject, createComponent, validateProject, saveComponentTemplate,
  insertLinkedTemplate, insertComponentTemplate, findLinkedInstance,
  editMasterProperties, overrideLinkedProperties, resetLinkedOverrides,
  detachLinkedInstance, deleteComponentTemplate, duplicateNode, walkNodes
} from '../src/lib/studio/model.js';
import { createWorkflow, workflowForTrigger, triggerEventsForType } from '../src/lib/studio/workflow.js';
import { validateWorkflowInvocation } from '../src/lib/server/runtime/workflow-execution.js';
import { startWorkflowDebug, stepWorkflowDebug, continueWorkflowDebug, finishWorkflowDebug } from '../src/lib/studio/debugger.js';

const project=()=>validateProject(createProject());
const nodeIds=node=>{const result=[];walkNodes([node],n=>result.push(n.id));return result;};

test('linked instances receive master property updates without losing local overrides',()=>{
  const p=project();
  const t=saveComponentTemplate(p,p.pages[0].components[1],'Reusable welcome','template_shared');
  const first=insertLinkedTemplate(p,t.id,p.pages[0].id);
  const second=insertLinkedTemplate(p,t.id,p.pages[1].id);
  const copy=insertComponentTemplate(p,t.id,p.pages[1].id);
  const original=copy.children[0].props.text;
  assert.equal(new Set([...nodeIds(first),...nodeIds(second),...nodeIds(copy)]).size,nodeIds(first).length*3);
  overrideLinkedProperties(p,p.pages[0].id,first.children[0].id,{text:'Local change'});
  editMasterProperties(p,t.id,t.node.children[0].id,{text:'Shared change'});
  assert.equal(first.children[0].props.text,'Local change');
  assert.equal(second.children[0].props.text,'Shared change');
  assert.equal(copy.children[0].props.text,original);
  validateProject(p);
  resetLinkedOverrides(p,p.pages[0].id,first.children[0].id);
  assert.equal(first.children[0].props.text,'Shared change');
  assert.throws(()=>deleteComponentTemplate(p,t.id),/Detach linked instances/);
  detachLinkedInstance(p.pages[0],first.children[0].id);
  detachLinkedInstance(p.pages[1],second.id);
  deleteComponentTemplate(p,t.id);
  assert.equal(p.templates.length,0);
  validateProject(p);
});

test('linked instance metadata is checked on import and isolated copies',()=>{
  const p=project();const t=saveComponentTemplate(p,p.pages[0].components[1],'Master');
  const inst=insertLinkedTemplate(p,t.id,p.pages[1].id);
  const independent=duplicateNode(inst);
  assert.equal(independent.sourceTemplateId,undefined);
  assert.equal(independent.children[0].sourceTemplateNodeId,undefined);
  const corrupt=cloneProject(p);
  corrupt.pages[1].components.at(-1).children[0].props.text='Untracked edit';
  assert.throws(()=>validateProject(corrupt),/differ from the master/);
  const missing=cloneProject(p);
  missing.templates=[];
  assert.throws(()=>validateProject(missing),/Missing reusable component master/);
  assert.throws(()=>overrideLinkedProperties(p,p.pages[1].id,inst.children[0].id,{html:'<script>'}),/override/);
  assert.throws(()=>insertLinkedTemplate(p,t.id,p.pages[1].id,inst.id),/Detach/);
});

test('component change and blur events validate, and server refuses spoofed trigger events',()=>{
  const p=project();const page=p.pages[1];const input=page.components.find(n=>n.type==='input');
  const flow=createWorkflow(page.id,input.id,'Name changed','workflow_changed','change');
  p.workflows.push(flow);
  assert.deepEqual(triggerEventsForType('input'),['change','blur']);
  assert.deepEqual(triggerEventsForType('checkbox'),['change']);
  assert.equal(workflowForTrigger(p,page.id,input.id,'change')?.id,flow.id);
  validateProject(p);
  const payload={pageId:page.id,componentId:input.id,event:'change',fields:{name:'Ada',email:'ada@example.com'},selectedRecords:{}};
  assert.equal(validateWorkflowInvocation(p,flow.id,payload).flow,flow);
  assert.throws(()=>validateWorkflowInvocation(p,flow.id,{...payload,event:'click'}),/trigger/);
  assert.throws(()=>validateWorkflowInvocation(p,flow.id,{...payload,componentId:'component_form_save'}),/trigger/);
  const withBlur=cloneProject(p);
  withBlur.workflows.push(createWorkflow(page.id,input.id,'Name blurred','workflow_blurred','blur'));
  assert.equal(validateProject(withBlur),withBlur);
  withBlur.workflows[1].trigger.event='keyup';
  assert.throws(()=>validateProject(withBlur),/supported component event/);
});

test('debugger pauses before breakpoints, continues once and never executes data actions',()=>{
  const p=project(),flow=p.workflows[0];
  const start=startWorkflowDebug(flow,{fields:{name:'Ada'},breakpoints:['step_check_name','step_create_customer']});
  const paused=continueWorkflowDebug(flow,start);
  assert.equal(paused.paused,true);
  assert.equal(paused.currentStepId,'step_check_name');
  assert.equal(paused.trace.length,0);
  const afterFirst=continueWorkflowDebug(flow,paused);
  assert.equal(afterFirst.currentStepId,'step_create_customer');
  assert.equal(afterFirst.trace.length,1);
  const done=continueWorkflowDebug(flow,afterFirst);
  assert.equal(done.finished,true);
  assert.equal(done.trace.length,3);
  assert.equal(done.effects[0].simulated,true);
  assert.deepEqual(start.effects,[]);
  const single=stepWorkflowDebug(flow,paused);
  assert.equal(single.paused,false);
  assert.equal(single.trace.length,1);
  assert.equal(finishWorkflowDebug(flow,single).finished,true);
  assert.throws(()=>startWorkflowDebug(flow,{breakpoints:['missing']}),/breakpoints/);
});
