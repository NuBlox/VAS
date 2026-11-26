import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createModel, createField, validateProject, cloneProject, walkNodes } from '../src/lib/studio/model.js';
import { scaffoldModelCrud } from '../src/lib/studio/scaffold.js';
import { startWorkflowDebug, finishWorkflowDebug } from '../src/lib/studio/debugger.js';
import { exportPageToSvelte } from '../src/lib/studio/compiler.js';

const collect = page => { const nodes = []; walkNodes(page.components, node => nodes.push(node)); return nodes; };

test('one action creates list, create, edit controls and three valid workflows', () => {
  const project = createProject(), initial = cloneProject(project);
  const result = scaffoldModelCrud(project, 'model_customer');
  assert.equal(project.pages.length, initial.pages.length + 2);
  assert.equal(project.workflows.length, initial.workflows.length + 3);
  assert.equal(project.pages[0].id, initial.pages[0].id);
  assert.equal(project.workflows[0].id, initial.workflows[0].id);
  const list = project.pages.find(p => p.id === result.listPageId);
  const create = project.pages.find(p => p.id === result.createPageId);
  assert.equal(list.path, '/data/customers');
  assert.equal(create.path, '/data/customers/new');
  const nodes = collect(list);
  assert.equal(nodes.find(node => node.type === 'table').props.bindingModelId, 'model_customer');
  assert.deepEqual(nodes.filter(node => node.type === 'button').map(node => node.props.action), ['navigate', 'update', 'delete']);
  assert.equal(collect(create).find(node => node.props.action === 'create').props.bindingModelId, 'model_customer');
  assert.equal(validateProject(project), project);
});

test('scaffold uses typed field controls and actual bound model attributes', () => {
  const project = createProject();
  const model = project.models.find(m => m.id === 'model_order');
  model.fields.push({...createField('approved', 'boolean'), required: true});
  model.fields.push({...createField('notes', 'text'), required: false});
  const {listPageId, createPageId} = scaffoldModelCrud(project, model.id);
  const list = project.pages.find(page => page.id === listPageId);
  const create = project.pages.find(page => page.id === createPageId);
  const formControls = collect(create).filter(node => node.props.bindingFieldId);
  assert.deepEqual(formControls.map(node => node.props.field), model.fields.filter(field => !field.primary).map(field => field.name));
  assert.equal(formControls.find(node => node.props.field === 'approved').type, 'checkbox');
  assert.equal(formControls.find(node => node.props.field === 'notes').type, 'textarea');
  assert.equal(formControls.find(node => node.props.field === 'customer_id').type, 'select');
  assert.equal(formControls.find(node => node.props.field === 'customer_id').props.label, 'Customer');
  assert.equal(formControls.find(node => node.props.field === 'customer_id').props.referenceDisplayFieldId, 'field_customer_name');
  assert.deepEqual(collect(list).filter(node => node.props.bindingFieldId).map(node => node.props.field), formControls.map(node => node.props.field));
  assert.equal(validateProject(project), project);
});

test('required-field path blocks simulated writes and complete inputs take the success branch', () => {
  const project = createProject();
  const { workflowIds } = scaffoldModelCrud(project, 'model_customer');
  const flow = project.workflows.find(w => w.id === workflowIds[0]);
  const missing = finishWorkflowDebug(flow, startWorkflowDebug(flow, { fields: { name: 'A customer', email: '' } }));
  assert.ok(!missing.effects.some(effect => effect.type === 'data'));
  assert.match(missing.effects.at(-1).text, /required fields/);
  const filled = finishWorkflowDebug(flow, startWorkflowDebug(flow, { fields: { name: 'A customer', email: 'a@example.test' } }));
  assert.deepEqual(filled.effects.filter(effect => effect.type === 'data').map(effect => effect.operation), ['create']);
  assert.match(filled.effects.at(-1).text, /created/);
  const update = project.workflows.find(w => w.id === workflowIds[1]);
  const remove = project.workflows.find(w => w.id === workflowIds[2]);
  assert.equal(finishWorkflowDebug(update, startWorkflowDebug(update, { fields: { name:'A', email:'a@example.test' } })).effects.find(x => x.type === 'data').operation,'update');
  assert.equal(finishWorkflowDebug(remove, startWorkflowDebug(remove)).effects.find(x => x.type === 'data').operation,'delete');
});

test('generating twice does not mutate existing screens or reuse component IDs or paths', () => {
  const project = createProject();
  const first = scaffoldModelCrud(project, 'model_customer');
  const original = cloneProject(project.pages.find(p => p.id === first.listPageId));
  const second = scaffoldModelCrud(project, 'model_customer');
  assert.equal(second.route, '/data/customers-2');
  assert.deepEqual(project.pages.find(p => p.id === first.listPageId), original);
  const ids = new Set(), paths = new Set();
  for (const page of project.pages) { assert.ok(!paths.has(page.path)); paths.add(page.path); for (const node of collect(page)) { assert.ok(!ids.has(node.id)); ids.add(node.id); } }
  validateProject(project);
});

test('invalid model and limits leave original project unchanged', () => {
  const project = createProject(), before = cloneProject(project);
  assert.throws(() => scaffoldModelCrud(project, 'missing'), /valid model/);
  assert.deepEqual(project, before);
  for (let index = 0; index < 98; index++) project.pages.push({id: `mock_${index}`,name: 'Placeholder',path:`/temporary-${index}`,components: []});
  const snapshot = cloneProject(project);
  assert.throws(() => scaffoldModelCrud(project, 'model_customer'), /page limit/);
  assert.deepEqual(project, snapshot);
});

test('generated pages export without running scripts or requiring manual code edits', () => {
  const project = createProject();
  const result = scaffoldModelCrud(project, 'model_order');
  const page = project.pages.find(p => p.id === result.listPageId);
  const source = exportPageToSvelte(page);
  assert.match(source, /<table>/);
  assert.match(source, /Update selected/);
  assert.match(source, /Delete selected/);
  assert.equal(validateProject(project), project);
});

test('overlong generated workflow is rejected atomically', () => {
  const project = createProject();
  const model = createModel('Massive', 'massive', 'model_massive');
  for (let i=0; i<77; i++) model.fields.push({...createField(`attr_${i}`,'string'),required:true});
  project.models.push(model);
  const snapshot = cloneProject(project);
  assert.throws(() => scaffoldModelCrud(project, model.id), /Too many required attributes/);
  assert.deepEqual(project, snapshot);
});
