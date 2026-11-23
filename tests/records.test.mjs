import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, validateProject } from '../src/lib/studio/model.js';
import { RecordError, normaliseValue, normaliseId, validateRecord, sqlFor, quoteIdentifier, jsonRecord } from '../src/lib/studio/records.js';
import { projectRevision } from '../src/lib/studio/revision.js';
import {listRecords,getRecord,createRecord,updateRecord,deleteRecord,getPublishedModel} from '../src/lib/server/runtime/store.js';
import { readFileSync } from 'node:fs';

const deployed=JSON.parse(readFileSync(new URL('../runtime/project.json',import.meta.url)));
const model=deployed.models[0];
test('published example is valid and contains bound CRUD controls and table',()=>{
  validateProject(deployed);
  assert.deepEqual(deployed.pages[1].components.filter(c=>c.type==='button').map(c=>c.props.action),['create','update','delete']);
  assert.ok(deployed.pages[1].components.some(c=>c.type==='table'&&c.props.bindingModelId===model.id));
  assert.equal(projectRevision(deployed),projectRevision(structuredClone(deployed)));
  const changed=structuredClone(deployed);changed.pages[1].name='Edited';assert.notEqual(projectRevision(changed),projectRevision(deployed));
});
test('field and model validation enforces server-side required and typed values',()=>{
  assert.deepEqual(validateRecord(model,{name:'Ada',email:'ada@example.com'}),{name:'Ada',email:'ada@example.com'});
  assert.throws(()=>validateRecord(model,{name:'Ada'}),/email is required/);
  assert.throws(()=>validateRecord(model,{name:'',email:'a'}),/name is required/);
  assert.throws(()=>validateRecord(model,{name:'Ada',email:'a',admin:true}),/not writable/);
  assert.throws(()=>validateRecord(model,{id:22,name:'Ada',email:'a'}),/not writable/);
  assert.throws(()=>validateRecord(model,[]),/JSON object/);
  assert.throws(()=>validateRecord(model,{},'update'),/No fields/);
  assert.equal(normaliseId(model,'18446744073709551615'),'18446744073709551615');
  assert.throws(()=>normaliseId(model,'18446744073709551616'),/BIGINT/);
  assert.throws(()=>normaliseId(model,'1 OR 1=1'),/integer/);
  const typed=structuredClone(model.fields[1]);
  typed.type='boolean';assert.equal(normaliseValue(typed,false),0);assert.throws(()=>normaliseValue(typed,'false'),/true or false/);
  typed.type='date';assert.equal(normaliseValue(typed,'2024-02-29'),'2024-02-29');assert.throws(()=>normaliseValue(typed,'2025-02-29'),/YYYY-MM-DD/);
  typed.type='decimal';assert.equal(normaliseValue(typed,'-12.3456'),'-12.3456');assert.throws(()=>normaliseValue(typed,'12.34567'),/DECIMAL/);
  typed.type='datetime';assert.equal(normaliseValue(typed,'2025-01-03T12:59'),'2025-01-03 12:59');assert.throws(()=>normaliseValue(typed,'2025-01-03T25:00'),/invalid time/);
});
test('SQL statements are parameterised and model/table/field names are allowlisted',()=>{
  const create=sqlFor(model,'create',{name:"Ada'); DROP TABLE customers;--",email:'a@b'});
  assert.match(create.sql,/INSERT INTO `customers` \(`name`, `email`\) VALUES \(\?, \?\)/);
  assert.equal(create.params[0],"Ada'); DROP TABLE customers;--");
  assert.ok(!create.sql.includes('DROP'));
  const update=sqlFor(model,'update',{name:'Changed'},'7');
  assert.equal(update.sql,'UPDATE `customers` SET `name` = ? WHERE `id` = ? LIMIT 1');
  assert.deepEqual(update.params,['Changed','7']);
  assert.deepEqual(sqlFor(model,'delete',{},'7').params,['7']);
  assert.match(sqlFor(model,'list').sql,/LIMIT 50$/);
  assert.throws(()=>quoteIdentifier('bad` DROP TABLE'),/Invalid/);
  assert.throws(()=>getPublishedModel(deployed,'invalid'),/not published/);
  assert.equal(getPublishedModel(deployed,model.id).table,'customers');
  assert.deepEqual(jsonRecord({id:7n,name:'Ada'}),{id:'7',name:'Ada'});
});
test('mocked MySQL driver CRUD flow returns rows and binds IDs',async()=>{
  const records=new Map();let next=1;let connectionCount=0,releaseCount=0;
  async function execute(sql,params){
    if(sql.startsWith('INSERT INTO')){const id=String(next++);records.set(id,{id,name:params[0],email:params[1]});return [{affectedRows:1,insertId:Number(id)}];}
    if(sql.startsWith('SELECT *')&&sql.includes('WHERE'))return [[records.get(params[0])].filter(Boolean)];
    if(sql.startsWith('SELECT *'))return [[...records.values()].reverse()];
    if(sql.startsWith('UPDATE')){const row=records.get(params.at(-1));if(!row)return [{affectedRows:0}];row.name=params[0];return [{affectedRows:1}];}
    if(sql.startsWith('DELETE'))return [{affectedRows:records.delete(params[0])?1:0}];
    throw new Error(`Unexpected SQL ${sql}`);
  }
  const db={execute,async getConnection(){connectionCount++;return {execute,query:async()=>[[{id:String(next-1)}]],release(){releaseCount++;}};}};
  const inserted=await createRecord(db,model,{name:'Ada',email:'ada@example.com'});
  assert.equal(inserted.id,'1');assert.equal(inserted.name,'Ada');assert.equal(connectionCount,1);assert.equal(releaseCount,1);
  assert.deepEqual(await listRecords(db,model),[inserted]);
  assert.equal((await getRecord(db,model,'1')).email,'ada@example.com');
  assert.equal((await updateRecord(db,model,'1',{name:'Grace'})).name,'Grace');
  assert.deepEqual(await deleteRecord(db,model,'1'),{deleted:true,id:'1'});
  await assert.rejects(()=>getRecord(db,model,'1'),/not found/);
  await assert.rejects(()=>updateRecord(db,model,'1',{name:'Lost'}),/not found/);
  await assert.rejects(()=>deleteRecord(db,model,'1'),/not found/);
});
test('runtime refuses inconsistent model bindings before SQL generation',()=>{
  const project=createProject();const table=project.pages[0].components[0];table.props.bindingModelId='not-a-model';assert.throws(()=>validateProject(project),/Broken/);
});
