import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createComponent,validateProject} from '../src/lib/studio/model.js';
import {createDataView,validateDataViews,assertViewBindings,inspectDataView,describeDataView} from '../src/lib/studio/data-views.js';
import {viewForComponent} from '../src/lib/studio/data-views.js';
import {viewStatements,executePublishedView} from '../src/lib/server/runtime/data-views.js';

function setup(){
 const p=createProject(),customer=p.models[0],orders=p.models[1];
 const table=createComponent('table');
 const view=createDataView(orders,{id:'view_order_query',parentField:'customer_id'});
 // Form input is a typed, local page binding; no SQL code is supplied by the browser.
 const min=createComponent('input');Object.assign(min.props,{field:'min_amount',label:'Minimum order amount'});
 const amount=orders.fields.find(f=>f.name==='amount');
 assert.ok(amount,'Expected Customer/Order acceptance fixture');
 const fk=orders.fields.find(f=>f.name==='customer_id');
 Object.assign(table.props,{bindingModelId:orders.id,dataViewId:view.id,columns:view.columns.join(','),relationParentModelId:customer.id,relationFieldId:fk.id});
 view.filters.push({field:'amount',operator:'gte',source:'form',binding:'min_amount'});
 view.filters.push({field:'customer_id',operator:'eq',source:'selected',binding:customer.id});
 p.dataViews=[view];p.pages[0].components.push(min,table);
 validateProject(p);
 return {p,customer,orders,table,view};
}

test('AND filters are bound to a verified form control and compatible selected model',()=>{
 const {p,view,table,customer}=setup();
 assert.equal(validateDataViews(p).get(view.id),view);
 const params={'2':'10.5','3':'42'};
 assert.deepEqual(assertViewBindings(view,params),params);
 const config=viewForComponent(p,p.pages[0].id,table.id);
 const statements=viewStatements({...config,selectedModels:new Map([[customer.id,customer]])},{parentId:'42',query:'service',bindings:params});
 assert.match(statements.sql,/`amount` >= \?/);
 assert.match(statements.sql,/`customer_id` = \?/);
 assert.deepEqual(statements.params,['service','42','10.5','42',20,0]);
 assert.deepEqual(statements.selectedQueries[0].params,['42']);
 assert.equal(statements.parentQuery.params[0],'42');
 assert.deepEqual(describeDataView(view,params).slice(-2).map(x=>x.value),['10.5','42']);
});

test('forged fields, missing bindings, operator injections and wrong types fail closed',()=>{
 const {p,view,table,customer}=setup();
 const config=viewForComponent(p,p.pages[0].id,table.id);
 const withSelected={...config,selectedModels:new Map([[customer.id,customer]])};
 for(const bindings of [{},{'2':'10.5'},{'2':'10.5','3':'42',hack:'x'},{'2':{},'3':'42'},{'2':'10.5','3':'42 OR TRUE'}]){
  assert.throws(()=>viewStatements(withSelected,{parentId:'42',bindings}),/binding|integer|invalid/i);
 }
 for(const edit of [
  f=>{f.operator='DROP TABLE';},f=>{f.field='amount` OR 1=1 --';},
  f=>{f.source='form';f.binding='missing_field';},f=>{f.binding='__proto__';},
  f=>{f.source='selected';f.binding='unknown_model';}
 ]){
  const copy=structuredClone(p);edit(copy.dataViews[0].filters[2]);
  assert.throws(()=>validateDataViews(copy));
 }
 const records=[{id:1,name:'Service',customer_id:42,amount:'15.5'}];
 assert.deepEqual(inspectDataView(view,records,{query:'service',parentId:42}).records,[]);
 assert.deepEqual(inspectDataView(view,records,{query:'service',parentId:42,bindings:{'2':'10','3':'42'}}).records.map(r=>r.id),[1]);
 assert.deepEqual(inspectDataView(view,records,{query:'service',parentId:43,bindings:{'2':'10','3':'42'}}).records,[]);
});

test('read policies are checked before selected model is queried and parent cannot be bypassed',async()=>{
 const {p,view,table,customer}=setup();
 const base={pageId:p.pages[0].id,componentId:table.id,parentId:'42',bindings:{'2':'10','3':'42'}};
 const actor={id:'viewer',role:'viewer'};
 let count=0;
 const db={execute:async()=>{count++;return [[{id:'42'}],[]];}};
 const policy={version:1,models:{[customer.id]:{read:[]}},workflows:{}};
 await assert.rejects(executePublishedView(db,p,base,actor,policy),{status:403});
 assert.equal(count,0);
 await assert.rejects(executePublishedView(db,p,{...base,parentId:''},actor,null),{status:400});
 const missingDb={execute:async()=>[[],[]]};
 await assert.rejects(executePublishedView(missingDb,p,base,actor,null),{status:404});
});
