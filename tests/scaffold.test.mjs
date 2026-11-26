import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createModel,createField,cloneProject,validateProject,walkNodes} from '../src/lib/studio/model.js';
import {scaffoldModelCrud} from '../src/lib/studio/scaffold.js';
import {startWorkflowDebug,finishWorkflowDebug} from '../src/lib/studio/debugger.js';
import {exportPageToSvelte} from '../src/lib/studio/compiler.js';

const nodes=page=>{const all=[];walkNodes(page.components,node=>all.push(node));return all;};

test('scaffold creates two pages and three valid workflows without changing existing pages',()=>{
  const project=createProject(),before=cloneProject(project),result=scaffoldModelCrud(project,'model_customer');
  assert.equal(project.pages.length,before.pages.length+2);
  assert.equal(project.workflows.length,before.workflows.length+3);
  assert.deepEqual(project.pages.slice(0,before.pages.length),before.pages);
  const list=project.pages.find(page=>page.id===result.listPageId);
  const create=project.pages.find(page=>page.id===result.createPageId);
  assert.equal(list.path,'/data/customers');
  assert.equal(create.path,'/data/customers/new');
  assert.equal(nodes(list).find(node=>node.type==='table').props.bindingModelId,'model_customer');
  assert.deepEqual(nodes(list).filter(node=>node.type==='button').map(node=>node.props.action),['navigate','update','delete']);
  assert.equal(validateProject(project),project);
});

test('generated form controls preserve typed model bindings',()=>{
  const project=createProject(),model=project.models[1];
  model.fields.push({...createField('approved','boolean'),required:true});
  model.fields.push(createField('notes','text'));
  const result=scaffoldModelCrud(project,model.id);
  const form=nodes(project.pages.find(page=>page.id===result.createPageId)).filter(node=>node.props.bindingFieldId);
  assert.deepEqual(form.map(node=>node.props.field),model.fields.filter(field=>!field.primary).map(field=>field.name));
  assert.equal(form.find(node=>node.props.field==='approved').type,'checkbox');
  assert.equal(form.find(node=>node.props.field==='notes').type,'textarea');
  assert.match(form.find(node=>node.props.field==='customer_id').props.label,/Customer ID/);
  validateProject(project);
});

test('missing required values avoid simulated writes; complete values take create path',()=>{
  const project=createProject(),{workflowIds}=scaffoldModelCrud(project,'model_customer');
  const flow=project.workflows.find(item=>item.id===workflowIds[0]);
  const missing=finishWorkflowDebug(flow,startWorkflowDebug(flow,{fields:{name:'A',email:''}}));
  assert.equal(missing.effects.some(effect=>effect.type==='data'),false);
  const valid=finishWorkflowDebug(flow,startWorkflowDebug(flow,{fields:{name:'A',email:'a@example.test'}}));
  assert.equal(valid.effects.find(effect=>effect.type==='data').operation,'create');
});

test('repeat generation creates distinct routes and component IDs',()=>{
  const project=createProject();
  const first=scaffoldModelCrud(project,'model_customer');
  const old=cloneProject(project.pages.find(page=>page.id===first.listPageId));
  assert.equal(scaffoldModelCrud(project,'model_customer').route,'/data/customers-2');
  assert.deepEqual(project.pages.find(page=>page.id===first.listPageId),old);
  const ids=new Set(),routes=new Set();
  for(const page of project.pages){
    assert.equal(routes.has(page.path),false);routes.add(page.path);
    for(const node of nodes(page)){assert.equal(ids.has(node.id),false);ids.add(node.id);}
  }
  validateProject(project);
});

test('invalid model, page limits and oversized required checks do not mutate project',()=>{
  const project=createProject(),before=cloneProject(project);
  assert.throws(()=>scaffoldModelCrud(project,'missing'),/valid model/);
  assert.deepEqual(project,before);
  const model=createModel('Massive','massive','model_massive');
  for(let index=0;index<77;index++)model.fields.push({...createField('attr_'+index,'string'),required:true});
  project.models.push(model);
  const snapshot=cloneProject(project);
  assert.throws(()=>scaffoldModelCrud(project,model.id),/Too many required attributes/);
  assert.deepEqual(project,snapshot);
});

test('generated CRUD pages compile to portable Svelte markup',()=>{
  const project=createProject(),{listPageId}=scaffoldModelCrud(project,'model_order');
  const source=exportPageToSvelte(project.pages.find(page=>page.id===listPageId));
  assert.match(source,/<table>/);
  assert.match(source,/Update selected/);
  assert.match(source,/Delete selected/);
  validateProject(project);
});
