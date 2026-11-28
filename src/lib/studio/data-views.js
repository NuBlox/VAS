/** Versioned, metadata-defined record views. Neither expressions nor SQL are accepted. */
import { normaliseValue } from './records.js';

const allowedOps={
  string:new Set(['eq','contains']),text:new Set(['eq','contains']),
  integer:new Set(['eq','gte','lte']),decimal:new Set(['eq','gte','lte']),
  boolean:new Set(['eq']),date:new Set(['eq','gte','lte']),datetime:new Set(['eq','gte','lte'])
};
const validIdentifier=/^[a-z][a-z0-9_]{0,63}$/;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(obj,allowed)=>Object.keys(obj).every(k=>allowed.includes(k));
function assertion(condition,message){if(!condition)throw new Error(message);}
export function operatorsForField(type){ return [...(allowedOps[type]??[])]; }
export function defaultLiteral(field){
  if(!field)throw Error('Missing data-view field');
  if(field.type==='boolean')return false;
  if(['integer','decimal'].includes(field.type))return 0;
  if(field.type==='date')return '2026-01-01';
  if(field.type==='datetime')return '2026-01-01T00:00:00';
  return 'value';
}
export function viewField(model,name){return model?.fields.find(f=>f.name===name);}
export function createDataView(model,{id=`view_${Math.random().toString(36).slice(2,10)}`,name=`${model.name} view`,parentField=''}={}){
  const columns=model.fields.filter(f=>f.type!=='text').slice(0,6).map(f=>f.name);
  const pk=model.fields.find(f=>f.primary);
  const search=model.fields.find(f=>['string','text'].includes(f.type) && !f.primary);
  return {id,name,version:1,revision:1,modelId:model.id,columns,pageSize:20,
    sort:{field:search?.name??pk.name,direction:'asc'},filters:[
      ...(search?[{field:search.name,operator:'contains',source:'search'}]:[]),
      ...(parentField?[{field:parentField,operator:'eq',source:'parent'}]:[])
    ]};
}
export function validateDataViews(project){
  const views=project.dataViews??[];
  assertion(Array.isArray(views)&&views.length<=100,'Invalid data-view collection');
  const byId=new Map(),models=new Map((project.models??[]).map(m=>[m.id,m]));
  for(const view of views){
    assertion(plain(view)&&keys(view,['id','name','version','revision','modelId','columns','pageSize','sort','filters'])&&
      typeof view.id==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(view.id)&&!byId.has(view.id)&&
      typeof view.name==='string'&&view.name.trim()&&view.name.length<=120&&view.version===1&&
      Number.isInteger(view.revision)&&view.revision>=1&&view.revision<=10000,'Invalid data-view identity');
    const model=models.get(view.modelId);
    assertion(model,'Data view refers to an unpublished model');
    assertion(Array.isArray(view.columns)&&view.columns.length>=1&&view.columns.length<=12&&
      new Set(view.columns).size===view.columns.length&&view.columns.every(c=>typeof c==='string'&&viewField(model,c)),
      'Invalid data-view columns');
    assertion(Number.isInteger(view.pageSize)&&view.pageSize>=1&&view.pageSize<=25,'Data-view page size must be 1–25');
    assertion(plain(view.sort)&&keys(view.sort,['field','direction'])&&viewField(model,view.sort.field)&&
      ['asc','desc'].includes(view.sort.direction),'Invalid data-view sort');
    assertion(Array.isArray(view.filters)&&view.filters.length<=5,'Too many data-view filters');
    let searchCount=0,parentCount=0;
    for(const f of view.filters){
      const field=viewField(model,f?.field);
      assertion(plain(f)&&keys(f,['field','operator','source','value','binding'])&&field&&allowedOps[field.type]?.has(f.operator)&&
        ['literal','search','parent','form','selected'].includes(f.source),'Invalid data-view filter');
      if(['form','selected'].includes(f.source)){
        assertion(typeof f.binding==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/.test(f.binding),
          'Invalid data-view binding');
      } else assertion(!Object.hasOwn(f,'binding'),'Only dynamic field bindings may declare a binding');
      if(f.source==='literal'){
        assertion(Object.hasOwn(f,'value')&&f.value!==null&&f.value!==''&&
          ['string','number','boolean'].includes(typeof f.value),'Data-view literal must be a typed value');
        if(field.type==='boolean')assertion(typeof f.value==='boolean','Boolean view literal required');
        if(['string','text','date','datetime'].includes(field.type))assertion(typeof f.value==='string','Text view literal required');
        if(field.type==='integer')assertion((typeof f.value==='string'||Number.isSafeInteger(f.value))&&/^(0|[1-9]\d*)$/.test(String(f.value)),'Integer view literal required');
        if(field.type==='decimal')assertion((typeof f.value==='string'||typeof f.value==='number')&&/^-?\d{1,14}(?:\.\d{1,4})?$/.test(String(f.value)),'Decimal view literal required');
        assertion(String(f.value).length<=255,'Literal filter value is too long');
        try{assertion(normaliseValue(field,f.value)!==null,'Empty predicate');}
        catch{throw new Error('Invalid typed data-view filter literal');}
      } else {
        assertion(!Object.hasOwn(f,'value'),'Dynamic filters cannot contain literal values');
      }
      if(f.source==='search'){
        searchCount++;
        assertion(f.operator==='contains'&&['string','text'].includes(field.type),'Search must use a text field');
      }
      if(f.source==='parent'){
        parentCount++;
        assertion(f.operator==='eq'&&field.referenceModelId&&field.referenceFieldId,'Parent filter must use a foreign key');
      }
    }
    assertion(searchCount<=1&&parentCount<=1,'Only one search and parent filter may be defined');
    byId.set(view.id,view);
  }
  for(const page of project.pages??[]){
    const walk=nodes=>{for(const node of nodes){
      if(node.props?.dataViewId){
        const view=byId.get(node.props.dataViewId);
        assertion(node.type==='table'&&view&&node.props.bindingModelId===view.modelId,'Invalid table data-view binding');
        const columns=String(node.props.columns??'').split(',').map(s=>s.trim()).filter(Boolean);
        assertion(columns.length>=1&&columns.every(c=>view.columns.includes(c)),'Table columns must be exposed by the data view');
        for(const filter of view.filters){
          if(filter.source==='form'){
            const found=[];
            const scan=nodes=>{for(const n of nodes){if(['input','textarea','select','checkbox'].includes(n.type)&&n.props?.field===filter.binding)found.push(n);if(n.children)scan(n.children);}};
            scan(page.components);
            assertion(found.length===1,'Data-view form binding must refer to one field on the current page');
            const bound=found[0],model=models.get(bound.props.bindingModelId),typed=model?.fields.find(f=>f.id===bound.props.bindingFieldId);
            const expected=viewField(models.get(view.modelId),filter.field);
            if(typed)assertion(typed.type===expected.type,'Data-view form binding type does not match its filter field');
            if(bound.type==='checkbox')assertion(expected.type==='boolean','Checkbox data-view binding must use boolean field');
          }
          if(filter.source==='selected'){
            const selectedModel=models.get(filter.binding),selectedPrimary=selectedModel?.fields.find(f=>f.primary);
            const expected=viewField(models.get(view.modelId),filter.field);
            assertion(selectedPrimary&&selectedPrimary.type===expected.type,'Selected-record binding must match a published primary key type');
          }
        }
        const parentFilter=view.filters.find(f=>f.source==='parent');
        if(parentFilter){
          const model=models.get(view.modelId),field=viewField(model,parentFilter.field);
          const parent=models.get(field.referenceModelId),pk=parent?.fields.find(f=>f.primary);
          assertion(node.props.relationParentModelId===field.referenceModelId&&node.props.relationFieldId===field.id&&
            pk?.id===field.referenceFieldId,'Parent data-view filter does not match the table relationship');
        }else assertion(!node.props.relationParentModelId,'Related tables require a parent-scoped data view');
      }
      if(Array.isArray(node.children))walk(node.children);
    }};
    walk(page.components??[]);
  }
  return byId;
}
export function viewForComponent(project,pageId,componentId){
  const page=project.pages.find(p=>p.id===pageId);
  let node;
  const walk=nodes=>{for(const item of nodes){if(item.id===componentId)node=item; if(item.children)walk(item.children);}};
  if(page)walk(page.components);
  if(!node||node.type!=='table'||!node.props.dataViewId)throw Error('Data-view table not published');
  const view=validateDataViews(project).get(node.props.dataViewId);
  if(!view)throw Error('Data view not published');
  const model=project.models.find(m=>m.id===view.modelId);
  const parentFilter=view.filters.find(f=>f.source==='parent');
  const foreign=parentFilter?viewField(model,parentFilter.field):null;
  const parent=foreign?project.models.find(m=>m.id===foreign.referenceModelId):null;
  return {view,model,parent,foreign,node};
}
/** Resolve only approved, indexed, typed dynamic bindings. The view controls the keys. */
export function assertViewBindings(view,bindings={}){
  assertion(plain(bindings),'Invalid data-view bindings');
  const expected=view.filters.flatMap((f,i)=>['form','selected'].includes(f.source)?[String(i)]:[]);
  assertion(Object.keys(bindings).length===expected.length&&Object.keys(bindings).every(key=>expected.includes(key)),
    'Missing or unapproved data-view binding');
  for(const key of expected)assertion(Object.hasOwn(bindings,key)&&bindings[key]!==null&&bindings[key]!==undefined&&bindings[key]!==''&&
    ['string','number','boolean'].includes(typeof bindings[key]),'Missing or invalid data-view binding');
  return bindings;
}
export function describeDataView(view,bindings={}){
  return view.filters.map((f,i)=>({field:f.field,operator:f.operator,source:f.source,
    binding:f.binding??null,value:f.source==='literal'?f.value:f.source==='form'||f.source==='selected'?bindings[i]??null:null,
    resolved:f.source==='literal'||['form','selected'].includes(f.source)&&bindings[i]!==undefined}));
}
/** Read-only deterministic preview: absent typed bindings fail closed. */
export function inspectDataView(view,records,{query='',parentId='',page=0,bindings={}}={}){
  if(view.filters.some(f=>f.source==='parent')&&(parentId===null||parentId===undefined||parentId===''))return {records:[],page,pageSize:view.pageSize,hasMore:false,total:0};
  try{assertViewBindings(view,bindings);}catch{return {records:[],page,pageSize:view.pageSize,hasMore:false,total:0};}
  const tests=view.filters.map((f,i)=>({f,i})).filter(({f})=>f.source!=='search'||query);
  const clean=records.filter(record=>tests.every(({f,i})=>{
    const value=f.source==='literal'?f.value:f.source==='search'?query:f.source==='parent'?parentId:bindings[i];
    const recordValue=record[f.field];
    if(f.operator==='contains')return String(recordValue??'').toLowerCase().includes(String(value).toLowerCase());
    if(f.operator==='eq')return String(recordValue??'')===String(value);
    const a=Number(recordValue),b=Number(value);
    if(!Number.isFinite(a)||!Number.isFinite(b))return f.operator==='gte'?String(recordValue)>=String(value):String(recordValue)<=String(value);
    return f.operator==='gte'?a>=b:a<=b;
  }));
  const field=view.sort.field,direction=view.sort.direction==='desc'?-1:1;
  clean.sort((a,b)=>{
    const left=a[field],right=b[field];
    const numerical=left!==null&&right!==null&&left!==''&&right!==''&&Number.isFinite(Number(left))&&Number.isFinite(Number(right));
    const compare=numerical?Math.sign(Number(left)-Number(right)):String(left??'').localeCompare(String(right??''));
    return compare*direction||String(a.id??'').localeCompare(String(b.id??''));
  });
  const start=page*view.pageSize;
  return {records:clean.slice(start,start+view.pageSize),page,pageSize:view.pageSize,hasMore:start+view.pageSize<clean.length,total:clean.length};
}
