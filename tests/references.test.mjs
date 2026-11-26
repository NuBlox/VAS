import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, validateProject, cloneProject, walkNodes} from '../src/lib/studio/model.js';
import {scaffoldModelCrud} from '../src/lib/studio/scaffold.js';
import {pickerMetadata, preferredDisplayField} from '../src/lib/studio/references.js';
import {referenceQuery, publishedPicker, searchReferences, assertReferencedValues} from '../src/lib/server/runtime/references.js';
import {createAcceptanceProject} from '../scripts/generate-customer-order-acceptance.mjs';
import {inspectWorkflowContext} from '../src/lib/studio/inspection.js';

function fixture(){
  const project=createProject();
  const {createPageId}=scaffoldModelCrud(project,'model_order');
  const page=project.pages.find(p=>p.id===createPageId);
  let picker;
  walkNodes(page.components,n=>{if(n.props?.field==='customer_id')picker=n;});
  return {project,page,picker,config:pickerMetadata(project,picker)};
}
const viewer={id:'viewer',role:'viewer'},editor={id:'editor',role:'editor'};

test('scaffolded foreign-key control is searchable, typed and uses published canonical IDs',()=>{
  const {project,page,picker,config}=fixture();
  assert.equal(picker.type,'select');
  assert.equal(picker.props.referenceDisplayFieldId,preferredDisplayField(project.models[0]));
  assert.equal(config.model.id,'model_order');
  assert.equal(config.field.name,'customer_id');
  assert.equal(config.target.id,'model_customer');
  assert.equal(config.primary.name,'id');
  assert.equal(config.display.name,'name');
  assert.deepEqual(publishedPicker(project,page.id,picker.id),config);
  assert.equal(validateProject(project),project);
});

test('published picker refuses forged page, component, unrelated display or dangling relationship',()=>{
  const {project,page,picker}=fixture();
  assert.throws(()=>publishedPicker(project,'fake',picker.id),{status:404});
  assert.throws(()=>publishedPicker(project,page.id,'fake'),{status:404});
  const unrelated=cloneProject(project); let field;
  walkNodes(unrelated.pages.find(p=>p.id===page.id).components,n=>{if(n.id===picker.id)field=n;});
  field.props.referenceDisplayFieldId='field_order_name';
  assert.throws(()=>validateProject(unrelated),/foreign key|picker|reference|binding/i);
  field.props.referenceDisplayFieldId='field_customer_name';
  field.props.bindingFieldId='field_order_name';
  assert.throws(()=>validateProject(unrelated),/foreign key|picker|reference|binding/i);
  const missing=cloneProject(project);
  missing.models[0].fields=missing.models[0].fields.filter(f=>f.name!=='name');
  assert.throws(()=>validateProject(missing),/foreign key|picker|reference|binding/i);
});

test('reference search generates a bounded parameterised, wildcard-escaped query',()=>{
  const {config}=fixture();
  const q=referenceQuery(config,"A_%!'");
  assert.match(q.sql,/`customers`/);
  assert.match(q.sql,/LIKE \? ESCAPE/);
  assert.match(q.sql,/LIMIT 20$/);
  assert.doesNotMatch(q.sql,/A_%/);
  assert.deepEqual(q.params,["%A!_!%!!'%"]);
  assert.throws(()=>referenceQuery(config,'x'.repeat(81)),{status:400});
  assert.throws(()=>referenceQuery(config,'bad\nsearch'),{status:400});
});

test('authenticated picker enforces target-model read policy, returning only ID and label',async()=>{
  const {project,page,picker}=fixture();
  const statements=[];
  const connection={execute:async(sql,params)=>{statements.push([sql,params]);return [[{id:'1',label:'Ada Lovelace',private_data:'hidden'}]];}};
  const options=await searchReferences(connection,project,page.id,picker.id,'Ada',viewer,null);
  assert.deepEqual(options,[{id:'1',label:'Ada Lovelace'}]);
  assert.deepEqual(statements[0][1],['%Ada%']);
  await assert.rejects(searchReferences(connection,project,page.id,picker.id,'',viewer,
    {models:{model_customer:{read:['editor','admin']}}}),{status:403});
  assert.equal(statements.length,1);
  await assert.rejects(searchReferences(connection,project,page.id,'other','',editor,null),{status:404});
  assert.equal(statements.length,1);
});

test('FK writes verify referenced row and read permission, and reject missing or forged IDs',async()=>{
  const project=createProject(),model=project.models[1];
  const connection={execute:async()=>[[{id:1}]]};
  await assertReferencedValues(connection,project,model,{customer_id:'1'},editor,null);
  await assert.rejects(assertReferencedValues(connection,project,model,{customer_id:'1'},editor,
    {models:{model_customer:{read:['admin']}}}),{status:403});
  await assert.rejects(assertReferencedValues(connection,project,model,{customer_id:'1 OR 1=1'},editor,null),{status:400});
  await assert.rejects(assertReferencedValues({execute:async()=>[[]]},project,model,{customer_id:'999'},editor,null),{status:409});
  await assertReferencedValues({execute:async()=>{throw Error('Should not query')}},project,model,{amount:'10'},editor,null);
});

test('acceptance Order form now uses record picker without editing generated code',()=>{
  const project=createAcceptanceProject();
  let picker;
  walkNodes(project.pages[1].components,n=>{if(n.id==='acceptance_order_customer')picker=n;});
  assert.equal(picker.type,'select');
  assert.equal(picker.props.field,'customer_id');
  assert.equal(picker.props.referenceDisplayFieldId,'field_customer_name');
  assert.equal(validateProject(project),project);
});

test('dry-run inspector resolves relationship names without a database query',()=>{
  const project=createAcceptanceProject(),flow=project.workflows.find(w=>w.id==='workflow_acceptance_order_create');
  const record={id:'42',name:'Ada Lovelace'};
  const result=inspectWorkflowContext(project,flow,{fields:{customer_id:'42'},records:{[project.models[0].id]:[record]}});
  assert.equal(result.references.length,1);
  assert.equal(result.references[0].selectedId,'42');
  assert.equal(result.references[0].label,'Ada Lovelace');
  assert.equal(result.references[0].status,'resolved');
  const missing=inspectWorkflowContext(project,flow,{fields:{customer_id:'100'},records:{[project.models[0].id]:[record]}});
  assert.equal(missing.references[0].status,'not-in-snapshot');
  assert.ok(missing.diagnostics.some(d=>d.componentId==='acceptance_order_customer'));
});
