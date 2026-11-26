/**
 * Real MySQL acceptance gate. Run ONLY against an explicitly disposable
 * localhost visual_studio_dev database. Invoked separately in GitHub CI after
 * the normal tests, so audit-table cleanup from other suites cannot race it.
 * This exercises the runtime COPIED INTO the generated SvelteKit application.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createAcceptanceProject } from '../scripts/generate-customer-order-acceptance.mjs';
import { exportMySQL } from '../src/lib/studio/compiler.js';
import { cloneProject, validateProject, walkNodes } from '../src/lib/studio/model.js';
import { createStep, eventContextForTrigger } from '../src/lib/studio/workflow.js';

const safe=(process.env.GITHUB_ACTIONS==='true' || process.env.VAS_ACCEPTANCE_DISPOSABLE==='yes') &&
  process.env.MYSQL_INTEGRATION==='1' &&
  (process.env.DB_HOST??'127.0.0.1')==='127.0.0.1' &&
  (process.env.DB_NAME??'visual_studio_dev')==='visual_studio_dev';

function invocation(project,id,fields,selectedRecords={},confirmDelete=false) {
  const flow=project.workflows.find(item=>item.id===id);
  assert.ok(flow,`Missing workflow ${id}`);
  const page=project.pages.find(item=>item.id===flow.trigger.pageId);
  let node;walkNodes(page.components,item=>{if(item.id===flow.trigger.componentId)node=item;});
  assert.ok(node);
  return {pageId:page.id,componentId:node.id,event:flow.trigger.event,
    fields,selectedRecords,eventContext:eventContextForTrigger(flow,node,fields),confirmDelete};
}

test('standalone Customer/Order CRUD, FK, audit, roles, idempotency and rollback with MySQL 8',{
  skip: safe ? false : 'Requires MYSQL_INTEGRATION=1, a disposable loopback visual_studio_dev database and CI or VAS_ACCEPTANCE_DISPOSABLE=yes'
}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'vas16-db-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const project=createAcceptanceProject();
  const projectFile=join(directory,'project.json'),out=join(directory,'generated-app');
  await writeFile(projectFile,JSON.stringify(project,null,2)+'\n');
  const run=spawnSync(process.execPath,[resolve('scripts/export-application.mjs'),'--project',projectFile,'--out',out],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const generated=await import(pathToFileURL(join(out,'src/lib/server/runtime/workflow-execution.js')).href);
  const generatedStore=await import(pathToFileURL(join(out,'src/lib/server/runtime/store.js')).href);
  const generatedReferences=await import(pathToFileURL(join(out,'src/lib/server/runtime/references.js')).href);
  const {createPool}=await import('mysql2/promise');
  const pool=createPool({host:process.env.DB_HOST??'127.0.0.1',port:Number(process.env.DB_PORT??3306),
    user:process.env.DB_USER??'root',password:process.env.DB_PASSWORD??'',database:process.env.DB_NAME??'visual_studio_dev',
    connectionLimit:4,multipleStatements:false,bigNumberStrings:true,dateStrings:true});
  const [customer,order]=project.models;
  const customerTable='`vas_acceptance_customers`',orderTable='`vas_acceptance_orders`';
  try {
    // A deliberately destructive setup is protected by the safe opt-in gate.
    await pool.query(`DROP TABLE IF EXISTS ${orderTable}`);
    await pool.query(`DROP TABLE IF EXISTS ${customerTable}`);
    for(const sql of exportMySQL(project).split(';').map(x=>x.trim()).filter(Boolean))await pool.query(sql);
    await pool.query('CREATE DATABASE IF NOT EXISTS `visual_studio_audit` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
    const {readFile}=await import('node:fs/promises');
    await pool.query(await readFile(new URL('../runtime/audit.mysql.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../runtime/idempotency.mysql.sql',import.meta.url),'utf8'));

    const editor={id:'acceptance_editor',role:'editor'};
    const viewer={id:'acceptance_viewer',role:'viewer'};
    const admin={id:'acceptance_admin',role:'admin'};
    const customerFields={name:'Ada Lovelace',email:'ada.automation@example.test'};
    const customerFlow='workflow_acceptance_customers_create';
    const customerPayload=invocation(project,customerFlow,customerFields);
    const key=randomUUID();
    const saved=await generated.executePublishedWorkflow({project,workflowId:customerFlow,payload:customerPayload,actor:editor,db:pool,requestKey:key});
    assert.equal(saved.committed,true);
    const customerId=saved.effects.find(x=>x.type==='data'&&x.modelId===customer.id)?.id;
    assert.ok(customerId);
    const duplicate=await generated.executePublishedWorkflow({project,workflowId:customerFlow,payload:customerPayload,actor:editor,db:pool,requestKey:key});
    assert.deepEqual(duplicate,{...saved,replayed:true});
    await assert.rejects(generated.executePublishedWorkflow({project,workflowId:customerFlow,
      payload:invocation(project,customerFlow,{...customerFields,name:'Changed'}),actor:editor,db:pool,requestKey:key}),{status:409});
    const customers=await generatedStore.listRecords(pool,customer);
    assert.equal(customers.length,1);
    assert.equal(customers[0].name,customerFields.name);

    const pickerResults=await generatedReferences.searchReferences(pool,project,project.pages[1].id,'acceptance_order_customer','Ada',editor,null);
    assert.deepEqual(pickerResults,[{id:String(customerId),label:'Ada Lovelace'}]);
    await assert.rejects(generatedReferences.searchReferences(pool,project,project.pages[1].id,'acceptance_order_customer','Ada',viewer,
      {models:{[customer.id]:{read:['editor','admin']}}}),{status:403});
    await assert.rejects(generatedReferences.searchReferences(pool,project,project.pages[1].id,'acceptance_order_name','Ada',editor,null),{status:404});

    await assert.rejects(generated.executePublishedWorkflow({project,workflowId:customerFlow,
      payload:customerPayload,actor:viewer,db:pool,requestKey:randomUUID()}),{status:403});
    const rejectedInput=await generated.executePublishedWorkflow({project,workflowId:customerFlow,
      payload:invocation(project,customerFlow,{name:'',email:'ada.automation@example.test'}),actor:editor,db:pool,requestKey:randomUUID()});
    assert.ok(rejectedInput.effects.some(x=>x.text==='Customer name is required.'));
    assert.ok(!rejectedInput.effects.some(x=>x.type==='data'));

    const orderFlow='workflow_acceptance_order_create';
    await assert.rejects(generated.executePublishedWorkflow({project,workflowId:orderFlow,
      payload:invocation(project,orderFlow,{order_name:'Orphan',customer_id:'999999999',amount:'10'}),
      actor:editor,db:pool,requestKey:randomUUID()}),{status:409});
    await assert.rejects(generated.executePublishedWorkflow({project,workflowId:orderFlow,
      payload:invocation(project,orderFlow,{order_name:'Forbidden',customer_id:String(customerId),amount:'10'}),
      actor:editor,db:pool,requestKey:randomUUID(),policy:{models:{[customer.id]:{read:['admin']}}}}),{status:403});
    const orderFields={order_name:'Initial fit-out',customer_id:customerId,amount:'42.50'};
    const orderPayload=invocation(project,orderFlow,orderFields);
    const orderSaved=await generated.executePublishedWorkflow({project,workflowId:orderFlow,
      payload:orderPayload,actor:editor,db:pool,requestKey:randomUUID()});
    const orderId=orderSaved.effects.find(x=>x.type==='data'&&x.modelId===order.id)?.id;
    assert.ok(orderId);
    const listed=await generatedStore.listRecords(pool,order);
    assert.equal(listed.length,1);
    assert.equal(String(listed[0].customer_id),customerId);
    assert.equal(listed[0].amount,'42.5000');

    const updated=await generated.executePublishedWorkflow({project,workflowId:'workflow_acceptance_order_update',
      payload:invocation(project,'workflow_acceptance_order_update',{...orderFields,order_name:'Final fit-out'},{[order.id]:orderId}),
      actor:editor,db:pool,requestKey:randomUUID()});
    assert.equal(updated.committed,true);
    assert.equal((await generatedStore.getRecord(pool,order,orderId)).name,'Final fit-out');
    await assert.rejects(generated.executePublishedWorkflow({project,workflowId:'workflow_acceptance_order_delete',
      payload:invocation(project,'workflow_acceptance_order_delete',{},{[order.id]:orderId},true),
      actor:editor,db:pool,requestKey:randomUUID()}),{status:403});

    await assert.rejects(generated.executePublishedWorkflow({project,workflowId:orderFlow,
      payload:invocation(project,orderFlow,{...orderFields,customer_id:'999999999999'}),
      actor:editor,db:pool,requestKey:randomUUID()}),e=>e?.code==='ER_NO_REFERENCED_ROW_2');
    assert.equal((await generatedStore.listRecords(pool,order)).length,1);

    // A second insert of the same unique email in the SAME transaction fails.
    // The first INSERT must also disappear; its idempotency reservation must roll back.
    const rollbackProject=cloneProject(project),target=rollbackProject.workflows.find(x=>x.id===customerFlow);
    const create=target.steps.find(x=>x.type==='create');
    create.nextId='acceptance_duplicate_create';
    target.steps.push(createStep('create','acceptance_duplicate_create',{modelId:customer.id,nextId:'customers_notify'}));
    validateProject(rollbackProject);
    const failedKey=randomUUID();
    await assert.rejects(generated.executePublishedWorkflow({project:rollbackProject,workflowId:customerFlow,
      payload:invocation(rollbackProject,customerFlow,{name:'Rollback',email:'rollback.automation@example.test'}),
      actor:editor,db:pool,requestKey:failedKey}),e=>e?.code==='ER_DUP_ENTRY');
    const [[rollbackCount]]=await pool.query(`SELECT COUNT(*) AS total FROM ${customerTable} WHERE email=?`,['rollback.automation@example.test']);
    assert.equal(rollbackCount.total,0);
    const [[failedRequest]]=await pool.query('SELECT COUNT(*) AS total FROM `visual_studio_audit`.`vas_workflow_requests` WHERE project_id=? AND actor_id=? AND request_id=?',
      [project.id,editor.id,failedKey]);
    assert.equal(failedRequest.total,0);

    const deleted=await generated.executePublishedWorkflow({project,workflowId:'workflow_acceptance_order_delete',
      payload:invocation(project,'workflow_acceptance_order_delete',{},{[order.id]:orderId},true),
      actor:admin,db:pool,requestKey:randomUUID()});
    assert.equal(deleted.committed,true);
    assert.equal((await generatedStore.listRecords(pool,order)).length,0);
    const [audit]=await pool.query('SELECT actor_id, outcome, resource_id FROM `visual_studio_audit`.`vas_audit_events` WHERE project_id=? ORDER BY id',[project.id]);
    assert.ok(audit.some(x=>x.actor_id===editor.id&&x.outcome==='committed'));
    assert.ok(audit.some(x=>x.actor_id===admin.id&&x.outcome==='committed'));
    assert.ok(audit.some(x=>x.actor_id===editor.id&&x.outcome==='rejected'));
    assert.ok(!audit.some(x=>x.actor_id===viewer.id));
  } finally {
    // The database is disposable; leave no acceptance tables for the next run.
    try{await pool.query(`DROP TABLE IF EXISTS ${orderTable}`);await pool.query(`DROP TABLE IF EXISTS ${customerTable}`);}finally{await pool.end();}
  }
});
