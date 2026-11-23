import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProject, validateProject } from '../src/lib/studio/model.js';
import { createStep } from '../src/lib/studio/workflow.js';
import { executePublishedWorkflow } from '../src/lib/server/runtime/workflow-execution.js';

/** Opt-in: the GitHub CI service provisions a disposable MySQL 8 database. */
test('real MySQL workflow transaction: committed insert and atomic rollback of duplicate inserts', {
  skip: process.env.MYSQL_INTEGRATION !== '1' ? 'Set MYSQL_INTEGRATION=1 with a disposable MySQL database' : false
}, async () => {
  const {createPool} = await import('mysql2/promise');
  const pool=createPool({
    host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),
    user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',
    database:process.env.DB_NAME||'visual_studio_dev',connectionLimit:3,
    multipleStatements:false,bigNumberStrings:true, dateStrings:true
  });
  try {
    // CI databases are disposable; never execute DDL against a real customer's DB.
    await pool.query('CREATE TABLE IF NOT EXISTS `customers` (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` VARCHAR(255) NOT NULL, `email` VARCHAR(255) NOT NULL UNIQUE, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await pool.query('DELETE FROM `customers`');
    await pool.query('CREATE DATABASE IF NOT EXISTS `visual_studio_audit` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
    await pool.query(readFileSync(new URL('../runtime/audit.mysql.sql',import.meta.url),'utf8'));
    await pool.query(readFileSync(new URL('../runtime/idempotency.mysql.sql',import.meta.url),'utf8'));
    await pool.query('DELETE FROM `visual_studio_audit`.`vas_audit_events`');
    await pool.query('DELETE FROM `visual_studio_audit`.`vas_workflow_requests`');
    const base=validateProject(createProject());
    const payload={pageId:'page_new_customer',componentId:'component_form_save',fields:{name:'Ada',email:'ci-test@example.com'},selectedRecords:{}};
    const actor={id:'ci_admin',role:'admin'};
    const requestKey='10000000-0000-4000-8000-000000000001';
    const result=await executePublishedWorkflow({project:base, workflowId:'workflow_create_customer',payload,db:pool,actor,requestKey});
    const replay=await executePublishedWorkflow({project:base, workflowId:'workflow_create_customer',payload,db:pool,actor,requestKey});
    assert.deepEqual(replay,{...result,replayed:true});
    await assert.rejects(()=>executePublishedWorkflow({project:base, workflowId:'workflow_create_customer',payload:{...payload,fields:{name:'Impostor',email:'changed@example.com'}},db:pool,actor,requestKey}),{status:409});
    assert.equal(result.committed,true);
    assert.deepEqual(result.trace.map(s=>s.type),['condition','create','message']);
    const [[afterCommit]]=await pool.query('SELECT COUNT(*) AS count FROM `customers`');
    assert.equal(afterCommit.count,1);

    const graph=createProject();const flow=graph.workflows[0];
    flow.steps.find(step=>step.id==='step_create_customer').nextId='step_duplicate';
    flow.steps.push(createStep('create','step_duplicate',{modelId:'model_customer',nextId:'step_customer_created'}));
    validateProject(graph);
    // First insert succeeds, second conflicts with its uncommitted identical email;
    // a transactional rollback must leave the original committed row unchanged.
    await assert.rejects(()=>executePublishedWorkflow({project:graph,workflowId:'workflow_create_customer',payload:{...payload,fields:{name:'Grace',email:'rollback@example.com'}},db:pool,actor,requestKey:'10000000-0000-4000-8000-000000000002'}),error=>error?.code==='ER_DUP_ENTRY');
    const [[afterRollback]]=await pool.query('SELECT COUNT(*) AS count FROM `customers`');
    assert.equal(afterRollback.count,1);
    const [[phantom]]=await pool.query('SELECT COUNT(*) AS count FROM `customers` WHERE `email` = ?', ['rollback@example.com']);
    assert.equal(phantom.count,0);
    const [events]=await pool.query('SELECT `outcome`,`actor_id`,`action` FROM `visual_studio_audit`.`vas_audit_events` ORDER BY `id`');
    assert.deepEqual(events.map(e=>e.outcome),['committed','rejected']);
    assert.ok(events.every(e=>e.actor_id==='ci_admin'&&e.action==='workflow.execute'));
    const [[ledger]]=await pool.query('SELECT COUNT(*) AS count FROM `visual_studio_audit`.`vas_workflow_requests`');
    assert.equal(ledger.count,1); // failed workflows leave no committed reservation
    const [saved]=await pool.query('SELECT result_json FROM `visual_studio_audit`.`vas_workflow_requests` LIMIT 1');
    assert.equal((typeof saved[0].result_json==='string'?JSON.parse(saved[0].result_json):saved[0].result_json).committed,true);
    // InnoDB serialises concurrent identical keys: one write, one replay.
    const parallelPayload={...payload,fields:{name:'Parallel',email:'parallel@example.com'}};
    const parallelKey='10000000-0000-4000-8000-000000000003';
    const concurrent=await Promise.all([1,2].map(()=>executePublishedWorkflow({project:base,workflowId:'workflow_create_customer',payload:parallelPayload,db:pool,actor,requestKey:parallelKey})));
    assert.equal(concurrent.filter(r=>r.replayed===true).length,1);
    const [[parallelCount]]=await pool.query('SELECT COUNT(*) AS count FROM `customers` WHERE email=?',['parallel@example.com']);
    assert.equal(parallelCount.count,1);
  } finally {
    await pool.end();
  }
});
