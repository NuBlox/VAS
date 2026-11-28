#!/usr/bin/env node
/** Reusable, metadata-defined query builder demo. Never emits SQL or executable script. */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createProject,createComponent,createField,validateProject} from '../src/lib/studio/model.js';
import {createDataView} from '../src/lib/studio/data-views.js';
const path=process.argv[2];
if(!path)throw Error('Usage: node scripts/generate-query-builder-fixture.mjs /path/project.json');
const p=createProject(),client=p.models[0],order=p.models[1],page=p.pages[0];
page.name='Customers and filtered Orders';
order.fields.push({...createField('ordered_on','date'),required:false});
const min=createComponent('input');Object.assign(min.props,{label:'Minimum order amount',field:'minimum_amount',placeholder:'0.00'});
const parentTable=createComponent('table'),childTable=createComponent('table');
const customers=createDataView(client,{id:'view_customer_v21',name:'Customers by name'});
const orders=createDataView(order,{id:'view_order_v21',name:'Orders by amount',parentField:'customer_id'});
orders.sort={field:'amount',direction:'desc'};
orders.filters.push({field:'amount',operator:'gte',source:'form',binding:'minimum_amount'});
orders.filters.push({field:'customer_id',operator:'eq',source:'selected',binding:client.id});
orders.filters.push({field:'ordered_on',operator:'gte',source:'literal',value:'2026-01-01'});
const fk=order.fields.find(f=>f.name==='customer_id');
Object.assign(parentTable.props,{title:'Choose customer',bindingModelId:client.id,dataViewId:customers.id,columns:customers.columns.join(',')});
Object.assign(childTable.props,{title:'Filtered orders',bindingModelId:order.id,dataViewId:orders.id,columns:orders.columns.join(','),relationParentModelId:client.id,relationFieldId:fk.id});
p.dataViews=[customers,orders];page.components.push(min,parentTable,childTable);
validateProject(p);
writeFileSync(resolve(path),JSON.stringify(p,null,2)+'\n');
console.log('Generated Customer/Order application with typed AND filters, a form binding, and selected-parent scoping');
