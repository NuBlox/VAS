import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, validateProject, cloneProject, saveComponentTemplate,
  insertLinkedTemplate, exposeTemplateInput, bindLinkedInput, createComponent,
  setLinkedInput, renderPageComponents, walkNodes
} from '../src/lib/studio/model.js';
import { inspectPageBindings, inspectWorkflowContext } from '../src/lib/studio/inspection.js';

function setup(){
  const project=createProject();
  const master=project.pages[0].components[1];
  const template=saveComponentTemplate(project,master,'Customer summary');
  const page=project.pages[1];
  const instance=insertLinkedTemplate(project,template.id,page.id);
  const heading=template.node.children.find(n=>n.type==='heading')??template.node.children[0];
  exposeTemplateInput(project,template.id,heading.id,'text','heading');
  return {project,template,page,instance,heading};
}
function inspectedNode(project,page,componentId,context){
  let node;walkNodes(renderPageComponents(project,page,context),n=>{if(n.id===componentId)node=n;});return node;
}

test('inspector and page renderer agree on typed live form data, without metadata mutation',()=>{
  const {project,page,instance}=setup();
  bindLinkedInput(project,page.id,instance.id,'heading',{source:'form',field:'name'});
  validateProject(project);
  const saved=cloneProject(project);
  const context={fields:{name:'Ada Lovelace'}};
  const result=inspectPageBindings(project,page,context);
  assert.equal(result.diagnostics.length,0);
  assert.equal(result.rows.length,1);
  const row=result.rows[0];
  assert.equal(row.status,'resolved');assert.equal(row.source,'form');assert.equal(row.value,'Ada Lovelace');
  assert.equal(inspectedNode(project,page,row.componentId,context).props.text,row.value);
  assert.deepEqual(project,saved,'inspection and rendering must not persist runtime values');
});

test('missing and wrongly typed form values show the same safe fallback as the renderer',()=>{
  const {project,page,instance}=setup();
  bindLinkedInput(project,page.id,instance.id,'heading',{source:'form',field:'name'});
  for(const [context,status] of [[{fields:{}},'missing'],[{fields:{name:42}},'type-mismatch']]){
    const result=inspectPageBindings(project,page,context);
    assert.equal(result.rows[0].status,status);
    assert.equal(result.diagnostics[0].componentId,result.rows[0].componentId);
    assert.equal(result.rows[0].value,inspectedNode(project,page,result.rows[0].componentId,context).props.text);
  }
});

test('selected record inspection resolves primary key and reports missing records without leaking state',()=>{
  const {project,page,instance}=setup();
  bindLinkedInput(project,page.id,instance.id,'heading',{source:'record',modelId:'model_customer',fieldId:'field_customer_name'});
  const context={selected:{model_customer:9},records:{model_customer:[{id:8,name:'Ada'},{id:9,name:'Grace'}]}};
  const resolved=inspectPageBindings(project,page,context);
  assert.equal(resolved.rows[0].status,'resolved');assert.equal(resolved.rows[0].value,'Grace');
  const unmatched=inspectPageBindings(project,page,{...context,selected:{model_customer:30}});
  assert.equal(unmatched.rows[0].status,'missing');
  assert.match(unmatched.diagnostics[0].message,/not present/);
  const noSelection=inspectPageBindings(project,page,{...context,selected:{}});
  assert.equal(noSelection.rows[0].status,'missing');
  assert.match(noSelection.diagnostics[0].message,/No record is selected/);
  assert.equal(inspectedNode(project,page,resolved.rows[0].componentId,context).props.text,'Grace');
});

test('static input values remain inspectable and form condition diagnostics trace source controls',()=>{
  const {project,page,instance}=setup();
  setLinkedInput(project,page.id,instance.id,'heading','Static heading');
  const inspected=inspectPageBindings(project,page);
  assert.equal(inspected.rows[0].status,'instance');assert.equal(inspected.rows[0].value,'Static heading');
  const flow=project.workflows[0];
  const missing=inspectWorkflowContext(project,flow,{fields:{},selectedRecords:{}});
  assert.ok(missing.diagnostics.some(d=>d.stepId==='step_check_name'&&/unset field/.test(d.message)));
  const ready=inspectWorkflowContext(project,flow,{fields:{name:'Ada'}});
  assert.equal(ready.conditions[0].result,true);
  assert.equal(ready.formFields.find(f=>f.field==='name').status,'ready');
  assert.equal(ready.pageId,flow.trigger.pageId);
});

test('checkbox trial input is boolean-typed, and inspection detects incompatible trial values',()=>{
  const project=createProject();const page=project.pages[1];
  const control=createComponent('checkbox','checkbox_trial');
  page.components.push(control);
  const flow=project.workflows[0];
  const incorrect=inspectWorkflowContext(project,flow,{fields:{[control.props.field]:'yes'}});
  assert.equal(incorrect.formFields.find(f=>f.field===control.props.field).status,'type-mismatch');
  assert.ok(incorrect.diagnostics.some(d=>d.componentId===control.id&&d.severity==='error'));
});
