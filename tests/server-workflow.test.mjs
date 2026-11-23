import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createComponent, cloneProject, validateProject } from '../src/lib/studio/model.js';
import { createStep } from '../src/lib/studio/workflow.js';
import { executePublishedWorkflow, validateWorkflowInvocation } from '../src/lib/server/runtime/workflow-execution.js';

const project = () => validateProject(createProject());
const input = (name='Ada', email='ada@example.com') => ({
  pageId:'page_new_customer',componentId:'component_form_save',
  fields:{name,email},selectedRecords:{}
});
const flowId='workflow_create_customer';

/** A transaction-aware fake, including persisted/staged records and forced errors. */
function fakeDb(initial=[], opts={}) {
  let data=new Map(initial.map(row=>[String(row.id),{...row}]));
  let next=1 + Math.max(0,...initial.map(x=>Number(x.id)));
  const state={begins:0,commits:0,rollbacks:0,releases:0,executions:0};
  return {
    state,
    snapshot:()=>[...data.values()].map(x=>({...x})),
    async getConnection() {
      let staged, localNext;
      return {
        async beginTransaction(){state.begins++;staged=new Map([...data].map(([k,v])=>[k,{...v}]));localNext=next;},
        async commit(){state.commits++;if(opts.failCommit)throw Error('Commit unavailable');data=staged;next=localNext;},
        async rollback(){state.rollbacks++;},
        release(){state.releases++;},
        async query(sql){assert.equal(sql,'SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');return [[{id:String(localNext-1)}]];},
        async execute(sql,params){
          state.executions++;
          if(sql.startsWith('INSERT INTO')){
            if(opts.failInsertAt===state.executions)throw Error('Simulated constraint failure');
            const columns=sql.match(/\(([^)]*)\) VALUES/)?.[1]?.split(', ').map(s=>s.replaceAll('`',''))??[];
            const record={id:String(localNext++)};columns.forEach((key,i)=>record[key]=params[i]);
            staged.set(record.id,record);return [{affectedRows:1}];
          }
          if(sql.startsWith('SELECT *'))return [[staged.get(String(params[0]))].filter(Boolean)];
          if(sql.startsWith('UPDATE')){
            const id=String(params.at(-1)),row=staged.get(id);
            if(!row)return [{affectedRows:0}];
            const columns=[...sql.matchAll(/`([a-z_]+)` = \?/g)].map(match=>match[1]);
            columns.forEach((key,i)=>row[key]=params[i]);return [{affectedRows:1}];
          }
          if(sql.startsWith('DELETE'))return [{affectedRows:staged.delete(String(params[0]))?1:0}];
          throw Error(`Unexpected SQL: ${sql}`);
        }
      };
    }
  };
}

test('published workflow checks trigger identity and rejects client graphs and unexpected form fields',()=>{
  const p=project();
  assert.equal(validateWorkflowInvocation(p,flowId,input()).flow.id,flowId);
  assert.throws(()=>validateWorkflowInvocation(p,'another',input()),/not published/);
  assert.throws(()=>validateWorkflowInvocation(p,flowId,{...input(),componentId:'fake'}),/trigger/);
  assert.throws(()=>validateWorkflowInvocation(p,flowId,{...input(),steps:[{sql:'DROP TABLE customers'}]}),/Invalid workflow invocation/);
  assert.throws(()=>validateWorkflowInvocation(p,flowId,{...input(),fields:{name:'Ada',email:'ada@b',admin:true}}),/Unexpected workflow form field/);
  assert.throws(()=>validateWorkflowInvocation(p,flowId,{...input(),selectedRecords:{model_order:'5'}}),/bound table/);
  assert.throws(()=>validateWorkflowInvocation(p,flowId,{...input(),fields:{name:[],email:'a@b'}}),/Unexpected/);
  assert.throws(()=>validateWorkflowInvocation(p,flowId,{...input(),fields:{name:'a'.repeat(10001),email:'a@b'}}),/Unexpected/);
});

test('server executes the published true branch in a single committed transaction',async()=>{
  const db=fakeDb();
  const result=await executePublishedWorkflow({project:project(),workflowId:flowId,payload:input(),db});
  assert.deepEqual(result.trace.map(x=>x.type),['condition','create','message']);
  assert.deepEqual(result.effects.map(x=>x.type),['data','message']);
  assert.equal(result.effects[0].id,'1');
  assert.equal(result.committed,true);
  assert.deepEqual(db.snapshot(),[{id:'1',name:'Ada',email:'ada@example.com'}]);
  assert.deepEqual([db.state.begins,db.state.commits,db.state.rollbacks,db.state.releases],[1,1,0,1]);
});

