import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAcceptanceProject } from '../scripts/generate-customer-order-acceptance.mjs';
import { cloneProject, migrateProject, validateProject, renderPageComponents, walkNodes } from '../src/lib/studio/model.js';
import { inspectPageBindings, inspectWorkflowContext } from '../src/lib/studio/inspection.js';
import { startWorkflowDebug, finishWorkflowDebug, replayWorkflowDebug } from '../src/lib/studio/debugger.js';
import { eventContextForTrigger } from '../src/lib/studio/workflow.js';
import { validateWorkflowInvocation } from '../src/lib/server/runtime/workflow-execution.js';
import { releaseId } from '../src/lib/server/runtime/publication.js';
import { exportMySQL } from '../src/lib/studio/compiler.js';

const flow=(project,id)=>project.workflows.find(x=>x.id===id);
function triggerNode(project,workflow) {
  let node;
  const page=project.pages.find(x=>x.id===workflow.trigger.pageId);
  walkNodes(page.components,x=>{if(x.id===workflow.trigger.componentId)node=x;});
  return node;
}
function invoke(project,workflowId,fields,selectedRecords={}) {
  const workflow=flow(project,workflowId);
  return {pageId:workflow.trigger.pageId,componentId:workflow.trigger.componentId,
    event:workflow.trigger.event,fields,selectedRecords,
    eventContext:eventContextForTrigger(workflow,triggerNode(project,workflow),fields)};
}

test('no-code customer/order acceptance metadata has two pages, typed relationship and linked form/list instances',()=>{
  const project=createAcceptanceProject();
  assert.equal(project.pages.length,2);
  assert.deepEqual(project.pages.map(x=>x.path),['/customers','/orders']);
  assert.equal(project.models.length,2);
  assert.equal(project.models[1].fields.find(x=>x.name==='customer_id').referenceModelId,project.models[0].id);
  assert.equal(project.templates.length,1);
  const linked=project.pages.map(page=>page.components.find(x=>x.sourceTemplateId));
  assert.ok(linked.every(Boolean));
  assert.notEqual(linked[0].id,linked[1].id);
  assert.ok(linked.every(x=>x.slotFills.instructions.length===1));
  assert.equal(project.actions.length,1);
  assert.equal(project.workflows.length,8);
  assert.ok(project.workflows.filter(x=>x.steps.some(step=>step.type==='invoke_action')).length>=3);
  assert.deepEqual(validateProject(migrateProject(cloneProject(project))),project);
  assert.equal(releaseId(cloneProject(project)),releaseId(project));
  const ddl=exportMySQL(project);
  assert.match(ddl,/CREATE TABLE IF NOT EXISTS `vas_acceptance_customers`/);
  assert.match(ddl,/CREATE TABLE IF NOT EXISTS `vas_acceptance_orders`/);
  assert.match(ddl,/FOREIGN KEY \(`customer_id`\) REFERENCES `vas_acceptance_customers` \(`id`\)/);
});

test('visual bindings are resolved without mutating the saved application',()=>{
  const project=createAcceptanceProject();
  const prior=JSON.stringify(project);
  const customers=project.pages[0];
  const inspected=inspectPageBindings(project,customers,{fields:{name:'Ada'}});
  assert.ok(inspected.rows.some(r=>r.inputName==='current_name'&&r.value==='Ada'&&r.status==='resolved'));
  const rendered=renderPageComponents(project,customers,{fields:{name:'Ada'}});
  let label;walkNodes(rendered,x=>{if(x.type==='card'&&x.props.title==='Form preview')label=x.props.body;});
  assert.equal(label,'Ada');
  assert.equal(JSON.stringify(project),prior);
});

