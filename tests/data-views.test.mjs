import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createComponent, validateProject } from '../src/lib/studio/model.js';
import {createDataView, validateDataViews, inspectDataView, viewForComponent} from '../src/lib/studio/data-views.js';
import {viewStatements,executePublishedView} from '../src/lib/server/runtime/data-views.js';

function scenario(){
 const p=createProject(),customer=p.models[0],order=p.models[1];
 const view=createDataView(customer,{id:'view_customers'});
 p.dataViews=[view];
 const table=createComponent('table');Object.assign(table.props,{bindingModelId:customer.id,columns:view.columns.join(','),dataViewId:view.id});
 p.pages[0].components.push(table);
 return {p,view,table,customer,order};
}
test('default metadata view is valid, stable and bounded',()=>{
 const {p,view,table}=scenario();assert.equal(validateProject(p),p);
 assert.equal(validateDataViews(p).get(view.id),view);
 const config=viewForComponent(p,p.pages[0].id,table.id);
 const {sql,params,limit}=viewStatements(config,{query:'A%_\\',page:'2'});
 assert.match(sql,/LOCATE\(\?, `name`\) > 0/);
 assert.match(sql,/ORDER BY `name` ASC, `id` ASC LIMIT \? OFFSET \?/);
 assert.ok(!sql.includes('A%_'));
 assert.deepEqual(params,['A%_\\',20,40]);assert.equal(limit,20);
});
test('invalid field, field type, SQL injections, page sizes and unknown operators are rejected',()=>{
 const {p,view}=scenario();
 for(const bad of [
  v=>{v.columns=['secret'];},v=>{v.sort.field='name;DROP TABLE customers';},
  v=>{v.pageSize=500;},v=>{v.filters[0].operator='regexp';},
  v=>{v.filters=[{field:'id',operator:'contains',source:'search'}];},
  v=>{v.filters=[{field:'id',operator:'eq',source:'literal',value:'-1'}];},
  v=>{v.filters.push({...v.filters[0]});},v=>{v.version=2;},v=>{v.filters=[{field:'id',operator:'eq',source:'literal',value:'18446744073709551616'}];}
 ]){const copy=structuredClone(p);bad(copy.dataViews[0]);assert.throws(()=>validateDataViews(copy));}
 assert.throws(()=>viewStatements(viewForComponent(p,p.pages[0].id,p.pages[0].components.at(-1).id),{page:'999'}));
});
test('published related view requires exact bound foreign key and parent record',async()=>{
 const {p,order,customer}=scenario();
 const foreign=order.fields.find(f=>f.name==='customer_id');
 const view=createDataView(order,{id:'view_orders',parentField:'customer_id'});
 p.dataViews.push(view);
 const table=createComponent('table');Object.assign(table.props,{bindingModelId:order.id,columns:view.columns.join(','),dataViewId:view.id,relationParentModelId:customer.id,relationFieldId:foreign.id});
 p.pages[0].components.push(table);
 validateDataViews(p);
 const config=viewForComponent(p,p.pages[0].id,table.id);
 const statement=viewStatements(config,{parentId:'42',query:'service'});
 assert.match(statement.sql,/WHERE LOCATE\(\?, `name`\) > 0 AND `customer_id` = \?/);
 assert.deepEqual(statement.params,['service','42',20,0]);
 assert.deepEqual(statement.parentQuery.params,['42']);
 assert.throws(()=>viewStatements(config,{parentId:'42 OR 1=1'}));
 assert.throws(()=>viewStatements(config,{parentId:''}));
 const malformed=structuredClone(p);malformed.pages[0].components.at(-1).props.relationFieldId='field_wrong';
 assert.throws(()=>validateDataViews(malformed));
 const seen=[];
 const db={execute:async(sql,params)=>{seen.push([sql,params]);return seen.length===1?[[{present:1}],[]]:[[{id:'7',name:'service'}],[]];}};
 await assert.rejects(executePublishedView(db,p,{pageId:p.pages[0].id,componentId:table.id,parentId:'42'},
  {id:'reader',role:'viewer'}, {version:1,models:{[customer.id]:{read:[]}},workflows:{}}),{status:403});
 assert.equal(seen.length,0);
 const result=await executePublishedView(db,p,{pageId:p.pages[0].id,componentId:table.id,parentId:'42'},
  {id:'reader',role:'viewer'},null);
 assert.equal(result.page,0);assert.equal(seen.length,2);
});
test('offline view inspection sorts, filters and paginates without mutation',()=>{
 const {view}=scenario(); const rows=[{id:2,name:'Zed'},{id:1,name:'Alice'},{id:3,name:'Alicia'}];
 const original=structuredClone(rows);
 assert.deepEqual(inspectDataView(view,rows,{query:'ali'}).records.map(r=>r.id),[1,3]);
 assert.deepEqual(rows,original);
 const parent=structuredClone(view);parent.filters.push({field:'id',operator:'eq',source:'parent'});
 assert.deepEqual(inspectDataView(parent,rows,{}).records,[]);
});
test('old projects without data views remain valid',()=>{
 const p=createProject();assert.equal(validateProject(p),p);assert.equal(validateDataViews(p).size,0);
});
