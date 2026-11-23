import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject, validateProject } from '../src/lib/studio/model.js';
import { validateIdempotencyKey, workflowFingerprint, reserveWorkflowRequest, completeWorkflowRequest } from '../src/lib/server/runtime/idempotency.js';
import { validateRuntimePolicy, readRuntimePolicy, assertModelPermission, assertWorkflowPermission } from '../src/lib/server/runtime/policy.js';
import { releaseId, validatePublication } from '../src/lib/server/runtime/publication.js';
import { projectRevision } from '../src/lib/studio/revision.js';

const project = validateProject(createProject());
const flow=project.workflows[0];
const actor={id:'builder',role:'editor'};
const key='01234567-89ab-4cde-8f01-23456789abcd';
const payload={pageId:flow.trigger.pageId,componentId:flow.trigger.componentId,fields:{name:'Ada',email:'ada@example.com'},selectedRecords:{}};

// Transaction-sensitive mock implements the ledger using isolated staged data.
function ledgerMock() {
  let committed=new Map();
  let executions=0;
  return {
    get count(){return executions;},
    async getConnection(){
      let staged;
      return {
        async beginTransaction(){staged=new Map(committed);},
        async rollback(){staged=undefined;},
        async commit(){committed=staged;staged=undefined;},
        release(){},
        async execute(sql,params){
          executions++;
          if(sql.startsWith('INSERT INTO `visual_studio_audit`.`vas_workflow_requests`')) {
            const [proj,id,k,workflow,revision,hash]=params;
            const pk=[proj,id,k].join(':');
            if(staged.has(pk)){const e=Error('duplicate');e.code='ER_DUP_ENTRY';throw e;}
            staged.set(pk,{workflow_id:workflow,project_revision:revision,request_hash:hash,status:'pending',result_json:null});return [{affectedRows:1}];
          }
          if(sql.startsWith('SELECT workflow_id')) return [[...staged.values()].slice(0,1)];
          if(sql.startsWith('UPDATE `visual_studio_audit`.`vas_workflow_requests`')) {
            const row=staged.get(params.slice(1).join(':'));
            if(!row || row.status!=='pending')return [{affectedRows:0}];
            row.status='committed';row.result_json=params[0];return [{affectedRows:1}];
          }
          throw Error('Unexpected SQL');
        }
      };
    }
  };
}

test('idempotency keys must be canonical UUIDv4; payload hash is order-independent',()=>{
  assert.equal(validateIdempotencyKey(key),key);
  assert.throws(()=>validateIdempotencyKey('reused-key'),{status:400});
  assert.throws(()=>validateIdempotencyKey('01234567-89ab-1cde-8f01-23456789abcd'),{status:400});
  assert.equal(workflowFingerprint({project,workflowId:flow.id,payload}),workflowFingerprint({project,workflowId:flow.id,payload:{selectedRecords:{},fields:{email:'ada@example.com',name:'Ada'},componentId:flow.trigger.componentId,pageId:flow.trigger.pageId}}));
  assert.notEqual(workflowFingerprint({project,workflowId:flow.id,payload}),workflowFingerprint({project,workflowId:flow.id,payload:{...payload,fields:{name:'Eve'}}}));
});

test('reserved request returns original response, rejects changed payload and is scoped to actor',async()=>{
  const db=ledgerMock();const connection=await db.getConnection();
  const args={project,workflowId:flow.id,payload,actor,requestKey:key};
  await connection.beginTransaction();
  assert.equal((await reserveWorkflowRequest(connection,args)).replay,null);
  const result={committed:true,workflowId:flow.id,trace:[],effects:[]};
  await completeWorkflowRequest(connection,{project,actor,requestKey:key,result});
  await connection.commit();
  await connection.beginTransaction();
  assert.deepEqual((await reserveWorkflowRequest(connection,args)).replay,{...result,replayed:true});
  await connection.rollback();
  await connection.beginTransaction();
  await assert.rejects(()=>reserveWorkflowRequest(connection,{...args,payload:{...payload,fields:{name:'Eve'}}}),{status:409});
  await connection.rollback();
  await connection.beginTransaction();
  assert.equal((await reserveWorkflowRequest(connection,{...args,actor:{id:'another-user',role:'editor'}})).replay,null);
  await connection.rollback();
});

test('uncommitted reservation rolls back; failed completion refuses missing reservation',async()=>{
  const db=ledgerMock();const conn=await db.getConnection();
  await conn.beginTransaction();await reserveWorkflowRequest(conn,{project,workflowId:flow.id,payload,actor,requestKey:key});
  await conn.rollback();
  await conn.beginTransaction();
  assert.equal((await reserveWorkflowRequest(conn,{project,workflowId:flow.id,payload,actor,requestKey:key})).replay,null);
  await assert.rejects(()=>completeWorkflowRequest(conn,{project,actor,requestKey:'01234567-89ab-4cde-8f01-23456789abce',result:{committed:true}}),{status:503});
  await conn.rollback();
});

test('local policy only restricts the built-in role hierarchy, including all workflow paths',()=>{
  const restricted=validateRuntimePolicy({version:1,models:{model_customer:{read:['admin'],create:['admin'],update:[],delete:['admin']}},workflows:{workflow_create_customer:['admin']}});
  assert.throws(()=>assertModelPermission(actor,'model_customer','read',restricted),{status:403});
  assert.throws(()=>assertModelPermission(actor,'model_customer','create',restricted),{status:403});
  assert.throws(()=>assertModelPermission(actor,'model_customer','delete',null),{status:403});
  assert.throws(()=>assertWorkflowPermission(actor,flow,restricted),{status:403});
  const admin={id:'root',role:'admin'};
  assert.equal(assertWorkflowPermission(admin,flow,restricted),admin);
  assert.throws(()=>assertModelPermission(admin,'model_customer','update',restricted),{status:403});
  assert.throws(()=>validateRuntimePolicy({version:1,models:{model_customer:{update:['superuser']}}}),{status:503});
  assert.throws(()=>validateRuntimePolicy({version:2,models:{}}),{status:503});
});

test('missing policy falls back to built-in roles; invalid policy fails closed',()=>{
  const temp=mkdtempSync(join(tmpdir(),'vas-policy-'));
  try {
    assert.equal(readRuntimePolicy(join(temp,'absent.json')),null);
    writeFileSync(join(temp,'policy.json'),'{ invalid');
    assert.throws(()=>readRuntimePolicy(join(temp,'policy.json')),{status:503});
  }finally{rmSync(temp,{recursive:true,force:true});}
});

test('published immutable manifest must agree with active project and editor revision',()=>{
  const p=validateProject(JSON.parse(readFileSync(new URL('../runtime/project.json',import.meta.url),'utf8')));
  const manifest=JSON.parse(readFileSync(new URL('../runtime/publication.json',import.meta.url),'utf8'));
  assert.equal(releaseId(p),manifest.releaseId);
  assert.equal(projectRevision(p),manifest.editorRevision);
  assert.equal(validatePublication(p,manifest),manifest);
  assert.throws(()=>validatePublication(p,{...manifest,releaseId:'0'.repeat(64)}),{status:503});
  assert.throws(()=>validatePublication({...p,name:'Tampered'},manifest),{status:503});
});
