/** Generate editable, metadata-only CRUD screens from a validated data model.
 *
 * All created pages, controls and workflows use the same authoring primitives as
 * the visual designer. No SQL, arbitrary scripts or server access are involved.
 */
import { createComponent, createId, validateProject } from './model.js';
import { createStep } from './workflow.js';

const controlTypes = new Set(['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime']);
const titleCase = value => String(value).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

function component(type, props = {}) {
  const node = createComponent(type);
  Object.assign(node.props, props);
  return node;
}
function editableField(model, field, project) {
  if (!controlTypes.has(field.type)) throw new Error(`Unsupported field type: ${field.type}`);
  const reference = project.models.find(item => item.id === field.referenceModelId);
  const label = reference ? `${titleCase(field.name)} (${reference.name} ID)` : titleCase(field.name);
  const type = field.type === 'boolean' ? 'checkbox' : field.type === 'text' ? 'textarea' : 'input';
  const placeholder = field.referenceModelId ? 'Enter referenced record ID'
    : field.type === 'date' ? 'YYYY-MM-DD'
    : field.type === 'datetime' ? 'YYYY-MM-DD HH:MM:SS'
    : field.type === 'integer' || field.type === 'decimal' ? 'Enter a number'
    : `Enter ${label.toLowerCase()}`;
  return component(type, {
    label, field: field.name, required: field.required,
    bindingModelId: model.id, bindingFieldId: field.id,
    ...(type !== 'checkbox' ? { placeholder } : {})
  });
}
function workflow(page, button, model, operation, fields) {
  const operationStep = createStep(operation, createId('step'), { modelId: model.id });
  const done = createStep('message', createId('step'), {
    text: `${model.name} ${operation === 'create' ? 'created' : operation === 'update' ? 'updated' : 'deleted'} successfully.`
  });
  operationStep.nextId = done.id;
  const steps = [operationStep, done];
  let startStepId = operationStep.id;
  if (operation !== 'delete') {
    const required = fields.filter(field => field.required && field.type !== 'boolean');
    // The workflow engine allows at most 80 steps, including the shared error node.
    if (required.length > 76) throw new Error('Too many required attributes for generated validation workflow');
    if (required.length) {
      const error = createStep('message', createId('step'), { text: 'Complete all required fields before saving.' });
      const checks = required.map(field => createStep('condition', createId('step'), {
        field: field.name, operator: 'filled', value: '', modelId: '', trueId: '', falseId: error.id
      }));
      for (let index = 0; index < checks.length; index++) checks[index].trueId = checks[index + 1]?.id ?? operationStep.id;
      steps.unshift(...checks); steps.push(error);
      startStepId = checks[0].id;
    }
  }
  return {
    id: createId('workflow'),
    name: `${titleCase(operation)} ${model.name}`,
    trigger: { pageId: page.id, componentId: button.id, event: 'click' },
    startStepId, steps
  };
}
/**
 * Atomically generate list/edit and create pages for one existing model.
 * Use a cloned project (as the editor's undo-safe change() function does).
 * Repeated generation creates uniquely named routes without modifying old pages.
 */
export function scaffoldModelCrud(project, modelId) {
  validateProject(project);
  const model = project.models.find(item => item.id === modelId);
  if (!model) throw new Error('Choose a valid model before generating screens');
  if (project.pages.length + 2 > 100) throw new Error('Project page limit reached');
  if (project.workflows.length + 3 > 100) throw new Error('Project workflow limit reached');

  const attributes = model.fields.filter(field => !field.primary);
  if (!attributes.length) throw new Error('Add at least one non-primary attribute to this model');
  const uniqueSuffix = number => number === 1 ? '' : `-${number}`;
  const routes = new Set(project.pages.map(page => page.path));
  let number = 1;
  while (routes.has(`/data/${model.table}${uniqueSuffix(number)}`) || routes.has(`/data/${model.table}${uniqueSuffix(number)}/new`)) number++;
  const base = `/data/${model.table}${uniqueSuffix(number)}`;
  const list = { id: createId('page'), name: `${model.name} records${uniqueSuffix(number)}`, path: base, components: [] };
  const create = { id: createId('page'), name: `New ${model.name}${uniqueSuffix(number)}`, path: `${base}/new`, components: [] };
  const columnNames = model.fields.slice(0, 6).map(field => field.name).join(',');
  const table = component('table', { title: `${model.name} records`, columns: columnNames, bindingModelId: model.id });
  const newButton = component('button', { text: `New ${model.name}`, action: 'navigate', targetPageId: create.id });
  const update = component('button', { text: 'Update selected', action: 'update', bindingModelId: model.id });
  const remove = component('button', { text: 'Delete selected', variant: 'secondary', action: 'delete', bindingModelId: model.id });
  const save = component('button', { text: `Create ${model.name}`, action: 'create', bindingModelId: model.id });
  const back = component('button', { text: `Back to ${model.name} records`, variant: 'secondary', action: 'navigate', targetPageId: list.id });

  list.components = [
    component('heading', { text: `${model.name} records`, level: 1 }),
    component('text', { text: 'Select a row to populate the editing fields below. Changes are saved only when you choose an action.' }),
    newButton, table,
    component('section', { title: `Edit ${model.name}`, tone: 'plain' }),
    ...attributes.map(field => editableField(model, field, project)), update, remove
  ];
  create.components = [
    component('heading', { text: `New ${model.name}`, level: 1 }),
    component('text', { text: 'Complete the fields and choose Create. Required fields are validated before the database operation.' }),
    ...attributes.map(field => editableField(model, field, project)), save, back
  ];
  // All changes are staged before changing the supplied document.
  const flows = [
    workflow(create, save, model, 'create', attributes),
    workflow(list, update, model, 'update', attributes),
    workflow(list, remove, model, 'delete', attributes)
  ];
  const candidate = structuredClone(project);
  candidate.pages.push(list, create);
  candidate.workflows.push(...flows);
  validateProject(candidate);
  project.pages.push(list, create);
  project.workflows.push(...flows);
  return { listPageId: list.id, createPageId: create.id, workflowIds: flows.map(flow => flow.id), route: base };
}
