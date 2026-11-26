import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,cloneProject,validateProject,walkNodes} from '../src/lib/studio/model.js';
import {scaffoldMasterDetail} from '../src/lib/studio/master-detail.js';
import {relationshipMetadata,detailMetadata,relatedRows} from '../src/lib/studio/relations.js';
import {listRelatedRecords,relatedStatements,pagination,publishedRelation} from '../src/lib/server/runtime/relations.js';
import {inspectWorkflowContext} from '../src/lib/studio/inspection.js';

function fixture(){
  const project=createProject(),customer=project.models[0],order=project.models[1],fk=order.fields.find(f=>f.referenceModelId===customer.id);
  const route=scaffoldMasterDetail(project,customer.id,order.id,fk.id);
  const page=project.pages.find(p=>p.id===route.masterPageId);
  return {project,customer,order,fk,route,page,table:page.components.find(n=>n.props?.relationParentModelId)};
}
test('creates editable parent selection, related list and child detail without modifying old pages',()=>{
  const project=createProject(),before=cloneProject(project);
  const customer=project.models[0],order=project.models[1],fk=order.fields.find(f=>f.referenceModelId===customer.id);
  const first=scaffoldMasterDetail(project,customer.id,order.id,fk.id);
  assert.deepEqual(project.pages.slice(0,before.pages.length),before.pages);
  const master=project.pages.find(p=>p.id===first.masterPageId),detail=project.pages.find(p=>p.id===first.detailPageId);
  assert.equal(master.components.filter(c=>c.type==='table').length,2);
  assert.equal(master.components.find(c=>c.props.relationParentModelId).props.detailPageId,detail.id);
  assert.equal(detail.components.find(c=>c.type==='record-detail').props.bindingModelId,order.id);
  assert.equal(detail.components.find(c=>c.props.action==='navigate').props.keepSelection,true);
  const again=scaffoldMasterDetail(project,customer.id,order.id,fk.id);
  assert.notEqual(first.route,again.route);
  assert.equal(validateProject(project),project);
});
test('filters trial rows by the selected parent and the debugger exposes identical relation membership',()=>{
  const {project,customer,order,route,table}=fixture();
  const config=relationshipMetadata(project,table),sample=[{id:'11',name:'A',customer_id:'1'},{id:'12',name:'B',customer_id:'2'},{id:'13',name:'C',customer_id:'1'}];
  assert.deepEqual(relatedRows(config,sample,'1').map(x=>x.id),['11','13']);
  assert.deepEqual(relatedRows(config,sample,''),[]);
  const page=project.pages.find(p=>p.id===route.masterPageId);
  // The existing Customer workflow is used as a debugger entry point on a page with a relation table.
  const trial=structuredClone(project.workflows[0]);trial.trigger.pageId=page.id;
  const snapshot=inspectWorkflowContext(project,trial,{selectedRecords:{[customer.id]:'1'},records:{[order.id]:sample}});
  assert.equal(snapshot.relatedLists[0].count,2);
  assert.deepEqual(snapshot.relatedLists[0].recordIds,['11','13']);
});
test('published relation query is bounded, parameterized and uses published identifiers',()=>{
  const {project,page,table,route}=fixture();
  const config=publishedRelation(project,page.id,table.id);
  const {children,parent,limit,page:pageIndex,offset}=relatedStatements(config,'27','2','10');
  assert.deepEqual(children.params,['27',10,20]);
  assert.deepEqual(parent.params,['27']);
  assert.match(children.sql,/WHERE `customer_id` = \?/);
  assert.match(children.sql,/LIMIT \? OFFSET \?/);
  assert.ok(!children.sql.includes('27'));
  assert.equal(limit,10);assert.equal(pageIndex,2);assert.equal(offset,20);
  assert.equal(detailMetadata(project,project.pages.find(p=>p.id===route.detailPageId).components[1]).model.id,config.child.id);
  for(const invalid of ['-1','01','41','1; DROP TABLE','9999'])assert.throws(()=>pagination(invalid,'20'));
  for(const invalid of ['0','26','xyz','-1'])assert.throws(()=>pagination('0',invalid));
  assert.throws(()=>relatedStatements(config,'1 OR 1=1','0','20'),/integer/);
  assert.throws(()=>publishedRelation(project,page.id,'missing'),{status:404});
});
test('related reads require both permissions, cannot reveal missing parents, and are page-scoped',async()=>{
  const {project,customer,order,page,table}=fixture();
  const actor={id:'a',role:'viewer'};
  const seen=[];
  const db={async execute(sql,params){seen.push({sql,params});return [seen.length===1?[{'1':1}]:[{id:'12',name:'Test'}]];}};
  const result=await listRelatedRecords(db,project,page.id,table.id,'1','0','20',actor,null);
  assert.equal(result.records[0].name,'Test');assert.equal(seen.length,2);
  assert.deepEqual(seen[1].params,['1',20,0]);
  const denial={models:{[customer.id]:{read:['admin']}}};
  await assert.rejects(listRelatedRecords(db,project,page.id,table.id,'1','0','20',actor,denial),{status:403});
  assert.equal(seen.length,2,'denied reads must not issue SQL');
  const childDenial={models:{[order.id]:{read:['admin']}}};
  await assert.rejects(listRelatedRecords(db,project,page.id,table.id,'1','0','20',actor,childDenial),{status:403});
  const noParent={async execute(){return [[]];}};
  await assert.rejects(listRelatedRecords(noParent,project,page.id,table.id,'1','0','20',actor,null),{status:404});
  await assert.rejects(listRelatedRecords(db,project,page.id,'nonexistent','1','0','20',actor,null),{status:404});
});
test('broken relation metadata and malicious columns cannot be published',()=>{
  const {project,page,table}=fixture();
  for(const patch of [
    {relationFieldId:'missing'},
    {relationParentModelId:'missing'},
    {columns:'name, (SELECT password FROM users)'},
    {detailPageId:'missing_page'},
    {relationFieldId:project.models[1].fields.find(f=>f.name==='name').id}
  ]){
    const copy=cloneProject(project);
    Object.assign(copy.pages.find(p=>p.id===page.id).components.find(c=>c.id===table.id).props,patch);
    assert.throws(()=>validateProject(copy));
  }
  const copy=cloneProject(project);
  const before=cloneProject(copy);
  assert.throws(()=>scaffoldMasterDetail(copy,project.models[1].id,project.models[0].id,'missing'));
  assert.deepEqual(copy,before);
});
