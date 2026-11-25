import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, createComponent, cloneProject, walkNodes, validateProject,
  saveComponentTemplate, insertComponentTemplate, deleteComponentTemplate, findNodeLocation
} from '../src/lib/studio/model.js';
import { startWorkflowDebug, stepWorkflowDebug, finishWorkflowDebug } from '../src/lib/studio/debugger.js';

function ids(node) {const result=[];walkNodes([node],n=>result.push(n.id));return result;}

test('reusable nested layout snapshots are independent and new insertions regenerate all IDs',()=>{
  const project=createProject();
  const original=project.pages[0].components[1];
  const template=saveComponentTemplate(project,original,'Welcome panel','template_welcome');
  const snapshot=cloneProject(template.node);
  original.children[0].props.text='Changed on page';
  assert.deepEqual(template.node,snapshot);
  const inserted=insertComponentTemplate(project,'template_welcome',project.pages[1].id);
  const second=insertComponentTemplate(project,'template_welcome',project.pages[1].id);
  assert.equal(inserted.type,'section');
  assert.equal(inserted.children[0].props.text,snapshot.children[0].props.text);
  assert.equal(ids(inserted).length,ids(original).length);
  assert.equal(new Set([...ids(original),...ids(template.node),...ids(inserted),...ids(second)]).size,ids(original).length*4);
  validateProject(project);
  deleteComponentTemplate(project,template.id);
  assert.equal(project.templates.length,0);
  assert.ok(findNodeLocation(project.pages[1],inserted.id));
});

test('templates persist as optional schema v3 metadata and can be rejected safely',()=>{
  const p=createProject();assert.equal(Object.hasOwn(p,'templates'),false);
  saveComponentTemplate(p,createComponent('button'),'Quick action','template_action');
  assert.equal(validateProject(p),p);
  const restored=cloneProject(p);assert.equal(validateProject(restored),restored);
  assert.equal(restored.templates[0].name,'Quick action');
  restored.templates.push({...restored.templates[0]});
  assert.throws(()=>validateProject(restored),/duplicate reusable/);
  restored.templates.pop();restored.templates[0].node.props.action='drop database';
  assert.throws(()=>validateProject(restored),/button action/);
  assert.throws(()=>insertComponentTemplate(p,'unknown',p.pages[0].id),/not found/);
});

test('template model bindings remain restricted to valid model fields',()=>{
  const p=createProject();
  saveComponentTemplate(p,p.pages[1].components[2],'Customer name');
  validateProject(p);
  p.templates[0].node.props.bindingFieldId='missing';
  assert.throws(()=>validateProject(p),/Broken reusable component binding/);
});

test('debugger steps condition branches without performing database writes',()=>{
  const project=createProject(),flow=project.workflows[0];
  const input={fields:{name:'Ada Lovelace'},selectedRecords:{}};
  const first=startWorkflowDebug(flow,input);
  const condition=stepWorkflowDebug(flow,first);
  assert.equal(first.trace.length,0);
  assert.equal(condition.trace[0].outcome,'true');
  assert.equal(condition.currentStepId,'step_create_customer');
  const created=stepWorkflowDebug(flow,condition);
  assert.deepEqual(created.effects,[{type:'data',operation:'create',modelId:'model_customer',simulated:true}]);
  const done=finishWorkflowDebug(flow,created);
  assert.equal(done.finished,true);
  assert.deepEqual(done.trace.map(x=>x.type),['condition','create','message']);
  assert.deepEqual(done.effects.at(-1),{type:'message',text:'Customer saved successfully.',simulated:true});
  assert.equal(input.fields.name,'Ada Lovelace');
  assert.deepEqual(first.effects,[]);
});

test('debugger evaluates false branch and safely tracks form mutation',()=>{
  const project=createProject(),flow=project.workflows[0];
  const blank=finishWorkflowDebug(flow,startWorkflowDebug(flow,{fields:{name:''}}));
  assert.deepEqual(blank.trace.map(x=>x.stepId),['step_check_name','step_name_required']);
  assert.equal(blank.trace[0].outcome,'false');
  assert.equal(blank.effects[0].text,'Please enter the customer name.');
  const custom={id:'flow_custom',startStepId:'set',steps:[
    {id:'set',type:'set_field',field:'customer',value:'New',nextId:'reset'},
    {id:'reset',type:'reset',nextId:'stop'},
    {id:'stop',type:'stop'}
  ]};
  const original={fields:{customer:'Old'},selectedRecords:{x:'42'}};
  const start=startWorkflowDebug(custom,original),afterSet=stepWorkflowDebug(custom,start);
  assert.equal(afterSet.fields.customer,'New');assert.equal(start.fields.customer,'Old');
  const complete=finishWorkflowDebug(custom,afterSet);
  assert.deepEqual(complete.fields,{});
  assert.deepEqual(complete.selectedRecords,{});
  assert.deepEqual(original.selectedRecords,{x:'42'});
});

test('debugger refuses cross-workflow sessions and invalid graphs',()=>{
  const flow={id:'example',startStepId:'a',steps:[{id:'a',type:'message',text:'hello',nextId:'a'}]};
  const session=startWorkflowDebug(flow);
  assert.throws(()=>stepWorkflowDebug({id:'other',steps:[]},session),/another workflow/);
  assert.throws(()=>finishWorkflowDebug(flow,session),/cycle detected/);
  assert.throws(()=>startWorkflowDebug(flow,{fields:[]}),/objects/);
  const unknown={id:'missing',startStepId:'absent',steps:[]};
  assert.throws(()=>stepWorkflowDebug(unknown,startWorkflowDebug(unknown)),/missing step/);
});
