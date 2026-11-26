/** Deterministic, read-only diagnostics for VAS page bindings and visual workflows.
 * No database reads, writes, network requests or executable expressions. */
import { walkNodes, resolveLinkedInputBinding } from './model.js';
import { conditionResult, EVENT_VALUE_FIELD } from './workflow.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const describe = value => value === undefined ? 'undefined' : value === null ? 'null' : typeof value;

/** Describe how every public reusable input resolves for one page, retaining source IDs. */
export function inspectPageBindings(project,page,context={}){
  if(!project||!page||!Array.isArray(page.components))throw new Error('Binding inspection requires a project page');
  const rows=[],diagnostics=[];
  walkNodes(page.components,root=>{
    if(!root.sourceTemplateId)return;
    const template=project.templates?.find(item=>item.id===root.sourceTemplateId);
    if(!template){
      diagnostics.push({severity:'error',componentId:root.id,message:'Reusable component master is missing'});
      return;
    }
    for(const input of template.inputs??[]){
      let node;
      walkNodes([root],child=>{if(child.sourceTemplateNodeId===input.nodeId)node=child;});
      if(!node){
        diagnostics.push({severity:'error',componentId:root.id,message:`Input ${input.name} has no target component`});
        continue;
      }
      const binding=root.inputBindings?.[input.name];
      const resolved=resolveLinkedInputBinding(project,root,input,context);
      const isStatic=Object.hasOwn(root.inputValues??{},input.name);
      const status=binding?resolved.status:isStatic?'instance':'master';
      const value=status==='resolved'?resolved.value:node.props[input.prop];
      const source=binding?.source??(isStatic?'instance':'master');
      const sourceLabel=binding?.source==='form'?`Form · ${binding.field}`:
        binding?.source==='record'?`Selected record · ${project.models.find(m=>m.id===binding.modelId)?.name??binding.modelId} / ${project.models.find(m=>m.id===binding.modelId)?.fields.find(f=>f.id===binding.fieldId)?.name??binding.fieldId}`:
        isStatic?'Instance property':'Master property';
      const row={componentId:node.id,instanceId:root.id,templateId:template.id,inputName:input.name,
        property:input.prop,expectedType:input.type,source,sourceLabel,status,value:copy(value),
        ...(binding&&status!=='resolved'?{reason:resolved.reason}:{}),
        overridden:Object.hasOwn(node.overrides??{},input.prop)};
      rows.push(row);
      if(binding&&status!=='resolved')diagnostics.push({severity:status==='type-mismatch'?'error':'warning',componentId:node.id,inputName:input.name,message:`${sourceLabel}: ${resolved.reason}; static value is shown`});
    }
  });
  return {pageId:page.id,rows,diagnostics};
}

/** Inspect the values a dry-run workflow will actually observe. */
export function inspectWorkflowContext(project,flow,{fields={},selectedRecords={},eventContext=null,records={}}={}){
  if(!project||!flow)throw new Error('Workflow context requires a project and workflow');
  const page=project.pages.find(p=>p.id===flow.trigger.pageId);
  if(!page)throw new Error('Workflow trigger page is missing');
  const formFields=[],seen=new Set(),diagnostics=[];
  walkNodes(page.components,node=>{
    if(!['input','textarea','select','checkbox'].includes(node.type)||!node.props.field||seen.has(node.props.field))return;
    const field=node.props.field;seen.add(field);
    const expectedType=node.type==='checkbox'?'boolean':'string';
    const exists=Object.hasOwn(fields,field);const value=exists?fields[field]:undefined;
    const status=!exists?'unset':typeof value!==expectedType?'type-mismatch':'ready';
    formFields.push({componentId:node.id,field,expectedType,status,value:exists?copy(value):null});
    if(status==='type-mismatch')diagnostics.push({severity:'error',componentId:node.id,message:`${field} expects ${expectedType}; received ${describe(value)}`});
  });
  const conditions=flow.steps.filter(step=>step.type==='condition').map(step=>{
    const source=step.operator==='selected'?`Selected record · ${step.modelId}`:
      step.field===EVENT_VALUE_FIELD?'Current event value':`Form · ${step.field}`;
    const actual=step.operator==='selected'?selectedRecords[step.modelId]:
      step.field===EVENT_VALUE_FIELD?eventContext?.value:fields[step.field];
    return {stepId:step.id,source,operator:step.operator,actual:actual===undefined?null:copy(actual),
      expected:step.value??'',result:conditionResult(step,{fields,selectedRecords,eventContext})};
  });
  for(const step of flow.steps){
    if(step.type==='condition'&&step.operator!=='selected'&&step.field!==EVENT_VALUE_FIELD&&!Object.hasOwn(fields,step.field)){
      const control=formFields.find(x=>x.field===step.field);
      diagnostics.push({severity:'warning',stepId:step.id,componentId:control?.componentId??'',message:`Condition ${step.id} reads an unset field: ${step.field}`});
    }
    if(step.type==='condition'&&step.field===EVENT_VALUE_FIELD&&eventContext===null)
      diagnostics.push({severity:'warning',stepId:step.id,componentId:flow.trigger.componentId,message:'Current event value is unavailable until the debug session starts'});
  }
  const bindings=inspectPageBindings(project,page,{fields,selected:selectedRecords,records});
  return {pageId:page.id,eventContext:eventContext?copy(eventContext):null,formFields,
    selectedRecords:copy(selectedRecords),conditions,bindings:bindings.rows,
    diagnostics:[...diagnostics,...bindings.diagnostics]};
}
