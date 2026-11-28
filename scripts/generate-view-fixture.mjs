#!/usr/bin/env node
/** Exportable customer/order example with reusable data views and parent-scoped results. */
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createProject,createComponent,validateProject} from '../src/lib/studio/model.js';
import {createDataView} from '../src/lib/studio/data-views.js';

const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/generate-view-fixture.mjs /path/project.json');
const project=createProject(),client=project.models[0],order=project.models[1];
const fk=order.fields.find(f=>f.name==='customer_id');
const master=project.pages[0];
master.name='Customer → Orders';
const parentTable=createComponent('table');
const childTable=createComponent('table');
const customers=createDataView(client,{id:'view_customers_v2',name:'Customers by name'});
const orders=createDataView(order,{id:'view_orders_v2',name:'Orders by amount',parentField:'customer_id'});
orders.sort={field:'amount',direction:'desc'};
project.dataViews=[customers,orders];
Object.assign(parentTable.props,{title:'Choose a customer',bindingModelId:client.id,dataViewId:customers.id,columns:customers.columns.join(',')});
Object.assign(childTable.props,{title:'Orders for this customer',bindingModelId:order.id,dataViewId:orders.id,columns:orders.columns.join(','),relationParentModelId:client.id,relationFieldId:fk.id});
master.components.push(parentTable,childTable);
validateProject(project);
writeFileSync(resolve(file),JSON.stringify(project,null,2)+'\n');
console.log(`Wrote ${file} with 2 reusable views and a parent-scoped related table`);
