import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '../src/lib/studio/model.js';
import {
  hashPassword,verifyPassword,validateUsers,readLocalUsers,authenticateCredentials,
  createSession,resolveSession,invalidateSession,requireRole,canExecuteWorkflow,
  recordLoginFailure,clearLoginFailures,isLoginAllowed
} from '../src/lib/server/runtime/auth.js';
import { writeAudit, listAudit, executeAuditedMutation } from '../src/lib/server/runtime/audit.js';

const admin={id:'operator',role:'admin'}, editor={id:'builder',role:'editor'}, viewer={id:'reader',role:'viewer'};
const model=createProject().models[0];

test('scrypt password hashes verify without exposing original password',()=>{
  const hash=hashPassword('a-secure-very-long-password');
  assert.match(hash,/^scrypt\$16384\$8\$1\$/);
  assert.equal(hash.includes('a-secure-very-long-password'),false);
  assert.equal(verifyPassword('a-secure-very-long-password',hash),true);
  assert.equal(verifyPassword('not-the-right-password',hash),false);
  assert.equal(verifyPassword('a-secure-very-long-password','corrupt-hash'),false);
  assert.throws(()=>hashPassword('short'),/14/);
});

test('user configuration is validated and malformed files fail closed',()=>{
  const valid={id:'operator',role:'admin',passwordHash:hashPassword('another-strong-password')};
  assert.equal(validateUsers([valid])[0].id,'operator');
  assert.throws(()=>validateUsers([{...valid,role:'owner'}]),/Invalid/);
  assert.throws(()=>validateUsers([valid,valid]),/Invalid/);
  assert.throws(()=>validateUsers([{...valid,passwordHash:'plaintext'}]),/Invalid/);
  const directory=mkdtempSync(join(tmpdir(),'vas-auth-'));
  try{
    const path=join(directory,'users.json');
    assert.equal(readLocalUsers(path),null);
    writeFileSync(path,JSON.stringify([valid]));
    assert.equal(readLocalUsers(path)[0].role,'admin');
    assert.equal(authenticateCredentials(readLocalUsers(path),'operator','another-strong-password')?.id,'operator');
    assert.equal(authenticateCredentials(readLocalUsers(path),'operator','incorrect'),null);
    writeFileSync(path,'{ broken');
    assert.equal(readLocalUsers(path),null);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('opaque sessions expire, can be revoked and reflect current role',()=>{
  const users=validateUsers([{id:'operator',role:'admin',passwordHash:hashPassword('yet-another-very-long-password')}]);
  const issued=createSession('operator',1000);
  assert.equal(issued.token.length,43);
  assert.equal(resolveSession(issued.token,users,1001).role,'admin');
  assert.equal(resolveSession(issued.token,[{...users[0],role:'viewer'}],1001).role,'viewer');
  assert.equal(resolveSession(issued.token,users,1001+4*60*60*1000),null);
  const second=createSession('operator');
  assert.equal(resolveSession(second.token,users)?.id,'operator');
  invalidateSession(second.token);
  assert.equal(resolveSession(second.token,users),null);
});

test('roles and workflows containing delete steps require administrator',()=>{
  assert.equal(requireRole(viewer,'viewer'),viewer);
  assert.equal(requireRole(editor,'editor'),editor);
  assert.throws(()=>requireRole(viewer,'editor'),{status:403});
  assert.throws(()=>requireRole(editor,'admin'),{status:403});
  assert.throws(()=>requireRole(null,'viewer'),{status:401});
  canExecuteWorkflow(viewer,{steps:[{type:'message'}]});
  canExecuteWorkflow(editor,{steps:[{type:'create'}]});
  assert.throws(()=>canExecuteWorkflow(viewer,{steps:[{type:'update'}]}),{status:403});
  assert.throws(()=>canExecuteWorkflow(editor,{steps:[{type:'condition'},{type:'delete'}]}),{status:403});
  canExecuteWorkflow(admin,{steps:[{type:'delete'}]});
});

test('login attempts are throttled for the source address',()=>{
  const address='test-address-auth-audit';
  clearLoginFailures(address);
  for(let i=0;i<6;i++)recordLoginFailure(address,10000);
  assert.equal(isLoginAllowed(address,10001),false);
  assert.equal(isLoginAllowed(address,10000+5*60*1000+1),true);
  clearLoginFailures(address);
});

test('audit uses fixed SQL and metadata-only parameters',async()=>{
  const entries=[];
  const db={execute:async(sql,params)=>{entries.push({sql,params});return [[]];}};
  await writeAudit(db,{actor:admin,action:'model.create',resourceType:'model',resourceId:'customer',outcome:'committed',projectId:'studio'});
  assert.match(entries[0].sql,/INSERT INTO `visual_studio_audit`.`vas_audit_events`/);
  assert.deepEqual(entries[0].params,['operator','model.create','model','customer','committed','studio']);
  await assert.rejects(()=>writeAudit(db,{actor:admin,action:'DROP TABLE',resourceType:'model',resourceId:'customer',outcome:'committed',projectId:'studio'}),/Invalid audit metadata/);
  await listAudit(db,{before:'100',limit:10});
  assert.match(entries.at(-1).sql,/WHERE `id` < \?/);
  assert.deepEqual(entries.at(-1).params,['100',10]);
  await assert.rejects(()=>listAudit(db,{before:'0 OR 1=1',limit:10}),{status:400});
});

function mockDatabase({failAudit=false,failUpdate=false}={}){
  const state={events:[], commits:0,rollbacks:0,releases:0,sql:[]};
  const connection={
    async beginTransaction(){state.events.push('begin');},
    async commit(){state.commits++;state.events.push('commit');},
    async rollback(){state.rollbacks++;state.events.push('rollback');},
    release(){state.releases++;},
    async query(){return [[{id:'7'}]];},
    async execute(sql,params){
      state.sql.push({sql,params});
      if(sql.includes('vas_audit_events')){
        if(failAudit)throw new Error('audit unavailable');
        return [{affectedRows:1}];
      }
      if(sql.startsWith('UPDATE')&&failUpdate)throw new Error('update failed');
      if(sql.startsWith('SELECT'))return [[{id:'7',name:'Ada',email:'ada@example.com'}]];
      return [{affectedRows:1}];
    }
  };
  return {state,db:{getConnection:async()=>connection,execute:connection.execute}};
}

test('direct create commits only after an audit insert, never stores user form values in audit',async()=>{
  const {state,db}=mockDatabase();
  const result=await executeAuditedMutation({db,project:createProject(),model,operation:'create',payload:{name:'Ada',email:'ada@example.com'},actor:editor});
  assert.equal(result.record.name,'Ada');
  assert.equal(state.commits,1);
  assert.equal(state.rollbacks,0);
  const auditIndex=state.sql.findIndex(v=>v.sql.includes('vas_audit_events'));
  assert.ok(auditIndex>0);
  assert.equal(state.events.at(-1),'commit');
  assert.equal(state.sql[auditIndex].params.includes('ada@example.com'),false);
  assert.equal(state.releases,1);
});

test('direct mutation rolls back when audit insertion fails',async()=>{
  const {state,db}=mockDatabase({failAudit:true});
  await assert.rejects(()=>executeAuditedMutation({db,project:createProject(),model,operation:'create',payload:{name:'Ada',email:'ada@example.com'},actor:editor}),/audit unavailable/);
  assert.equal(state.commits,0);
  assert.equal(state.rollbacks,1);
  assert.equal(state.releases,1);
});

test('direct deletion is denied to editor before taking a connection',async()=>{
  const {state,db}=mockDatabase();
  await assert.rejects(()=>executeAuditedMutation({db,project:createProject(),model,operation:'delete',id:'7',actor:editor}),{status:403});
  assert.equal(state.sql.length,0);
});
