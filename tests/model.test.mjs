import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA_VERSION,COMPONENT_TYPES,FIELD_TYPES,createProject,createComponent,createField,createModel,moveComponent,validateProject,migrateProject,findNodeLocation,insertNode,moveNode,removeNode,duplicateNode,walkNodes} from '../src/lib/studio/model.js';
import {escapeHtml,exportPageToSvelte,exportMySQL} from '../src/lib/studio/compiler.js';

test('demo project validates, has nested layouts, models and a typed relationship',()=>{
  const p=createProject();assert.equal(SCHEMA_VERSION,3);assert.equal(validateProject(p),p);
  assert.equal(p.models.length,2);assert.equal(p.pages.length,2);
  assert.equal(findNodeLocation(p.pages[0],p.pages[0].components[1].children[0].id).depth,1);
  assert.match(exportMySQL(p),/FOREIGN KEY/);
});
test('all component and field types are supported',()=>{
  for(const t of COMPONENT_TYPES)assert.equal(createComponent(t).type,t);
  for(const t of FIELD_TYPES)assert.equal(createField('example',t).type,t);
  assert.throws(()=>createComponent('script'));
});
test('v1 imports migrate without losing pages or component IDs',()=>{
  const p=createProject();const v1={schemaVersion:1,id:p.id,name:p.name,pages:p.pages.map(pg=>({...pg,components:pg.components.filter(x=>!x.children).map(c=>{const copy=structuredClone(c);delete copy.props.bindingModelId;delete copy.props.bindingFieldId;return copy;})}))};
  const migrated=validateProject(migrateProject(v1));
  assert.equal(migrated.schemaVersion,3);assert.deepEqual(migrated.models,[]);
  assert.equal(migrated.pages[0].components[0].id,v1.pages[0].components[0].id);
  assert.throws(()=>migrateProject({schemaVersion:10}),/Unsupported/);
});
test('tree move handles nested placements and rejects cycles',()=>{
  const p=createProject(),pg=p.pages[0],section=pg.components[1],heading=pg.components[0];
  moveNode(pg,heading.id,section.id,0);
  assert.equal(findNodeLocation(pg,heading.id).parentId,section.id);
  assert.throws(()=>moveNode(pg,section.id,section.id,0),/itself/);
  const inner=createComponent('section');insertNode(pg,inner,section.id);
  assert.throws(()=>moveNode(pg,section.id,inner.id),/cycle/);
  moveNode(pg,heading.id,'',0);assert.equal(findNodeLocation(pg,heading.id).parentId,'');
  assert.equal(validateProject(p),p);
});
test('duplicate regenerates descendant IDs, removal updates tree',()=>{
  const p=createProject(),pg=p.pages[0],section=pg.components[1],dup=duplicateNode(section);
  insertNode(pg,dup,'',2);
  const ids=[];walkNodes(pg.components,n=>ids.push(n.id));
  assert.equal(ids.length,new Set(ids).size);
  assert.ok(removeNode(pg,section.id));
  assert.equal(findNodeLocation(pg,section.id),null);
  validateProject(p);
});
test('reordering flat components is stable',()=>{
  const list=['a','b','c','d'];assert.deepEqual(moveComponent(list,0,4),['b','c','d','a']);
  assert.deepEqual(moveComponent(list,3,1),['a','d','b','c']);
  assert.deepEqual(moveComponent(list,1,2),list);
});
test('schema rejects duplicate IDs, invalid table names, broken foreign keys and bindings',()=>{
  const p=createProject();p.models[0].table='bad;DROP TABLE users';assert.throws(()=>validateProject(p),/table/);
  p.models[0].table='customers';p.models[1].fields.at(-2).referenceFieldId='missing';assert.throws(()=>validateProject(p),/relationship/);
  p.models[1].fields.at(-2).referenceFieldId=p.models[0].fields[0].id;
  p.pages[1].components[2].props.bindingFieldId='missing';assert.throws(()=>validateProject(p),/binding/);
  p.pages[1].components[2].props.bindingFieldId=p.models[0].fields[1].id;
  p.pages[0].components.push({...p.pages[0].components[0]});assert.throws(()=>validateProject(p),/duplicate/);
});
test('MySQL exporter uses fixed types and quoted validated names',()=>{
  const p=createProject(),sql=exportMySQL(p);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS `customers`/);
  assert.match(sql,/`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT/);
  assert.match(sql,/`email` VARCHAR\(255\) NOT NULL UNIQUE/);
  assert.match(sql,/ALTER TABLE `orders` ADD CONSTRAINT/);
  assert.ok(sql.indexOf('CREATE TABLE IF NOT EXISTS `orders`')<sql.indexOf('ALTER TABLE'));
  p.models[0].fields[1].name='a`); DROP TABLE x; --';assert.throws(()=>exportMySQL(p),/Invalid/);
});
test('rejects unsupported unique TEXT indexes in MySQL DDL',()=>{
  const p=createProject();p.models[0].fields[1].type='text';p.models[0].fields[1].unique=true;
  assert.throws(()=>validateProject(p),/TEXT fields/);
});
test('markup generation recurses and escapes untrusted user input',()=>{
  const pg=createProject().pages[0];pg.components[1].children[0].props.text='<script>alert(1)</script>';
  const output=exportPageToSvelte(pg);
  assert.match(output,/class="layout-section"/);
  assert.match(output,/&lt;script&gt;/);assert.ok(!output.includes('<script>alert'));
  assert.equal(escapeHtml('&'),'&amp;');
  const all={components:COMPONENT_TYPES.map(t=>createComponent(t))};
  assert.match(exportPageToSvelte(all),/<table>/);
});
test('model delete safety: broken model references are rejected',()=>{
  const p=createProject();p.models.shift();assert.throws(()=>validateProject(p),/relationship|binding/);
  const isolated=createModel('Isolated','isolated');p.models.push(isolated);
  assert.throws(()=>validateProject(p),/relationship|binding/);
});