test('customer and order workflows simulate successful and missing-input cases with explainable deterministic traces',()=>{
  const project=createAcceptanceProject();
  const customer=flow(project,'workflow_acceptance_customers_create');
  const successful=finishWorkflowDebug(customer,startWorkflowDebug(customer,
    {fields:{name:'Ada',email:'ada@example.test'},actions:project.actions}));
  assert.ok(successful.effects.some(x=>x.type==='data'&&x.operation==='create'&&x.simulated));
  assert.ok(successful.effects.some(x=>x.type==='message'&&x.text==='Ada'));
  assert.deepEqual(replayWorkflowDebug(customer,successful).effects,successful.effects);
  const rejected=finishWorkflowDebug(customer,startWorkflowDebug(customer,{fields:{name:'',email:'ada@example.test'},actions:project.actions}));
  assert.ok(rejected.effects.some(x=>x.type==='message'&&x.text==='Customer name is required.'));
  assert.ok(!rejected.effects.some(x=>x.type==='data'));
  const diagnosed=inspectWorkflowContext(project,customer,{fields:{name:'',email:'ada@example.test'}});
  assert.equal(diagnosed.conditions.find(x=>x.stepId==='customers_name_check').result,false);
  const order=flow(project,'workflow_acceptance_order_create');
  const orderReady=finishWorkflowDebug(order,startWorkflowDebug(order,
    {fields:{order_name:'Site delivery',customer_id:'1',amount:'42.50'},actions:project.actions}));
  assert.ok(orderReady.effects.some(x=>x.type==='data'&&x.modelId==='model_order'));
  assert.deepEqual(replayWorkflowDebug(order,orderReady).trace,orderReady.trace);
  const noCustomer=finishWorkflowDebug(order,startWorkflowDebug(order,
    {fields:{order_name:'Site delivery',customer_id:'',amount:'42.50'},actions:project.actions}));
  assert.ok(!noCustomer.effects.some(x=>x.type==='data'));
});

test('typed change triggers and published server validation agree; client-invented values are rejected',()=>{
  const project=createAcceptanceProject();
  const id='workflow_acceptance_order_name_change';
  const payload=invoke(project,id,{order_name:'Site delivery'});
  const result=validateWorkflowInvocation(project,id,payload);
  assert.equal(result.context.eventContext.value,'Site delivery');
  assert.throws(()=>validateWorkflowInvocation(project,id,{...payload,eventContext:{...payload.eventContext,value:'tampered'}}),
    /Event context does not match/);
  assert.throws(()=>validateWorkflowInvocation(project,id,{...payload,fields:{unexpected:'x'}}),/Unexpected workflow form field/);
  const simulated=finishWorkflowDebug(flow(project,id),startWorkflowDebug(flow(project,id),{
    fields:payload.fields,eventContext:payload.eventContext,actions:project.actions}));
  assert.deepEqual(simulated.effects,[{type:'message',text:'Site delivery',simulated:true}]);
});

test('CLI exports an unchanged standalone app and verifies the published release',async t=>{
  const parent=await mkdtemp(join(tmpdir(),'vas16-customer-order-'));
  t.after(()=>rm(parent,{recursive:true,force:true}));
  const project=createAcceptanceProject();
  const input=join(parent,'project.json');const destination=join(parent,'app');
  await writeFile(input,JSON.stringify(project,null,2)+'\n');
  const exported=spawnSync(process.execPath,[resolve('scripts/export-application.mjs'),'--project',input,'--out',destination],
    {cwd:resolve('.'),encoding:'utf8'});
  assert.equal(exported.status,0,exported.stderr);
  const verified=spawnSync(process.execPath,['scripts/verify-release.mjs'],{cwd:destination,encoding:'utf8'});
  assert.equal(verified.status,0,verified.stderr);
  const snapshot=JSON.parse(await readFile(join(destination,'runtime/project.json'),'utf8'));
  const released=JSON.parse(await readFile(join(destination,'release.json'),'utf8'));
  assert.deepEqual(snapshot,project);
  assert.equal(released.releaseId,releaseId(project));
  assert.equal(snapshot.pages.length,2);
  assert.equal(snapshot.workflows.length,8);
  assert.match(await readFile(join(destination,'db/initial.mysql.sql'),'utf8'),/vas_acceptance_orders/);
  await access(join(destination,'src/lib/StandaloneApp.svelte'));
});
