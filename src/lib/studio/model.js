/** Safe, portable, metadata-first project definitions. Older projects migrate without data loss. */
import { createStep, validateWorkflows } from './workflow.js';
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
    select:{label:'Choose an option',field:'choice',options:'First option\nSecond option\nThird option',required:false,bindingModelId:'',bindingFieldId:''},
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
  return {schemaVersion:SCHEMA_VERSION,id:'app_starter',name:'Customer Workspace',models:[customer,order],workflows:[flow],pages:[
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
  walkNodes([copy],n=>{n.id=createId('component');});
  return copy;
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
        if(c.type==='button'&&!['submit','create','update','delete','navigate','reset','message'].includes(c.props.action))throw new Error('Invalid button action');
      }
    };check(page.components,0);
  }
  validateWorkflows(project,walkNodes);
  return project;
}