test('false branch returns only a message and performs no write',async()=>{
  const db=fakeDb();
  const result=await executePublishedWorkflow({project:project(),workflowId:flowId,payload:input(''),db});
  assert.deepEqual(result.trace.map(x=>x.type),['condition','message']);
  assert.match(result.effects[0].text,/enter the customer name/i);
  assert.deepEqual(db.snapshot(),[]);
  assert.equal(db.state.commits,1);
});

test('validation failure and database failure roll back everything with no successful effects',async()=>{
  let db=fakeDb();
  await assert.rejects(()=>executePublishedWorkflow({project:project(),workflowId:flowId,payload:input('Ada',''),db}),/email is required/);
  assert.deepEqual(db.snapshot(),[]);assert.equal(db.state.rollbacks,1);assert.equal(db.state.releases,1);

  const p=project();const flow=p.workflows[0];
  flow.steps.find(s=>s.id==='step_create_customer').nextId='step_second_insert';
  flow.steps.push(createStep('create','step_second_insert',{modelId:'model_customer',nextId:'step_customer_created'}));
  validateProject(p);
  db=fakeDb([],{failInsertAt:3}); // first insert + select, then second insert
  await assert.rejects(()=>executePublishedWorkflow({project:p,workflowId:flowId,payload:input(),db}),/Simulated constraint failure/);
  assert.deepEqual(db.snapshot(),[]);assert.equal(db.state.rollbacks,1);assert.equal(db.state.commits,0);
});

test('server set-field changes affect subsequent condition and insert, with effects after commit',async()=>{
  const p=project();const flow=p.workflows[0];
  flow.startStepId='step_set';flow.steps.push(createStep('set_field','step_set',{field:'name',value:'Server Ada',nextId:'step_check_name'}));
  validateProject(p);
  const db=fakeDb();
  const result=await executePublishedWorkflow({project:p,workflowId:flowId,payload:input(''),db});
  assert.deepEqual(result.trace.map(x=>x.type),['set_field','condition','create','message']);
  assert.equal(result.effects[0].value,'Server Ada');
  assert.equal(db.snapshot()[0].name,'Server Ada');
});

test('update and delete require a bound table, valid selected ID, and explicit delete confirmation',async()=>{
  const p=project();const page=p.pages.find(x=>x.id==='page_new_customer');
  const table=createComponent('table','table_workflow_records');table.props.bindingModelId='model_customer';page.components.push(table);
  const flow=p.workflows[0];flow.startStepId='step_modify';
  flow.steps=[createStep('update','step_modify',{modelId:'model_customer',nextId:'step_customer_created'}),flow.steps.find(s=>s.id==='step_customer_created')];
  validateProject(p);
  const db=fakeDb([{id:'7',name:'Old',email:'old@example.com'}]);
  let result=await executePublishedWorkflow({project:p,workflowId:flowId,payload:{...input('Updated','new@example.com'),selectedRecords:{model_customer:'7'}},db});
  assert.deepEqual(result.trace.map(s=>s.type),['update','message']);
  assert.equal(db.snapshot()[0].name,'Updated');
  flow.steps[0]=createStep('delete','step_modify',{modelId:'model_customer',nextId:'step_customer_created'});
  validateProject(p);
  await assert.rejects(()=>executePublishedWorkflow({project:p,workflowId:flowId,payload:{...input(),selectedRecords:{model_customer:'7'}},db}),/explicit confirmation/);
  assert.equal(db.snapshot().length,1);
  result=await executePublishedWorkflow({project:p,workflowId:flowId,payload:{...input(),selectedRecords:{model_customer:'7'},confirmDelete:true},db});
  assert.deepEqual(result.trace.map(s=>s.type),['delete','message']);
  assert.deepEqual(db.snapshot(),[]);
});

test('no UI action is returned when commit fails; connection is released',async()=>{
  const db=fakeDb([],{failCommit:true});
  await assert.rejects(()=>executePublishedWorkflow({project:project(),workflowId:flowId,payload:input(),db}),/Commit unavailable/);
  assert.equal(db.state.commits,1);assert.equal(db.state.rollbacks,1);assert.equal(db.state.releases,1);
  assert.deepEqual(db.snapshot(),[]);
});

test('ambiguous page fields are blocked rather than guessed',()=>{
  const p=project();const page=p.pages.find(x=>x.id==='page_new_customer');
  const duplicate=createComponent('input','duplicate_same_name');duplicate.props.field='name';page.components.push(duplicate);
  validateProject(p); // valid designer, not safe to interpret as an unambiguous server form
  assert.throws(()=>validateWorkflowInvocation(p,flowId,input()),/non-empty and unique/);
});
