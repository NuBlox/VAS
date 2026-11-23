import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject, createComponent, migrateProject, validateProject, cloneProject} from '../src/lib/studio/model.js';
import {createStep, createWorkflow, stepTargets, insertWorkflowStep, removeWorkflowStep, workflowForButton, conditionResult, executeWorkflow, workflowDiagram} from '../src/lib/studio/workflow.js';
import {projectRevision} from '../src/lib/studio/revision.js';
const seed=()=>createProject();
test('version 3 project carries a validated branched customer workflow',()=>{
  const p=seed();validateProject(p);const flow=p.workflows[0];
  assert.equal(flow.trigger.event,'click');assert.equal(stepTargets(flow.steps[0]).length,2);
  assert.equal(workflowForButton(p,flow.trigger.pageId,flow.trigger.componentId)?.id,flow.id);
  assert.deepEqual(workflowDiagram(flow).nodes.map(x=>x.id).sort(),flow.steps.map(x=>x.id).sort());
  assert.equal(workflowDiagram(flow).edges.length,3);
});
test('schema 1 and schema 2 projects migrate losslessly to 3 and reject unknown versions',()=>{
  const p=seed();const v2=cloneProject(p);v2.schemaVersion=2;delete v2.workflows;
  const migrated=validateProject(migrateProject(v2));
  assert.equal(migrated.schemaVersion,3);assert.deepEqual(migrated.workflows,[]);assert.deepEqual(migrated.pages,v2.pages);assert.deepEqual(migrated.models,v2.models);
  const v1={schemaVersion:1,id:p.id,name:p.name,pages:[{...p.pages[0],components:[]}]};
  assert.deepEqual(validateProject(migrateProject(v1)).models,[]);
  assert.throws(()=>migrateProject({schemaVersion:77}),/Unsupported/);
});
test('strict connections reject cycles, bad targets, orphan steps and duplicate triggers',()=>{
  let p=seed();let f=p.workflows[0];f.steps[2].nextId=f.startStepId;
  assert.throws(()=>validateProject(p),/cycles/);
  p=seed();f=p.workflows[0];f.steps[1].nextId='missing';assert.throws(()=>validateProject(p),/missing step/);
  p=seed();f=p.workflows[0];f.steps.push(createStep('message','orphan',{text:'never called'}));assert.throws(()=>validateProject(p),/unreachable/);
  p=seed();p.workflows.push(cloneProject(p.workflows[0]));p.workflows[1].id='different';assert.throws(()=>validateProject(p),/one workflow/);
  p=seed();p.workflows[0].trigger.componentId='does_not_exist';assert.throws(()=>validateProject(p),/trigger button/);
});
test('rejects injected step properties and non-existent models or form fields',()=>{
  let p=seed();p.workflows[0].steps[1].sql='DROP TABLE customers';assert.throws(()=>validateProject(p),/Invalid workflow step properties/);
  p=seed();p.workflows[0].steps[1].modelId='missing';assert.throws(()=>validateProject(p),/valid model/);
  p=seed();p.workflows[0].steps[0].field='missing';assert.throws(()=>validateProject(p),/form field/);
  p=seed();p.workflows[0].steps[2].text='';assert.throws(()=>validateProject(p),/cannot be empty/);
});
test('step insertion preserves downstream edges; step removal reconnects them',()=>{
  const p=seed(),flow=p.workflows[0],create=flow.steps[1];
  const next=create.nextId,newStep=createStep('message','inserted',{text:'Intermediate'});
  insertWorkflowStep(flow,newStep,create.id);
  assert.equal(create.nextId,'inserted');assert.equal(newStep.nextId,next);validateProject(p);
  removeWorkflowStep(flow,'inserted');assert.equal(create.nextId,next);validateProject(p);
  assert.throws(()=>removeWorkflowStep(flow,flow.startStepId),/Reconnect/);
});
test('workflow conditions evaluate strings, booleans, numbers and selection deterministically',()=>{
  const step=createStep('condition','x',{field:'quantity',operator:'greater_than',value:'3'});
  assert.equal(conditionResult(step,{fields:{quantity:5}}),true);
  assert.equal(conditionResult(step,{fields:{quantity:''}}),false);
  step.operator='filled';assert.equal(conditionResult(step,{fields:{quantity:false}}),false);
  step.operator='equals';step.value='5';assert.equal(conditionResult(step,{fields:{quantity:5}}),true);
  step.operator='selected';step.modelId='m';assert.equal(conditionResult(step,{selectedRecords:{m:'12'}}),true);
});
test('workflow executes false and true branches with async actions and trace',async()=>{
  const p=seed(),flow=p.workflows[0],events=[];
  const handlers={data:async(op,id)=>events.push(`${op}:${id}`),message:async text=>events.push(text),navigate:async()=>{},reset:async()=>{},setField:async()=>{}};
  const falseTrace=await executeWorkflow(flow,{fields:{name:''}},handlers);
  assert.deepEqual(falseTrace.map(x=>x.type),['condition','message']);assert.match(events[0],/enter the customer name/i);
  events.length=0;
  const trueTrace=await executeWorkflow(flow,{fields:{name:'Ada'}},handlers);
  assert.deepEqual(trueTrace.map(x=>x.type),['condition','create','message']);
  assert.match(events[0],/^create:/);assert.match(events[1],/successfully/);
});
test('workflow runner can set fields, navigate and reset without evaluating expressions',async()=>{
  const flow={startStepId:'a',steps:[createStep('set_field','a',{field:'name',value:'literal <script>',nextId:'b'}),createStep('navigate','b',{pageId:'p',nextId:'c'}),createStep('reset','c')]};
  const changes=[];const context={fields:{name:'initial'},selectedRecords:{m:'5'}};
  const trace=await executeWorkflow(flow,context,{setField:async(k,v)=>changes.push([k,v]),navigate:async id=>changes.push(['page',id]),reset:async()=>changes.push(['reset']),message:async()=>{},data:async()=>{}});
  assert.deepEqual(changes,[['name','literal <script>'],['page','p'],['reset']]);
  assert.deepEqual(trace.map(t=>t.type),['set_field','navigate','reset']);assert.deepEqual(context.fields,{});
});
test('workflow runner bounds execution and stops on a rejected database action',async()=>{
  const loop={startStepId:'a',steps:[createStep('message','a',{nextId:'a'})]};
  await assert.rejects(executeWorkflow(loop,{fields:{}},{message:async()=>{}}),/cycle/);
  const flow={startStepId:'a',steps:[createStep('create','a',{modelId:'m',nextId:'b'}),createStep('message','b',{text:'Should not run'})]};
  let showedMessage=false;
  await assert.rejects(executeWorkflow(flow,{fields:{}},{data:async()=>{throw Error('Database down');},message:async()=>{showedMessage=true;}}),/Database down/);
  assert.equal(showedMessage,false);
  await assert.rejects(executeWorkflow(flow,{fields:{}},{},{maxSteps:0}),/limit/);
});
test('published runtime project and revision include workflows',()=>{
  const data=JSON.parse(readFileSync(new URL('../runtime/project.json',import.meta.url),'utf8'));
  validateProject(data);assert.ok(data.workflows.length);
  const updated=cloneProject(data);updated.workflows[0].steps.at(-1).text='different';
  assert.notEqual(projectRevision(data),projectRevision(updated));
});
test('workflow can attach to any unassigned button, preserving existing legacy actions',()=>{
  const p=seed(),pg=p.pages[0],btn=createComponent('button','wf_extra_button');pg.components.push(btn);
  const extra=createWorkflow(pg.id,btn.id,'New action','wf_extra');
  p.workflows.push(extra);validateProject(p);
  assert.equal(btn.props.action,'submit');assert.equal(workflowForButton(p,pg.id,btn.id).name,'New action');
});
