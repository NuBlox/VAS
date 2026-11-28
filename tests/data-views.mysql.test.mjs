import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createProject,createComponent,validateProject} from '../src/lib/studio/model.js';
import {createDataView} from '../src/lib/studio/data-views.js';
import {executePublishedView} from '../src/lib/server/runtime/data-views.js';

const enabled=process.env.MYSQL_INTEGRATION==='1';
test('v2.0 published view filters and parent restrictions against disposable MySQL', {skip:!enabled},async()=>{
 const mysql=await import('mysql2/promise');
 const db=await mysql.createPool({host:process.env.DB_HOST??'127.0.0.1',port:Number(process.env.DB_PORT??3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:2});
 const suffix=randomBytes(4).toString('hex');
 const parentTable='vas_clients_'+suffix,childTable='vas_orders_'+suffix;
 const q=name=>'`'+name+'`';
 try{
  await db.query(`CREATE TABLE ${q(parentTable)} (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(255) NOT NULL)`);
  await db.query(`CREATE TABLE ${q(childTable)} (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(255) NOT NULL,customer_id BIGINT UNSIGNED NOT NULL,amount DECIMAL(18,4) NOT NULL,KEY (customer_id),CONSTRAINT ${q('fk_'+suffix)} FOREIGN KEY (customer_id) REFERENCES ${q(parentTable)}(id))`);
  await db.execute(`INSERT INTO ${q(parentTable)} (name) VALUES (?),(?)`,['Beta','Alpha']);
  await db.execute(`INSERT INTO ${q(childTable)} (name,customer_id,amount) VALUES (?,?,?),(?,?,?),(?,?,?)`,['B-1',1,'4.00','A-1',2,'2.00','A-2',2,'8.00']);
  const project=createProject(),clients=project.models[0],orders=project.models[1];clients.table=parentTable;orders.table=childTable;
  const view=createDataView(clients,{id:'view_client_test'});view.pageSize=1;
  const parentTableNode=createComponent('table');Object.assign(parentTableNode.props,{bindingModelId:clients.id,dataViewId:view.id,columns:view.columns.join(',')});
  const childView=createDataView(orders,{id:'view_orders_test',parentField:'customer_id'});
  childView.sort={field:'amount',direction:'desc'};
  const fk=orders.fields.find(f=>f.name==='customer_id');
  const childTableNode=createComponent('table');Object.assign(childTableNode.props,{bindingModelId:orders.id,dataViewId:childView.id,columns:childView.columns.join(','),relationParentModelId:clients.id,relationFieldId:fk.id});
  project.dataViews=[view,childView];project.pages[0].components.push(parentTableNode,childTableNode);
  validateProject(project);
  const actor={id:'test-reader',role:'viewer'};
  const base={pageId:project.pages[0].id};
  const first=await executePublishedView(db,project,{...base,componentId:parentTableNode.id,query:'a'},actor,null);
  assert.equal(first.records.length,1);assert.equal(first.records[0].name,'Alpha');assert.equal(first.hasMore,true);
  const second=await executePublishedView(db,project,{...base,componentId:parentTableNode.id,query:'a',page:'1'},actor,null);
  assert.equal(second.records[0].name,'Beta');
  const children=await executePublishedView(db,project,{...base,componentId:childTableNode.id,parentId:'2'},actor,null);
  assert.deepEqual(children.records.map(r=>r.name),['A-2','A-1']);
  await assert.rejects(executePublishedView(db,project,{...base,componentId:childTableNode.id,parentId:'999'},actor,null),{status:404});
  await assert.rejects(executePublishedView(db,project,{...base,componentId:childTableNode.id,parentId:'2 OR 1=1'},actor,null),{status:400});
  const policy={version:1,models:{[clients.id]:{read:[]}},workflows:{}};
  await assert.rejects(executePublishedView(db,project,{...base,componentId:childTableNode.id,parentId:'2'},actor,policy),{status:403});
 }finally{
  await db.query(`DROP TABLE IF EXISTS ${q(childTable)}`);
  await db.query(`DROP TABLE IF EXISTS ${q(parentTable)}`);
  await db.end();
 }
});
