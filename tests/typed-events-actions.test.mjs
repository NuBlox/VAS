import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, createComponent, cloneProject, validateProject } from '../src/lib/studio/model.js';
import {
  EVENT_VALUE_FIELD, createActionDefinition, createWorkflow, createStep,
  eventContextForTrigger, verifyEventContext, resolveActionValue,
  executeWorkflow, conditionResult
} from '../src/lib/studio/workflow.js';
import { startWorkflowDebug, finishWorkflowDebug } from '../src/lib/studio/debugger.js';
import { validateWorkflowInvocation, executePublishedWorkflow } from '../src/lib/server/runtime/workflow-execution.js';

const make = () => createProject();
const field = (project, id = 'component_form_name') => project.pages[1].components.find(c => c.id === id);
const form = { name:'Ada', email:'ada@example.com' };
const simpleDB = () => {
  const stats={begin:0,commit:0,rollback:0,release:0};
  return {stats,async getConnection(){return{
    async beginTransaction(){stats.begin++;},async commit(){stats.commit++;},
    async rollback(){stats.rollback++;},release(){stats.release++;}
  };}};
};
const handlers = effects => ({
  data: async (operation, modelId) => effects.push({type:'data',operation,modelId}),
  navigate: async pageId => effects.push({type:'navigate',pageId}),
  message: async text => effects.push({type:'message',text}),
  reset: async () => effects.push({type:'reset'}),
  setField: async (field,value) => effects.push({type:'set_field',field,value})
});
function installInputAction(p,componentId='component_form_name') {
  const node=field(p,componentId);
  const action=createActionDefinition('Show value','action_show_value');
  p.actions=[action];
  const flow=createWorkflow(p.pages[1].id,node.id,'Report value','flow_report_value','change');
  flow.steps=[createStep('invoke_action','step_invoke_value',{actionId:action.id,actionVersion:'1',inputSource:'event',literal:'',inputField:'',nextId:''})];
  flow.startStepId='step_invoke_value';p.workflows.push(flow);
  return {flow,action,node};
}

test('event metadata and value use strict published component contracts',()=>{
  const p=make(),{flow,node}=installInputAction(p);
  validateProject(p);
  const expected=eventContextForTrigger(flow,node,form);
  assert.deepEqual(expected,{pageId:p.pages[1].id,componentId:node.id,event:'change',field:'name',value:'Ada'});
  assert.deepEqual(verifyEventContext(flow,node,form,expected),expected);
  assert.throws(()=>verifyEventContext(flow,node,form,{...expected,value:'Mallory'}),/Event context/);
  assert.throws(()=>verifyEventContext(flow,node,form,{...expected,isAdmin:true}),/Event context/);
  assert.throws(()=>verifyEventContext(flow,node,{name:false},undefined),/Event value type/);
  assert.throws(()=>verifyEventContext(flow,node,{},expected),/Event context/);
  assert.throws(()=>validateWorkflowInvocation(p,flow.id,{pageId:p.pages[1].id,componentId:node.id,event:'change',eventContext:{...expected,value:'wrong'},fields:form,selectedRecords:{}}),/Event context/);
  assert.equal(validateWorkflowInvocation(p,flow.id,{pageId:p.pages[1].id,componentId:node.id,event:'change',eventContext:expected,fields:form,selectedRecords:{}}).context.eventContext.value,'Ada');
  // For backwards compatibility with v1.2 clients, the server derives an absent context from allowlisted fields.
  assert.equal(validateWorkflowInvocation(p,flow.id,{pageId:p.pages[1].id,componentId:node.id,event:'change',fields:form,selectedRecords:{}}).context.eventContext.value,'Ada');
});

test('reusable event action yields the same effects in memory, debugger and transaction runtime',async()=>{
  const p=make(),{flow,node}=installInputAction(p);
  validateProject(p);
  const eventContext=eventContextForTrigger(flow,node,form);
  const context={fields:{...form},selectedRecords:{},eventContext};
  const effects=[];
  const trace=await executeWorkflow(flow,context,handlers(effects),{actions:p.actions});
  assert.deepEqual(trace.map(x=>x.type),['invoke_action']);
  assert.deepEqual(effects,[{type:'message',text:'Ada'}]);
  const debug=finishWorkflowDebug(flow,startWorkflowDebug(flow,{fields:form,eventContext,actions:p.actions}));
  assert.deepEqual(debug.effects,[{type:'message',text:'Ada',simulated:true}]);
  const db=simpleDB();
  const payload={pageId:p.pages[1].id,componentId:node.id,event:'change',eventContext,fields:form,selectedRecords:{}};
  const server=await executePublishedWorkflow({project:p,workflowId:flow.id,payload,db});
  assert.deepEqual(server.effects,effects);
  assert.equal(server.committed,true);
  assert.deepEqual(db.stats,{begin:1,commit:1,rollback:0,release:1});
});

test('shared action definitions are callable by two workflows and version pinned',()=>{
  const p=make(),{action,node}=installInputAction(p);
  const email=field(p,'component_form_email');
  const second=createWorkflow(p.pages[1].id,email.id,'Email changed','workflow_email','change');
  second.steps=[createStep('invoke_action','step_email',{actionId:action.id,actionVersion:'1',inputSource:'event',inputField:'',literal:'',nextId:''})];
  second.startStepId='step_email';p.workflows.push(second);
  assert.equal(validateProject(p),p);
  p.actions[0].version=2;
  assert.throws(()=>validateProject(p),/version is invalid/);
  p.workflows.forEach(w=>w.steps.filter(s=>s.type==='invoke_action').forEach(s=>s.actionVersion='2'));
  assert.equal(validateProject(p),p);
  assert.throws(()=>validateProject({...p,actions:[{...p.actions[0],javascript:'fetch("/secrets")'}]}),/Invalid reusable action/);
});

