/** Declarative workflow graphs: no arbitrary scripting, expression evaluation or SQL. */
export const STEP_TYPES = [
  {type:'condition',label:'Condition',hint:'Branch on a form field or selected record'},
  {type:'create',label:'Create record',hint:'Save a new model record'},
  {type:'update',label:'Update record',hint:'Update a selected model record'},
  {type:'delete',label:'Delete record',hint:'Delete a selected model record'},
  {type:'navigate',label:'Navigate',hint:'Open another application page'},
  {type:'message',label:'Message',hint:'Show a message to the user'},
  {type:'reset',label:'Reset form',hint:'Clear form fields and selection'},
  {type:'set_field',label:'Set field',hint:'Assign a literal value to a form control'},
  {type:'stop',label:'Stop',hint:'End this workflow'}
];
export const OPERATORS = [
  {value:'filled',label:'Is filled'},
  {value:'empty',label:'Is empty'},
  {value:'equals',label:'Equals'},
  {value:'not_equals',label:'Does not equal'},
  {value:'greater_than',label:'Greater than (number)'},
  {value:'less_than',label:'Less than (number)'},
  {value:'selected',label:'Record is selected'}
];
const types=new Set(STEP_TYPES.map(x=>x.type));
const operators=new Set(OPERATORS.map(x=>x.value));
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uniqueId=prefix=>`${prefix}_${typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`}`;
export function createStep(type='message',id=uniqueId('step'),options={}) {
  if(!types.has(type))throw new Error(`Unsupported workflow step: ${type}`);
  const data={
    condition:{field:'',operator:'filled',value:'',modelId:'',trueId:'',falseId:''},
    create:{modelId:'',nextId:''},update:{modelId:'',nextId:''},delete:{modelId:'',nextId:''},
    navigate:{pageId:'',nextId:''},message:{text:'Workflow message',nextId:''},
    reset:{nextId:''},set_field:{field:'',value:'',nextId:''},stop:{}
  };
  return {id,type,...data[type],...options};
}
export function createWorkflow(pageId,componentId,name='New workflow',id=uniqueId('workflow')) {
  const step=createStep('message');
  return {id,name,trigger:{pageId,componentId,event:'click'},startStepId:step.id,steps:[step]};
}
export function workflowForButton(project,pageId,componentId) {
  return (project.workflows??[]).find(w=>w.trigger.pageId===pageId&&w.trigger.componentId===componentId);
}
export function stepTargets(step) {return step.type==='condition'?[step.trueId,step.falseId].filter(Boolean):step.type==='stop'?[]:step.nextId?[step.nextId]:[];}
/** Strict graph integrity and references. Each step is reachable and workflows are acyclic. */
export function validateWorkflows(project,walkNodes) {
  if(!Array.isArray(project.workflows)||project.workflows.length>100)throw new Error('Invalid workflow collection (maximum 100)');
  const workflowIds=new Set(),triggers=new Set();
  const pages=new Map(project.pages.map(p=>[p.id,p]));
  const models=new Set(project.models.map(m=>m.id));
  for(const flow of project.workflows){
    if(!plain(flow)||typeof flow.id!=='string'||!flow.id||flow.id.length>120||workflowIds.has(flow.id))throw new Error('Invalid or duplicate workflow ID');
    workflowIds.add(flow.id);
    if(typeof flow.name!=='string'||!flow.name.trim()||flow.name.length>120)throw new Error('Invalid workflow name');
    if(!plain(flow.trigger)||flow.trigger.event!=='click'||typeof flow.trigger.pageId!=='string'||typeof flow.trigger.componentId!=='string')throw new Error('Workflow needs a button click trigger');
    const sourcePage=pages.get(flow.trigger.pageId);
    if(!sourcePage)throw new Error('Workflow trigger page does not exist');
    const buttonIds=new Set(),fields=new Set();
    walkNodes(sourcePage.components,node=>{if(node.type==='button')buttonIds.add(node.id);if(['input','textarea','checkbox','select'].includes(node.type))fields.add(node.props.field);});
    if(!buttonIds.has(flow.trigger.componentId))throw new Error('Workflow trigger button is missing');
    const key=`${flow.trigger.pageId}/${flow.trigger.componentId}`;
    if(triggers.has(key))throw new Error('Only one workflow may be assigned to a button');
    triggers.add(key);
    if(!Array.isArray(flow.steps)||flow.steps.length<1||flow.steps.length>80)throw new Error('A workflow requires 1–80 steps');
    if(typeof flow.startStepId!=='string'||!flow.startStepId)throw new Error('Workflow requires a starting step');
    const byId=new Map();
    const keys={condition:['id','type','field','operator','value','modelId','trueId','falseId'],create:['id','type','modelId','nextId'],update:['id','type','modelId','nextId'],delete:['id','type','modelId','nextId'],navigate:['id','type','pageId','nextId'],message:['id','type','text','nextId'],reset:['id','type','nextId'],set_field:['id','type','field','value','nextId'],stop:['id','type']};
    for(const step of flow.steps) {
      if(!plain(step)||typeof step.id!=='string'||!step.id||step.id.length>120||byId.has(step.id)||!types.has(step.type))throw new Error('Invalid or duplicate workflow step');
      if(Object.keys(step).some(k=>!keys[step.type].includes(k))||keys[step.type].some(k=>!Object.hasOwn(step,k)))throw new Error('Invalid workflow step properties');
      for(const [k,v] of Object.entries(step))if(typeof v!=='string'||v.length>(k==='text'?1000:200))throw new Error(`Invalid workflow property ${k}`);
      if(['create','update','delete'].includes(step.type)&&!models.has(step.modelId))throw new Error('Workflow data step needs a valid model');
      if(step.type==='navigate'&&!pages.has(step.pageId))throw new Error('Workflow navigation page is missing');
      if(step.type==='message'&&!step.text.trim())throw new Error('Workflow message cannot be empty');
      if(step.type==='set_field'&&!fields.has(step.field))throw new Error('Workflow set-field target is not a form control');
      if(step.type==='condition') {
        if(!operators.has(step.operator))throw new Error('Invalid workflow condition operator');
        if(step.operator==='selected'){if(!models.has(step.modelId))throw new Error('Record selection condition needs a model');}
        else if(!fields.has(step.field))throw new Error('Workflow condition must reference a form field');
      }
      byId.set(step.id,step);
    }
    if(!byId.has(flow.startStepId))throw new Error('Workflow starting step is missing');
    for(const step of flow.steps)for(const id of stepTargets(step))if(!byId.has(id))throw new Error('Workflow connection targets a missing step');
    const visiting=new Set(),visited=new Set();
    function visit(id){
      if(visiting.has(id))throw new Error('Workflow cycles are not supported');
      if(visited.has(id))return;
      visiting.add(id);
      for(const target of stepTargets(byId.get(id)))visit(target);
      visiting.delete(id);visited.add(id);
    }
    visit(flow.startStepId);
    if(visited.size!==flow.steps.length)throw new Error('Workflow contains unreachable steps');
  }
}
/** Insert a new step on a chosen exit, keeping any previous downstream branch. */
export function insertWorkflowStep(flow,step,afterId='',outcome='next') {
  if(flow.steps.some(s=>s.id===step.id))throw new Error('Workflow step ID already exists');
  if(!afterId)throw new Error('Select an existing workflow step first');
  const parent=flow.steps.find(s=>s.id===afterId);
  if(!parent||parent.type==='stop')throw new Error('Cannot add after the selected step');
  const edge=parent.type==='condition'?(outcome==='false'?'falseId':'trueId'):'nextId';
  const previous=parent[edge];
  if(step.type==='condition')step.trueId=previous;
  else if(step.type!=='stop')step.nextId=previous;
  parent[edge]=step.id;flow.steps.push(step);
}
/** Delete a step and reconnect incoming edges to the single outgoing edge, if possible. */
export function removeWorkflowStep(flow,id) {
  if(flow.steps.length===1)throw new Error('A workflow must contain at least one step');
  const target=flow.steps.find(s=>s.id===id);
  if(!target)throw new Error('Workflow step is missing');
  const outgoing=[...new Set(stepTargets(target))];
  if(outgoing.length>1)throw new Error('Reconnect the condition branches before deleting this step');
  const next=outgoing[0]??'';
  if(flow.startStepId===id)flow.startStepId=next;
  for(const step of flow.steps){
    for(const key of step.type==='condition'?['trueId','falseId']:step.type==='stop'?[]:['nextId'])if(step[key]===id)step[key]=next;
  }
  flow.steps=flow.steps.filter(s=>s.id!==id);
}
export function conditionResult(step,context){
  if(step.operator==='selected')return Boolean(context.selectedRecords?.[step.modelId]);
  const raw=context.fields?.[step.field],text=String(raw??'');
  if(step.operator==='filled')return raw!==null&&raw!==undefined&&text.trim()!==''&&raw!==false;
  if(step.operator==='empty')return raw===null||raw===undefined||text.trim()===''||raw===false;
  if(step.operator==='equals')return text===step.value;
  if(step.operator==='not_equals')return text!==step.value;
  const left=Number(raw),right=Number(step.value);
  if(text.trim()===''||step.value.trim()===''||!Number.isFinite(left)||!Number.isFinite(right))return false;
  return step.operator==='greater_than'?left>right:left<right;
}
/** Runs an already validated graph via explicit, caller-supplied capabilities. */
export async function executeWorkflow(flow,context,handlers,{maxSteps=80}={}) {
  if(!Number.isInteger(maxSteps)||maxSteps<1||maxSteps>100)throw new Error('Invalid workflow step limit');
  const nodes=new Map(flow.steps.map(s=>[s.id,s]));
  const seen=new Set(),trace=[];let current=flow.startStepId;
  while(current){
    if(trace.length>=maxSteps)throw new Error('Workflow execution limit reached');
    if(seen.has(current))throw new Error('Workflow cycle detected');
    seen.add(current);
    const step=nodes.get(current);if(!step)throw new Error('Workflow references a missing step');
    trace.push({stepId:step.id,type:step.type});
    if(step.type==='condition'){current=conditionResult(step,context)?step.trueId:step.falseId;continue;}
    if(['create','update','delete'].includes(step.type))await handlers.data(step.type,step.modelId);
    else if(step.type==='navigate')await handlers.navigate(step.pageId);
    else if(step.type==='message')await handlers.message(step.text);
    else if(step.type==='reset'){await handlers.reset();context.fields={};context.selectedRecords={};}
    else if(step.type==='set_field'){await handlers.setField(step.field,step.value);context.fields={...context.fields,[step.field]:step.value};}
    else if(step.type==='stop')break;
    else throw new Error('Unsupported workflow step');
    current=step.nextId;
  }
  return trace;
}
/** Layout for the browser's node-and-connector diagram (longest-path DAG ranks). */
export function workflowDiagram(flow) {
  if(!flow)return {nodes:[],edges:[],width:400,height:180};
  const byId=new Map(flow.steps.map(s=>[s.id,s])),depth=new Map([[flow.startStepId,0]]);
  // Validated project graphs are acyclic; this handles malformed edit previews defensively.
  for(let pass=0;pass<flow.steps.length;pass++){
    let changed=false;
    for(const step of flow.steps){if(!depth.has(step.id))continue;for(const child of stepTargets(step)){
      const d=depth.get(step.id)+1;if(d>(depth.get(child)??-1)){depth.set(child,d);changed=true;}
    }}
    if(!changed)break;
  }
  const buckets=new Map();for(const step of flow.steps){const d=depth.get(step.id)??0;if(!buckets.has(d))buckets.set(d,[]);buckets.get(d).push(step);}
  const nodes=[];for(const [d,steps] of [...buckets].sort((a,b)=>a[0]-b[0]))for(let row=0;row<steps.length;row++)nodes.push({...steps[row],x:28+d*262,y:30+row*160,rank:d});
  const pos=new Map(nodes.map(s=>[s.id,s])),edges=[];
  for(const step of nodes){for(const [key,id] of step.type==='condition'?[['true',step.trueId],['false',step.falseId]]:step.type==='stop'?[]:[['next',step.nextId]]){
    if(!id||!pos.has(id))continue;
    const to=pos.get(id),x1=step.x+212,y1=step.y+49,x2=to.x,y2=to.y+49,curve=Math.max(40,(x2-x1)/2);
    edges.push({from:step.id,to:id,kind:key,path:`M ${x1} ${y1} C ${x1+curve} ${y1}, ${x2-curve} ${y2}, ${x2} ${y2}`});
  }}
  return {nodes,edges,width:Math.max(470,...nodes.map(n=>n.x+246)),height:Math.max(200,...nodes.map(n=>n.y+135))};
}
