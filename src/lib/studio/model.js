/** Safe, portable, metadata-first project definitions. Older projects migrate without data loss. */
import { createStep, validateWorkflows } from './workflow.js';
import { pickerMetadata } from './references.js';
export const SCHEMA_VERSION = 3;
export const FIELD_TYPES = ['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime'];
export const CONTAINER_TYPES = ['section', 'columns'];
export const COMPONENT_TYPES = ['heading','text','input','textarea','select','checkbox','button','card','divider','table',...CONTAINER_TYPES];
export const CATALOG = [
  {type:'section',label:'Section',group:'Layout',icon:'▤'},
  {type:'columns',label:'Two columns',group:'Layout',icon:'▥'},
  {type:'heading',label:'Heading',group:'Content',icon:'H'},
  {type:'text',label:'Text',group:'Content',icon:'¶'},
  {type:'card',label:'Card',group:'Content',icon:'▣'},
  {type:'divider',label:'Divider',group:'Content',icon:'—'},
  {type:'input',label:'Text field',group:'Form controls',icon:'T'},
  {type:'textarea',label:'Text area',group:'Form controls',icon:'☰'},
  {type:'select',label:'Dropdown',group:'Form controls',icon:'▾'},
  {type:'checkbox',label:'Checkbox',group:'Form controls',icon:'☑'},
  {type:'button',label:'Button',group:'Actions',icon:'▰'},
  {type:'table',label:'Data table',group:'Data display',icon:'▦'}
];
export function createId(prefix='node') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
}
export function createComponent(type,id=createId('component')) {
  const defaults = {
    heading:{text:'New heading',level:2},text:{text:'Write some supporting text here.'},
    input:{label:'Text field',field:'text_field',placeholder:'Enter a value',required:false,bindingModelId:'',bindingFieldId:''},
    textarea:{label:'Your notes',field:'notes',placeholder:'Enter your notes',required:false,bindingModelId:'',bindingFieldId:''},
    select:{label:'Choose an option',field:'choice',options:'First option\nSecond option\nThird option',required:false,bindingModelId:'',bindingFieldId:'',referenceDisplayFieldId:''},
    checkbox:{label:'I agree',field:'agreed',required:false,bindingModelId:'',bindingFieldId:''},
    button:{text:'Submit',variant:'primary',action:'submit',targetPageId:'',bindingModelId:''},
    card:{title:'Card title',body:'A useful card with supporting content.'},divider:{},
    table:{title:'Recent records',columns:'name,email',bindingModelId:''},
    section:{title:'Section',tone:'plain'},columns:{title:'Columns',tone:'plain'}
  };
  if (!Object.hasOwn(defaults,type)) throw new Error(`Unknown component: ${type}`);
  const node={id,type,props:{...defaults[type]}};
  if (CONTAINER_TYPES.includes(type)) node.children=[];
  return node;
}
export function createField(name='new_field',type='string',id=createId('field')) {
  return {id,name,type,required:false,unique:false,primary:false,referenceModelId:'',referenceFieldId:''};
}
export function createModel(name='New Model',table='new_model',id=createId('model')) {
  return {id,name,table,fields:[{...createField('id','integer'),required:true,unique:true,primary:true},createField('name','string')]};
}
export function createProject() {
  // Stable example IDs avoid Svelte SSR/client hydration differences.
  // Newly added components/models/pages still receive fresh IDs from createId().
  const dashboard='page_dashboard',customers='page_new_customer';
  const customer=createModel('Customer','customers','model_customer');
  customer.fields[0].id='field_customer_id';
  customer.fields[1].id='field_customer_name';
  customer.fields[1].required=true;
  customer.fields.push({...createField('email','string','field_customer_email'),required:true,unique:true});
  const order=createModel('Order','orders','model_order');
  order.fields[0].id='field_order_id';
  order.fields[1].id='field_order_name';
  order.fields.push({...createField('customer_id','integer','field_order_customer_id'),required:true,referenceModelId:customer.id,referenceFieldId:customer.fields[0].id});
  order.fields.push({...createField('amount','decimal','field_order_amount'),required:true});
  const section=createComponent('section','component_intro_section');section.props.title='Getting started';
  section.children=[createComponent('text','component_intro_text'),createComponent('card','component_intro_card')];
  section.children[0].props.text='Select components in the tree, or open Data models to design your tables and relationships.';
  const flow={id:'workflow_create_customer',name:'Validate and create customer',trigger:{pageId:customers,componentId:'component_form_save',event:'click'},startStepId:'step_check_name',steps:[
    createStep('condition','step_check_name',{field:'name',operator:'filled',value:'',modelId:'',trueId:'step_create_customer',falseId:'step_name_required'}),
    createStep('create','step_create_customer',{modelId:customer.id,nextId:'step_customer_created'}),
    createStep('message','step_customer_created',{text:'Customer saved successfully.',nextId:''}),
    createStep('message','step_name_required',{text:'Please enter the customer name.',nextId:''})
  ]};
  return {schemaVersion:SCHEMA_VERSION,id:'app_starter',name:'Customer Workspace',models:[customer,order],workflows:[flow],actions:[],pages:[
    {id:dashboard,name:'Overview',path:'/',components:[
      {...createComponent('heading','component_overview_heading'),props:{text:'Customer Workspace',level:1}},section,
      {...createComponent('button','component_overview_navigate'),props:{text:'Create a customer',variant:'primary',action:'navigate',targetPageId:customers,bindingModelId:''}}
    ]},
    {id:customers,name:'New customer',path:'/customers/new',components:[
      {...createComponent('heading','component_form_heading'),props:{text:'New customer',level:1}},
      {...createComponent('text','component_form_text'),props:{text:'Capture a new customer using this example form.'}},
      {...createComponent('input','component_form_name'),props:{label:'Full name',field:'name',placeholder:'e.g. Alex Morgan',required:true,bindingModelId:customer.id,bindingFieldId:customer.fields[1].id}},
      {...createComponent('input','component_form_email'),props:{label:'Email address',field:'email',placeholder:'alex@example.com',required:true,bindingModelId:customer.id,bindingFieldId:customer.fields[2].id}},
      {...createComponent('button','component_form_save'),props:{text:'Save customer',variant:'primary',action:'submit',targetPageId:'',bindingModelId:customer.id}}
    ]}
  ]};
}
export function cloneProject(data) { return JSON.parse(JSON.stringify(data)); }
/** v1 and v2 projects preserve IDs, models and page content. No inferred workflows. */
export function migrateProject(source) {
  if (!source || typeof source!=='object' || Array.isArray(source)) throw new Error('Project must be an object');
  if (source.schemaVersion===SCHEMA_VERSION) return source;
  if (source.schemaVersion===2) return {...cloneProject(source),schemaVersion:SCHEMA_VERSION,workflows:[]};
  if (source.schemaVersion===1) return {...cloneProject(source),schemaVersion:SCHEMA_VERSION,models:[],workflows:[]};
  throw new Error(`Unsupported schema version: ${String(source.schemaVersion)}`);
}
export function walkNodes(nodes,visit,parentId='',depth=0) {
  for(const node of nodes) {visit(node,parentId,depth);if(Array.isArray(node.children))walkNodes(node.children,visit,node.id,depth+1);}
}
export function findNodeLocation(page,id) {
  function search(nodes,parentId='',depth=0) {
    for(let i=0;i<nodes.length;i++) {
      if(nodes[i].id===id) return {node:nodes[i],nodes,index:i,parentId,depth};
      if(nodes[i].children) {const found=search(nodes[i].children,nodes[i].id,depth+1);if(found)return found;}
    }
    return null;
  }
  return search(page.components);
}
export function insertNode(page,node,parentId='',index) {
  const parent=parentId ? findNodeLocation(page,parentId)?.node : null;
  if (parentId && (!parent || !CONTAINER_TYPES.includes(parent.type))) throw new Error('Destination is not a container');
  const nodes=parent ? parent.children : page.components;
  const at=index===undefined ? nodes.length : index;
  if(!Number.isInteger(at)||at<0||at>nodes.length)throw new Error('Invalid insertion index');
  nodes.splice(at,0,node);
}
export function moveNode(page,id,toParentId='',toIndex) {
  const from=findNodeLocation(page,id);
  if(!from)throw new Error('Missing component');
  if(toParentId===id)throw new Error('Cannot nest a component inside itself');
  let descendant=false;
  walkNodes([from.node],n=>{if(n.id===toParentId)descendant=true;});
  if(descendant)throw new Error('Cannot create a container cycle');
  const parent=toParentId?findNodeLocation(page,toParentId)?.node:null;
  if(toParentId && (!parent || !CONTAINER_TYPES.includes(parent.type)))throw new Error('Destination is not a container');
  const target=parent?parent.children:page.components;
  const to=toIndex===undefined?target.length:toIndex;
  if(!Number.isInteger(to)||to<0||to>target.length)throw new Error('Invalid move index');
  from.nodes.splice(from.index,1);
  target.splice(target===from.nodes && to>from.index?to-1:to,0,from.node);
}
export function removeNode(page,id) {
  const found=findNodeLocation(page,id);if(!found)return false;
  found.nodes.splice(found.index,1);return true;
}
export function duplicateNode(node) {
  const copy=cloneProject(node);
  walkNodes([copy],n=>{n.id=createId('component');delete n.sourceTemplateId;delete n.sourceTemplateNodeId;delete n.overrides;delete n.inputValues;delete n.inputBindings;delete n.slotFills;});
  return copy;
}
/** Copy a component subtree into the project's reusable library. No workflow triggers are copied. */
export function saveComponentTemplate(project,node,name,id=createId('template')) {
  const title=String(name??'').trim();
  if(!title||title.length>120)throw new Error('Template name must be 1–120 characters');
  if(!Array.isArray(project.templates))project.templates=[];
  if(project.templates.length>=40)throw new Error('A project may have at most 40 templates');
  if(project.templates.some(t=>t.id===id))throw new Error('Duplicate template ID');
  const template={id,name:title,node:duplicateNode(node)};
  project.templates.push(template);
  return template;
}
/** Insert an independent copy: all nested component IDs are regenerated. */
export function insertComponentTemplate(project,templateId,pageId,parentId='',index) {
  const template=project.templates?.find(t=>t.id===templateId);
  if(!template)throw new Error('Reusable component not found');
  const page=project.pages.find(p=>p.id===pageId);
  if(!page)throw new Error('Destination page not found');
  const node=duplicateNode(template.node);
  insertNode(page,node,parentId,index);
  return node;
}
export function deleteComponentTemplate(project,id) {
  if(!project.templates?.some(t=>t.id===id))throw new Error('Reusable component not found');
  if(project.pages.some(page=>{let found=false;walkNodes(page.components,n=>{if(n.sourceTemplateId===id)found=true;});return found;}))throw new Error('Detach linked instances before deleting the master');
  project.templates=project.templates.filter(t=>t.id!==id);
}
/** Linked instances inherit master properties and retain only explicit local overrides. */
export function insertLinkedTemplate(project,templateId,pageId,parentId='',index){
  const template=project.templates?.find(t=>t.id===templateId);
  const page=project.pages.find(p=>p.id===pageId);
  if(!template||!page)throw new Error('Reusable component or destination page not found');
  if(parentId&&findLinkedInstance(page,parentId))throw new Error('Detach a linked component before adding children');
  const node=cloneProject(template.node);
  walkNodes([node],n=>{n.sourceTemplateNodeId=n.id;n.id=createId('component');});
  node.sourceTemplateId=templateId;
  insertNode(page,node,parentId,index);
  return node;
}
export function findLinkedInstance(page,nodeId){
  function inspect(nodes,root=null){
    for(const node of nodes){
      const linked=node.sourceTemplateId?node:root;
      if(node.id===nodeId)return linked?{root:linked,node,templateId:linked.sourceTemplateId}:null;
      if(node.children){const result=inspect(node.children,linked);if(result)return result;}
    }
    return null;
  }
  return inspect(page.components);
}
function assertOverrideValues(templateNode,patch){
  if(!plain(patch))throw new Error('Instance overrides must be an object');
  for(const [key,value] of Object.entries(patch)){
    if(!Object.hasOwn(templateNode.props,key)||typeof value!==typeof templateNode.props[key]||
       key.length>120||(typeof value==='string'&&value.length>10000)||
       (typeof value==='number'&&!Number.isFinite(value)))throw new Error('Invalid reusable component override');
  }
}
/** A component's public inputs always reference a typed, existing master property. */
const inputName=/^[a-z][a-z0-9_]{0,39}$/;
const INPUT_PROPS=new Set(['text','title','body','label','placeholder','required','level']);
const supportedValue=v=>['string','number','boolean'].includes(typeof v) && (typeof v!=='string'||v.length<=10000) && (typeof v!=='number'||Number.isFinite(v));
function masterNode(template,nodeId){let found;walkNodes([template.node],node=>{if(node.id===nodeId)found=node;});return found;}
function publicInput(template,name){return (template.inputs??[]).find(item=>item.name===name);}
function inputForProperty(template,nodeId,key){return (template.inputs??[]).find(item=>item.nodeId===nodeId&&item.prop===key);}
function expectedLinkedProps(template,master,root,node){
  const result=cloneProject(master.props);
  for(const input of template.inputs??[])if(input.nodeId===master.id&&Object.hasOwn(root.inputValues??{},input.name))result[input.prop]=root.inputValues[input.name];
  return {...result,...(node.overrides??{})};
}
function reconcileLinkedNode(template,master,old,root){
  if(old&&(old.sourceTemplateNodeId!==master.id||old.type!==master.type))throw new Error('Linked component master changed type');
  const node=old??cloneProject(master);
  if(!old){walkNodes([node],item=>{item.sourceTemplateNodeId=item.id;item.id=createId('component');});}
  assertOverrideValues(master,node.overrides??{});
  node.props=expectedLinkedProps(template,master,root,node);
  if(master.children){
    const previous=new Map((old?.children??[]).filter(c=>c.sourceTemplateNodeId).map(c=>[c.sourceTemplateNodeId,c]));
    node.children=master.children.map(child=>reconcileLinkedNode(template,child,previous.get(child.id),root));
  }
  else delete node.children;
  return node;
}
export function synchronizeLinkedTemplates(project,templateId){
  const template=project.templates?.find(t=>t.id===templateId);
  if(!template)throw new Error('Reusable master component not found');
  for(const page of project.pages)walkNodes(page.components,node=>{
    if(node.sourceTemplateId!==templateId)return;
    const updated=reconcileLinkedNode(template,template.node,node,node);
    // Root identity and public instance settings survive master reorder/structure updates.
    Object.assign(node,updated);
  });
}
/** Name a typed input for a master property, without duplicating its value. */
export function exposeTemplateInput(project,templateId,nodeId,prop,name){
  const template=project.templates?.find(t=>t.id===templateId),node=template&&masterNode(template,nodeId);
  if(!node||!INPUT_PROPS.has(prop)||!Object.hasOwn(node.props,prop)||!supportedValue(node.props[prop]))throw new Error('Template input target is invalid');
  if(!inputName.test(name)||!Array.isArray(template.inputs??[])||(template.inputs??[]).length>=30)throw new Error('Invalid template input name or limit');
  if(publicInput(template,name)||inputForProperty(template,nodeId,prop))throw new Error('Duplicate reusable component input');
  (template.inputs??=[]).push({name,nodeId,prop,type:typeof node.props[prop]});
  return template.inputs.at(-1);
}
export function removeTemplateInput(project,templateId,name){
  const template=project.templates?.find(t=>t.id===templateId);
  if(!template||!publicInput(template,name))throw new Error('Reusable component input not found');
  template.inputs=template.inputs.filter(i=>i.name!==name);
  for(const page of project.pages)walkNodes(page.components,node=>{if(node.sourceTemplateId===templateId){
    if(node.inputValues)delete node.inputValues[name];if(node.inputBindings)delete node.inputBindings[name];
  }});
  synchronizeLinkedTemplates(project,templateId);
}
export function setLinkedInput(project,pageId,nodeId,name,value){
  const linked=findLinkedInstance(project.pages.find(p=>p.id===pageId),nodeId);
  if(!linked)throw new Error('Select a linked component');
  const template=project.templates.find(t=>t.id===linked.templateId),input=publicInput(template,name);
  if(!input||typeof value!==input.type||!supportedValue(value))throw new Error('Typed reusable input value is invalid');
  linked.root.inputValues??={};linked.root.inputValues[name]=value;
  if(linked.root.inputBindings)delete linked.root.inputBindings[name];
  synchronizeLinkedTemplates(project,linked.templateId);
}
export function bindLinkedInput(project,pageId,nodeId,name,binding){
  const page=project.pages.find(p=>p.id===pageId),linked=page&&findLinkedInstance(page,nodeId);
  if(!linked)throw new Error('Select a linked component');
  const template=project.templates.find(t=>t.id===linked.templateId),input=publicInput(template,name);
  if(!input)throw new Error('Reusable input not found');
  validateInputBinding(project,page,input,binding);
  (linked.root.inputBindings??={})[name]=cloneProject(binding);
}
export function clearLinkedInputBinding(project,pageId,nodeId,name){
  const linked=findLinkedInstance(project.pages.find(p=>p.id===pageId),nodeId);
  if(!linked||!publicInput(project.templates.find(t=>t.id===linked.templateId),name))throw new Error('Reusable input not found');
  if(linked.root.inputBindings)delete linked.root.inputBindings[name];
}
function inputFormType(page,field){let kinds=new Set();walkNodes(page.components,node=>{
  if(node.props?.field===field&&['input','textarea','select','checkbox'].includes(node.type))kinds.add(node.type==='checkbox'?'boolean':'string');
});return kinds.size===1?[...kinds][0]:null;}
function validateInputBinding(project,page,input,binding){
  if(!plain(binding))throw new Error('Invalid reusable input binding');
  if(binding.source==='form'){
    if(typeof binding.field!=='string'||!inputName.test(binding.field)||inputFormType(page,binding.field)!==input.type||Object.keys(binding).some(k=>!['source','field'].includes(k)))throw new Error('Invalid or incompatible form binding');
  }else if(binding.source==='record'){
    const model=project.models.find(m=>m.id===binding.modelId),field=model?.fields.find(f=>f.id===binding.fieldId);
    const t=field?.type==='integer'||field?.type==='decimal'?'number':field?.type==='boolean'?'boolean':'string';
    if(!field||t!==input.type||Object.keys(binding).some(k=>!['source','modelId','fieldId'].includes(k)))throw new Error('Invalid or incompatible record binding');
  }else throw new Error('Unsupported reusable input binding source');
}
/** Named slots target layout containers; per-instance fills are display-only content. */
const SLOT_TYPES=new Set(['heading','text','card','divider','section','columns']);
function assertSlotContent(nodes,depth=0){
  if(!Array.isArray(nodes)||nodes.length>30||depth>6)throw new Error('Invalid slot content size');
  for(const node of nodes){
    if(!plain(node)||!SLOT_TYPES.has(node.type)||typeof node.id!=='string'||!node.id||!plain(node.props)||node.sourceTemplateId!==undefined||node.sourceTemplateNodeId!==undefined||node.inputBindings!==undefined)throw new Error('Invalid slot content');
    for(const [key,value] of Object.entries(node.props))if(key.length>120||!supportedValue(value))throw new Error('Invalid slot content property');
    if(CONTAINER_TYPES.includes(node.type))assertSlotContent(node.children,depth+1);
    else if(node.children!==undefined)throw new Error('Slot content leaf cannot have children');
  }
}
export function exposeTemplateSlot(project,templateId,nodeId,name){
  const template=project.templates?.find(t=>t.id===templateId),node=template&&masterNode(template,nodeId);
  if(!node||!CONTAINER_TYPES.includes(node.type))throw new Error('Slot target must be a layout container');
  if(!inputName.test(name)||(template.slots??[]).length>=15||(template.slots??[]).some(s=>s.name===name||s.nodeId===nodeId))throw new Error('Duplicate or invalid content slot');
  (template.slots??=[]).push({name,nodeId});
  return template.slots.at(-1);
}
export function fillLinkedSlot(project,pageId,nodeId,name,nodes){
  const linked=findLinkedInstance(project.pages.find(p=>p.id===pageId),nodeId);
  if(!linked)throw new Error('Select linked component for slot');
  const template=project.templates.find(t=>t.id===linked.templateId);
  if(!(template.slots??[]).some(s=>s.name===name))throw new Error('Content slot does not exist');
  assertSlotContent(nodes);
  const fill=nodes.map(duplicateNode);
  (linked.root.slotFills??={})[name]=fill;
  return fill;
}
export function appendLinkedSlotNode(project,pageId,nodeId,name,type){
  if(!SLOT_TYPES.has(type))throw new Error('Slot component type is not supported');
  const page=project.pages.find(p=>p.id===pageId),linked=page&&findLinkedInstance(page,nodeId);
  if(!linked)throw new Error('Select linked component for slot');
  const template=project.templates.find(t=>t.id===linked.templateId);
  if(!(template.slots??[]).some(s=>s.name===name))throw new Error('Content slot does not exist');
  const list=(linked.root.slotFills??={})[name]??=[];
  if(list.length>=30)throw new Error('Content slot is full');
  const node=createComponent(type);
  list.push(node);
  return node;
}
export function updateLinkedSlotNode(project,pageId,nodeId,name,childId,patch){
  const linked=findLinkedInstance(project.pages.find(p=>p.id===pageId),nodeId);
  const nodes=linked?.root.slotFills?.[name],child=nodes?.find(n=>n.id===childId);
  if(!child||!plain(patch))throw new Error('Slot content node not found');
  for(const [key,value] of Object.entries(patch))if(!Object.hasOwn(child.props,key)||typeof child.props[key]!==typeof value||!supportedValue(value)||!INPUT_PROPS.has(key))throw new Error('Invalid slot property');
  Object.assign(child.props,patch);
}
export function removeLinkedSlotNode(project,pageId,nodeId,name,childId){
  const linked=findLinkedInstance(project.pages.find(p=>p.id===pageId),nodeId);
  const nodes=linked?.root.slotFills?.[name];
  if(!nodes||!nodes.some(n=>n.id===childId))throw new Error('Slot content node not found');
  linked.root.slotFills[name]=nodes.filter(n=>n.id!==childId);
}
export function clearLinkedSlot(project,pageId,nodeId,name){
  const linked=findLinkedInstance(project.pages.find(p=>p.id===pageId),nodeId);
  if(!linked)throw new Error('Select linked component for slot');
  if(linked.root.slotFills)delete linked.root.slotFills[name];
}
/** Resolve one typed instance input without changing published metadata.
 * Kept in the model layer so the inspector and both Svelte renderers agree exactly. */
