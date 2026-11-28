import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createProject,createComponent,validateProject} from '../src/lib/studio/model.js';
import {createDataView} from '../src/lib/studio/data-views.js';
import {executePublishedView} from '../src/lib/server/runtime/data-views.js';

const enabled=process.env.MYSQL_INTEGRATION==='1';
test('v2.1 typed compound filters, selected-record restriction and parameter safety in MySQL 8', {skip:!enabled}, async()=>{
 const mysql=await import('mysql2/promise');
 if(process.env.DB_HOST&&!['localhost','127.0.0.1'].includes(process.env.DB_HOST))throw Error('Only localhost disposable MySQL is supported');
 const db=await mysql.createPool({host:process.env.DB_HOST??'127.0.0.1',port:Number(process.env.DB_PORT??3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:2});
 const suffix=randomBytes(4).toString('hex'),clients='vas_v21_clients_'+suffix,orders='vas_v21_orders_'+suffix;
 const q=s=>'`'+s+'`';
 try{
  await db.query(`CREATE TABLE ${q(clients)} (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(255) NOT NULL,email VARCHAR(255) NOT NULL)`);
  await db.query(`CREATE TABLE ${q(orders)} (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(255) NOT NULL,customer_id BIGINT UNSIGNED NOT NULL,amount DECIMAL(18,4) NOT NULL,KEY(customer_id),CONSTRAINT ${q('fk_v21_'+suffix)} FOREIGN KEY(customer_id) REFERENCES ${q(clients)}(id))`);
  await db.execute(`INSERT INTO ${q(clients)} (name,email) VALUES (?,?),(?,?)`,['Alice','alice@demo.test','Bob','bob@demo.test']);
  await db.execute(`INSERT INTO ${q(orders)} (name,customer_id,amount) VALUES (?,?,?),(?,?,?),(?,?,?),(?,?,?)`,['A-low',1,'2.00','A-high',1,'15.00','B-high',2,'75.00','A-mid',1,'12.00']);
  const project=createProject(),client=project.models[0],order=project.models[1];client.table=clients;order.table=orders;
  const fk=order.fields.find(f=>f.name==='customer_id');
  const minimum=createComponent('input');minimum.props.field='minimum_amount';
  const view=createDataView(order,{id:'view_compound_v21',parentField:'customer_id'});view.sort={field:'amount',direction:'desc'};view.pageSize=1;
  view.filters.push({field:'amount',operator:'gte',source:'form',binding:'minimum_amount'});
  view.filters.push({field:'customer_id',operator:'eq',source:'selected',binding:client.id});
  const table=createComponent('table');Object.assign(table.props,{bindingModelId:order.id,dataViewId:view.id,columns:view.columns.join(','),relationParentModelId:client.id,relationFieldId:fk.id});
  project.dataViews=[view];project.pages[0].components.push(minimum,table);validateProject(project);
  const actor={id:'viewer',role:'viewer'},base={pageId:project.pages[0].id,componentId:table.id,page:'0'};
  const options={...base,parentId:'1',bindings:{'2':'10','3':'1'}};
  const first=await executePublishedView(db,project,options,actor,null);
  assert.deepEqual(first.records.map(r=>r.name),['A-high']);assert.equal(first.hasMore,true);
  const next=await executePublishedView(db,project,{...options,page:'1'},actor,null);
  assert.deepEqual(next.records.map(r=>r.name),['A-mid']);
  const bob=await executePublishedView(db,project,{...options,parentId:'2',bindings:{'2':'10','3':'2'}},actor,null);
  assert.deepEqual(bob.records.map(r=>r.name),['B-high']);
  await assert.rejects(executePublishedView(db,project,{...options,parentId:'1',bindings:{'2':'10','3':'1 OR 1=1'}},actor,null),{status:400});
  await assert.rejects(executePublishedView(db,project,{...options,parentId:'1',bindings:{'2':'10','3':'999'}},actor,null),{status:404});
  await assert.rejects(executePublishedView(db,project,{...options,parentId:'1',bindings:{'2':'10','3':'1',rogue:'3'}},actor,null),{status:400});
  await assert.rejects(executePublishedView(db,project,{...options,parentId:'1',bindings:{'2':'10','3':'1'}},actor,
    {version:1,models:{[client.id]:{read:[]}},workflows:{}}),{status:403});
 }finally{
  await db.query(`DROP TABLE IF EXISTS ${q(orders)}`);
  await db.query(`DROP TABLE IF EXISTS ${q(clients)}`);
  await db.end();
 }
});