test('actions support typed literals and form fields without arbitrary expression evaluation',async()=>{
  const p=make();
  const action=createActionDefinition('Copy field','action_copy');
  action.kind='set_field';action.targetField='email';
  p.actions=[action];
  const flow=p.workflows[0];
  flow.steps[0].trueId='step_copy';
  flow.steps.push(createStep('invoke_action','step_copy',{actionId:action.id,actionVersion:'1',inputSource:'field',inputField:'name',literal:'',nextId:'step_create_customer'}));
  validateProject(p);
  const effects=[];
  const context={fields:{name:'Ada',email:'original'},selectedRecords:{}};
  await executeWorkflow(flow,context,handlers(effects),{actions:p.actions});
  assert.equal(context.fields.email,'Ada');
  assert.deepEqual(effects[0],{type:'set_field',field:'email',value:'Ada'});
  assert.equal(resolveActionValue({inputType:'number'},{inputSource:'literal',literal:'24'},context),24);
  assert.equal(resolveActionValue({inputType:'boolean'},{inputSource:'literal',literal:'false'},context),false);
  assert.throws(()=>resolveActionValue({inputType:'number'},{inputSource:'literal',literal:'12; DROP TABLE'},context),/Numeric action literal/);
  assert.throws(()=>resolveActionValue({inputType:'boolean'},{inputSource:'literal',literal:'yes'},context),/Boolean action literal/);
  const wrong=cloneProject(p);wrong.actions[0].inputType='number';
  assert.throws(()=>validateProject(wrong),/incompatible type/);
});

test('checkbox triggers preserve boolean type and cannot feed a string action',async()=>{
  const p=make(),page=p.pages[1];
  const checkbox=createComponent('checkbox','component_accept');checkbox.props.field='accepted';page.components.push(checkbox);
  const action=createActionDefinition('Keep checked','action_accept');
  action.kind='set_field';action.targetField='accepted';action.inputType='boolean';p.actions=[action];
  const flow=createWorkflow(page.id,checkbox.id,'Checkbox changed','workflow_accept','change');
  flow.startStepId='step_accept';flow.steps=[createStep('invoke_action','step_accept',{actionId:action.id,actionVersion:'1',inputSource:'event',inputField:'',literal:'',nextId:''})];
  p.workflows.push(flow);validateProject(p);
  const fields={...form,accepted:true};const eventContext=eventContextForTrigger(flow,checkbox,fields);
  assert.equal(eventContext.value,true);
  const debug=finishWorkflowDebug(flow,startWorkflowDebug(flow,{fields,eventContext,actions:p.actions}));
  assert.deepEqual(debug.effects,[{type:'set_field',field:'accepted',value:true,simulated:true}]);
  const db=simpleDB();
  const result=await executePublishedWorkflow({project:p,workflowId:flow.id,payload:{pageId:page.id,componentId:checkbox.id,event:'change',fields,selectedRecords:{},eventContext},db});
  assert.deepEqual(result.effects,[{type:'set_field',field:'accepted',value:true}]);
  assert.throws(()=>validateWorkflowInvocation(p,flow.id,{pageId:page.id,componentId:checkbox.id,event:'change',fields,selectedRecords:{},eventContext:{...eventContext,value:'true'}}),/Event context/);
  p.actions[0].inputType='string';
  assert.throws(()=>validateProject(p),/incompatible type/);
});

test('event-value conditions select branches from the typed event context, not any other form field',async()=>{
  const p=make();const name=field(p);
  const flow=createWorkflow(p.pages[1].id,name.id,'Value test','workflow_event_branch','change');
  flow.startStepId='compare';flow.steps=[
    createStep('condition','compare',{field:EVENT_VALUE_FIELD,operator:'equals',value:'Ada',trueId:'yes',falseId:'no'}),
    createStep('message','yes',{text:'yes',nextId:''}),
    createStep('message','no',{text:'no',nextId:''})
  ];p.workflows.push(flow);validateProject(p);
  const effects=[];
  const context={fields:{name:'Not Ada'},selectedRecords:{},eventContext:{value:'Ada'}};
  await executeWorkflow(flow,context,handlers(effects));
  assert.equal(effects[0].text,'yes');
  assert.equal(conditionResult(flow.steps[0],context),true);
  assert.throws(()=>validateProject({...p,workflows:[{...flow,trigger:{...flow.trigger,componentId:'component_form_save',event:'click'}}]}),/Event value condition/);
});

test('v1.2 schema-3 projects without reusable actions remain valid',async()=>{
  const p=make();delete p.actions;
  validateProject(p);
  const effects=[];
  const trace=await executeWorkflow(p.workflows[0],{fields:form,selectedRecords:{}},handlers(effects));
  assert.deepEqual(trace.map(x=>x.type),['condition','create','message']);
});

test('generated application template forwards published event payloads',()=>{
  const source=readFileSync(new URL('../templates/standalone/src/lib/StandaloneApp.svelte',import.meta.url),'utf8');
  assert.match(source,/eventContextForTrigger\(workflow,node,fields\)/);
  assert.match(source,/eventContext:\s*eventContextForTrigger/);
});