export function resolveLinkedInputBinding(project,root,input,context={}){
  const binding=root?.inputBindings?.[input?.name];
  if(!binding)return {status:'unbound',reason:'No dynamic binding is configured'};
  let value;
  if(binding.source==='form'){
    if(!Object.hasOwn(context.fields??{},binding.field))return {status:'missing',reason:`Form field ${binding.field} has no current value`};
    value=context.fields[binding.field];
  }else if(binding.source==='record'){
    const selected=context.selected?.[binding.modelId];
    if(selected===undefined||selected===null||selected==='')return {status:'missing',reason:'No record is selected'};
    const model=project.models.find(m=>m.id===binding.modelId);
    const field=model?.fields.find(f=>f.id===binding.fieldId);
    const pk=model?.fields.find(f=>f.primary)?.name;
    const rows=context.records?.[binding.modelId];
    if(!field||!pk||!Array.isArray(rows))return {status:'missing',reason:'Selected model data is unavailable'};
    const selectedKey=plain(selected)?selected[pk]:selected;
    if(selectedKey===null||selectedKey===undefined)return {status:'missing',reason:'Selected record has no primary key'};
    const match=rows.find(row=>plain(row)&&String(row[pk])===String(selectedKey));
    if(!match)return {status:'missing',reason:'Selected record is not present in the current data snapshot'};
    if(!Object.hasOwn(match,field.name))return {status:'missing',reason:`Selected record has no value for ${field.name}`};
    value=match[field.name];
  }else return {status:'invalid',reason:'Unsupported binding source'};
  if(typeof value!==input.type||!supportedValue(value))
    return {status:'type-mismatch',reason:`Expected ${input.type}, received ${value===null?'null':typeof value}`};
  return {status:'resolved',value};
}
/** Pure renderer: never persist live form/record data into published metadata. */
export function renderPageComponents(project,page,context={}){
  const result=cloneProject(page.components);
  const originalRoots=[];walkNodes(result,node=>{if(node.sourceTemplateId)originalRoots.push(node);});
  for(const root of originalRoots){
    const template=project.templates?.find(t=>t.id===root.sourceTemplateId);
    if(!template)continue;
    for(const slot of template.slots??[]){
      if(!Object.hasOwn(root.slotFills??{},slot.name))continue;
      let target;walkNodes([root],node=>{if(node.sourceTemplateNodeId===slot.nodeId)target=node;});
      if(target)target.children=cloneProject(root.slotFills[slot.name]);
    }
    for(const input of template.inputs??[]){
      const resolved=resolveLinkedInputBinding(project,root,input,context);
      if(resolved.status!=='resolved')continue;
      let node;walkNodes([root],item=>{if(item.sourceTemplateNodeId===input.nodeId)node=item;});
      if(node)node.props[input.prop]=resolved.value;
    }
  }
  return result;
}
export function editMasterProperties(project,templateId,sourceNodeId,patch){
  const template=project.templates?.find(t=>t.id===templateId);
  if(!template)throw new Error('Reusable master component not found');
  let found;walkNodes([template.node],n=>{if(n.id===sourceNodeId)found=n;});
  if(!found)throw new Error('Reusable master node not found');
  assertOverrideValues(found,patch);
  Object.assign(found.props,patch);
  synchronizeLinkedTemplates(project,templateId);
}
export function overrideLinkedProperties(project,pageId,nodeId,patch){
  const page=project.pages.find(p=>p.id===pageId);
  const linked=page&&findLinkedInstance(page,nodeId);
  if(!linked)throw new Error('Selected component is not linked');
  const template=project.templates?.find(t=>t.id===linked.templateId);
  let master;walkNodes([template.node],n=>{if(n.id===linked.node.sourceTemplateNodeId)master=n;});
  if(!master)throw new Error('Linked master node is missing');
  assertOverrideValues(master,patch);
  const local={...(linked.node.overrides??{})};
  for(const [key,value] of Object.entries(patch)){
    if(value===master.props[key])delete local[key];else local[key]=value;
  }
  if(Object.keys(local).length)linked.node.overrides=local;else delete linked.node.overrides;
  synchronizeLinkedTemplates(project,linked.templateId);
}
export function resetLinkedOverrides(project,pageId,nodeId){
  const linked=findLinkedInstance(project.pages.find(p=>p.id===pageId),nodeId);
  if(!linked)throw new Error('Selected component is not linked');
  delete linked.node.overrides;
  synchronizeLinkedTemplates(project,linked.templateId);
}
export function detachLinkedInstance(page,nodeId,project){
  const linked=findLinkedInstance(page,nodeId);
  if(!linked)throw new Error('Component is not linked');
  if(project){
    const rendered=renderPageComponents(project,page);
    let resolved;
    walkNodes(rendered,n=>{if(n.id===linked.root.id)resolved=n;});
    if(resolved)Object.assign(linked.root,resolved);
  }
  walkNodes([linked.root],n=>{
    delete n.sourceTemplateId;delete n.sourceTemplateNodeId;delete n.overrides;
    delete n.inputValues;delete n.inputBindings;delete n.slotFills;
  });
  return linked.root;
}
export function moveComponent(components,fromIndex,toIndex) {
  if(!Number.isInteger(fromIndex)||!Number.isInteger(toIndex)||fromIndex<0||fromIndex>=components.length||toIndex<0||toIndex>components.length)throw new Error('Invalid move indices');
  const copy=components.slice();const [item]=copy.splice(fromIndex,1);
  copy.splice(fromIndex<toIndex?toIndex-1:toIndex,0,item);return copy;
}
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const identifier=/^[a-z][a-z0-9_]{0,63}$/;
export function validateProject(project) {
  if(!plain(project))throw new Error('Project must be a JSON object');
  if(project.schemaVersion!==SCHEMA_VERSION)throw new Error(`Unsupported schema version: ${String(project.schemaVersion)}`);
  if(typeof project.name!=='string'||!project.name||project.name.length>120)throw new Error('Invalid project name');
  if(typeof project.id!=='string'||!project.id||project.id.length>120)throw new Error('Invalid project ID');
  if(!Array.isArray(project.pages)||!project.pages.length||project.pages.length>100)throw new Error('Project must have 1–100 pages');
  if(!Array.isArray(project.models)||project.models.length>100)throw new Error('Invalid model collection');
  const modelIds=new Set(),tables=new Set(),modelLookup=new Map();
  for(const model of project.models) {
    if(!plain(model)||typeof model.id!=='string'||!model.id||modelIds.has(model.id))throw new Error('Invalid or duplicate model ID');
    modelIds.add(model.id);modelLookup.set(model.id,model);
    if(typeof model.name!=='string'||!model.name||model.name.length>120)throw new Error('Invalid model name');
    if(typeof model.table!=='string'||!identifier.test(model.table)||tables.has(model.table))throw new Error('Invalid or duplicate SQL table name');
    tables.add(model.table);
    if(!Array.isArray(model.fields)||model.fields.length<1||model.fields.length>100)throw new Error('A model needs 1–100 fields');
    const names=new Set(),ids=new Set();let primaryCount=0;
    for(const field of model.fields) {
      if(!plain(field)||typeof field.id!=='string'||!field.id||ids.has(field.id)||typeof field.name!=='string'||!identifier.test(field.name)||names.has(field.name))throw new Error('Invalid or duplicate field');
      ids.add(field.id);names.add(field.name);
      if(!FIELD_TYPES.includes(field.type)||typeof field.required!=='boolean'||typeof field.unique!=='boolean'||typeof field.primary!=='boolean')throw new Error('Invalid field definition');
      if(typeof field.referenceModelId!=='string'||typeof field.referenceFieldId!=='string')throw new Error('Invalid relation definition');
      if(field.type==='text'&&(field.unique||field.primary))throw new Error('TEXT fields cannot be unique or primary without an index prefix');
      if(field.primary){primaryCount++;if(!field.required)throw new Error('Primary field must be required');}
    }
    if(primaryCount!==1)throw new Error('Each model requires one primary field');
  }
  for(const model of project.models)for(const field of model.fields){
    if(!field.referenceModelId&&!field.referenceFieldId)continue;
    const target=modelLookup.get(field.referenceModelId)?.fields.find(f=>f.id===field.referenceFieldId);
    if(!target||!target.primary||field.type!==target.type)throw new Error('Invalid relationship reference or incompatible types');
  }
  const pageIds=new Set(),componentIds=new Set();
  for(const page of project.pages) {
    if(!plain(page)||typeof page.id!=='string'||!page.id||pageIds.has(page.id))throw new Error('Invalid or duplicate page ID');
    pageIds.add(page.id);
    if(typeof page.name!=='string'||!page.name||page.name.length>120||typeof page.path!=='string'||!page.path.startsWith('/')||page.path.length>255)throw new Error('Invalid page settings');
    if(!Array.isArray(page.components))throw new Error('Invalid page components');
    let count=0;
    const check=(nodes,depth)=>{
      if(depth>7)throw new Error('Maximum component nesting depth exceeded');
      for(const c of nodes) {
        count++;if(count>1000)throw new Error('A page may have up to 1000 components');
        if(!plain(c)||typeof c.id!=='string'||!c.id||componentIds.has(c.id)||!COMPONENT_TYPES.includes(c.type)||!plain(c.props))throw new Error('Invalid or duplicate component');
        componentIds.add(c.id);
        for(const [key,value] of Object.entries(c.props))if(key.length>120||!['string','number','boolean'].includes(typeof value)||(typeof value==='string'&&value.length>10000))throw new Error(`Invalid property: ${key}`);
        if(CONTAINER_TYPES.includes(c.type)) {if(!Array.isArray(c.children))throw new Error('Container needs a children array');check(c.children,depth+1);}
        else if(c.children!==undefined)throw new Error('Leaf components cannot contain children');
        if(c.props.bindingModelId||c.props.bindingFieldId){
          const model=modelLookup.get(c.props.bindingModelId);
          if(!model||(['input','textarea','select','checkbox'].includes(c.type)&&!model.fields.some(f=>f.id===c.props.bindingFieldId))||(!['input','textarea','select','checkbox'].includes(c.type)&&c.props.bindingFieldId))throw new Error('Broken field binding');
        }
        if(c.props.referenceDisplayFieldId !== undefined && typeof c.props.referenceDisplayFieldId !== 'string')throw new Error('Invalid reference display field');
        if(c.props.referenceDisplayFieldId && !pickerMetadata(project,c))throw new Error('Invalid reference picker');
        if(c.props.referenceDisplayFieldId && c.type !== 'select')throw new Error('Only dropdowns can be reference pickers');
        if(c.type==='button'&&!['submit','create','update','delete','navigate','reset','message'].includes(c.props.action))throw new Error('Invalid button action');
      }
    };check(page.components,0);
  }
  // Optional in schema v3: older published project documents remain byte-for-byte compatible.
  if(project.templates!==undefined){
    if(!Array.isArray(project.templates)||project.templates.length>40)throw new Error('Invalid reusable component library');
    const templateIds=new Set();
    for(const template of project.templates){
      if(!plain(template)||typeof template.id!=='string'||!template.id||template.id.length>120||templateIds.has(template.id)||
          typeof template.name!=='string'||!template.name.trim()||template.name.length>120||!plain(template.node))throw new Error('Invalid or duplicate reusable component');
      templateIds.add(template.id);
      const ids=new Set();let count=0;
      function checkTemplateNode(node,depth){
        if(++count>100||depth>7)throw new Error('Reusable component exceeds size or nesting limit');
        if(!plain(node)||typeof node.id!=='string'||!node.id||ids.has(node.id)||!COMPONENT_TYPES.includes(node.type)||!plain(node.props))throw new Error('Invalid reusable component tree');
        ids.add(node.id);
        for(const [key,value] of Object.entries(node.props))if(key.length>120||!['string','number','boolean'].includes(typeof value)||(typeof value==='string'&&value.length>10000))throw new Error('Invalid reusable component property');
        if(CONTAINER_TYPES.includes(node.type)){
          if(!Array.isArray(node.children))throw new Error('Reusable container must have children');
          for(const child of node.children)checkTemplateNode(child,depth+1);
        }else if(node.children!==undefined)throw new Error('Reusable leaf cannot have children');
        if(node.props.bindingModelId||node.props.bindingFieldId){
          const model=modelLookup.get(node.props.bindingModelId);
          if(!model||(['input','textarea','select','checkbox'].includes(node.type)&&!model.fields.some(f=>f.id===node.props.bindingFieldId))||(!['input','textarea','select','checkbox'].includes(node.type)&&node.props.bindingFieldId))throw new Error('Broken reusable component binding');
        }
        if(node.props.referenceDisplayFieldId !== undefined && typeof node.props.referenceDisplayFieldId !== 'string')throw new Error('Invalid reusable reference display field');
        if(node.props.referenceDisplayFieldId && !pickerMetadata(project,node))throw new Error('Invalid reusable reference picker');
        if(node.type==='button'&&!['submit','create','update','delete','navigate','reset','message'].includes(node.props.action))throw new Error('Invalid reusable button action');
      }
      checkTemplateNode(template.node,0);
    }
  }
  // Validate the public template interfaces before validating linked instances.
  for(const template of project.templates??[]){
    const names=new Set(),targets=new Set();
    if(!Array.isArray(template.inputs??[])||(template.inputs??[]).length>30||!Array.isArray(template.slots??[])||(template.slots??[]).length>15)throw new Error('Invalid template interface');
    for(const input of template.inputs??[]){
      const node=plain(input)&&masterNode(template,input.nodeId),target=`${input?.nodeId}:${input?.prop}`;
      if(!node||!inputName.test(input.name)||names.has(input.name)||targets.has(target)||!INPUT_PROPS.has(input.prop)||!Object.hasOwn(node.props,input.prop)||input.type!==typeof node.props[input.prop]||!supportedValue(node.props[input.prop])||Object.keys(input).some(k=>!['name','nodeId','prop','type'].includes(k)))throw new Error('Invalid or duplicate template input');
      names.add(input.name);targets.add(target);
    }
    names.clear();targets.clear();
    for(const slot of template.slots??[]){
      const node=plain(slot)&&masterNode(template,slot.nodeId);
      if(!node||!CONTAINER_TYPES.includes(node.type)||!inputName.test(slot.name)||names.has(slot.name)||targets.has(slot.nodeId)||Object.keys(slot).some(k=>!['name','nodeId'].includes(k)))throw new Error('Invalid or duplicate template slot');
      names.add(slot.name);targets.add(slot.nodeId);
    }
  }
  const templateMap=new Map((project.templates??[]).map(t=>[t.id,t]));
  const filledIds=new Set(componentIds);
  function validateLinkedNode(node,master,root,template,page,isRoot){
    if(node.sourceTemplateNodeId!==master.id||node.type!==master.type||
       (isRoot?node.sourceTemplateId!==template.id:node.sourceTemplateId!==undefined))throw new Error('Invalid linked reusable component structure');
    const overrides=node.overrides??{};assertOverrideValues(master,overrides);
    const effective=expectedLinkedProps(template,master,root,node);
    if(Object.keys(node.props).length!==Object.keys(effective).length||
       Object.entries(effective).some(([key,value])=>node.props[key]!==value))throw new Error('Linked reusable properties differ from the master');
    if(master.children){
      if(!Array.isArray(node.children)||node.children.length!==master.children.length)throw new Error('Linked reusable component structure mismatch');
      for(let i=0;i<master.children.length;i++)validateLinkedNode(node.children[i],master.children[i],root,template,page,false);
    }else if(node.children!==undefined)throw new Error('Linked reusable leaf cannot have children');
  }
  function checkRoots(nodes,page){
    for(const node of nodes){
      if(node.sourceTemplateId!==undefined){
        const template=templateMap.get(node.sourceTemplateId);
        if(!template)throw new Error('Missing reusable component master');
        if(!plain(node.inputValues??{})||!plain(node.inputBindings??{})||!plain(node.slotFills??{}))throw new Error('Invalid reusable instance settings');
        for(const [name,value] of Object.entries(node.inputValues??{})){
          const input=publicInput(template,name);
          if(!input||typeof value!==input.type||!supportedValue(value))throw new Error('Invalid typed component input');
        }
        for(const [name,binding] of Object.entries(node.inputBindings??{})){
          const input=publicInput(template,name);if(!input)throw new Error('Unknown reusable input binding');
          validateInputBinding(project,page,input,binding);
        }
        for(const [name,fill] of Object.entries(node.slotFills??{})){
          if(!(template.slots??[]).some(slot=>slot.name===name))throw new Error('Unknown content slot');
          assertSlotContent(fill);
          walkNodes(fill,item=>{if(filledIds.has(item.id))throw new Error('Duplicate slot content component ID');filledIds.add(item.id);});
        }
        validateLinkedNode(node,template.node,node,template,page,true);
      }else if(node.sourceTemplateNodeId!==undefined||node.overrides!==undefined||node.inputValues!==undefined||node.inputBindings!==undefined||node.slotFills!==undefined)throw new Error('Orphaned linked reusable component metadata');
      else if(node.children)checkRoots(node.children,page);
    }
  }
  for(const page of project.pages)checkRoots(page.components,page);
  validateWorkflows(project,walkNodes);
  return project;
}
