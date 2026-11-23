// Browser-only interactive workflow sandbox. Uses the same model and engine as SvelteKit.
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const E=escape;
const KEY='visual-application-studio-v04-workflow-demo';
let project=createProject(),flowId=project.workflows[0].id,stepId=project.workflows[0].startStepId;
let formValues={name:'Ada Lovelace',email:'ada@example.com'},records=[],trace=[],notice='',noticeError=false,insertType='message',branch='true';
try{const saved=localStorage.getItem(KEY);if(saved){project=validateProject(migrateProject(JSON.parse(saved)));flowId=project.workflows[0]?.id||'';stepId=project.workflows[0]?.startStepId||'';}}catch(err){notice=err.message;}
const activeFlow=()=>project.workflows.find(w=>w.id===flowId);
const activeStep=()=>activeFlow()?.steps.find(s=>s.id===stepId);
const sourcePage=()=>project.pages.find(p=>p.id===activeFlow()?.trigger.pageId);
function availableFields(){const fields=[];if(sourcePage())walkNodes(sourcePage().components,c=>{if(['input','textarea','select','checkbox'].includes(c.type)&&c.props.field&&!fields.includes(c.props.field))fields.push(c.props.field);});return fields;}
function mutation(fn){try{const copy=cloneProject(project);fn(copy);validateProject(copy);project=copy;try{localStorage.setItem(KEY,JSON.stringify(copy));}catch{}notice='Saved';noticeError=false;return true;}catch(e){notice=e.message;noticeError=true;return false;}finally{queueMicrotask(render);}}
function addStep(type){const flow=activeFlow(),after=activeStep();if(!flow||!after)return;
  const values={};
  if(['condition','set_field'].includes(type)){if(!availableFields().length){notice='Add a form field to the trigger page first';noticeError=true;render();return;}values.field=availableFields()[0];}
  if(['create','update','delete'].includes(type)){if(!project.models.length){notice='Add a data model first';noticeError=true;render();return;}values.modelId=project.models[0].id;}
  if(type==='navigate')values.pageId=project.pages[0].id;
  const created=createStep(type,undefined,values);
  if(mutation(p=>insertWorkflowStep(p.workflows.find(w=>w.id===flowId),created,stepId,branch)))stepId=created.id;
  render();
}
function summary(step){
  if(step.type==='condition')return step.operator==='selected'?`Selected record in ${project.models.find(m=>m.id===step.modelId)?.name||'model'}`:`${step.field} ${OPERATORS.find(o=>o.value===step.operator)?.label.toLowerCase()||''}${['equals','not_equals','greater_than','less_than'].includes(step.operator)?' '+step.value:''}`;
  if(['create','update','delete'].includes(step.type))return project.models.find(m=>m.id===step.modelId)?.name||'Data model';
  if(step.type==='navigate')return project.pages.find(p=>p.id===step.pageId)?.name||'Page';
  if(step.type==='message')return step.text;
  if(step.type==='set_field')return `${step.field}: ${step.value}`;
  return step.type==='reset'?'Clear form':'End workflow';
}
function options(items,selected){return items.map(([id,text])=>`<option value="${E(id)}" ${selected===id?'selected':''}>${E(text)}</option>`).join('');}
function property(key,label,value,items){return `<label class="prop">${label}${items?`<select data-prop="${key}">${options(items,value)}</select>`:`<input data-prop="${key}" value="${E(value)}" />`}</label>`;}
function inspector(){const f=activeFlow(),s=activeStep();if(!f||!s)return '<p>Select a workflow and a node.</p>';
  const labels=STEP_TYPES.map(x=>[x.type,x.label]);
  let html=`<h3>Workflow</h3>${property('flowName','Name',f.name)}<p class="muted-small">Click trigger: <strong>${E(project.pages.find(pg=>pg.id===f.trigger.pageId)?.name||'Page')}</strong></p><hr><h3>Selected step</h3><p class="node-kind">${E(STEP_TYPES.find(x=>x.type===s.type)?.label||s.type)}</p>`;
  if(s.type==='condition'){
    html+=property('operator','Condition',s.operator,OPERATORS.map(x=>[x.value,x.label]));
    if(s.operator==='selected')html+=property('modelId','Entity',s.modelId,project.models.map(m=>[m.id,m.name]));
    else html+=property('field','Form field',s.field,availableFields().map(x=>[x,x]));
    if(['equals','not_equals','greater_than','less_than'].includes(s.operator))html+=property('value','Compare against',s.value);
  }else if(['create','update','delete'].includes(s.type))html+=property('modelId','Entity',s.modelId,project.models.map(m=>[m.id,m.name]));
  else if(s.type==='navigate')html+=property('pageId','Destination',s.pageId,project.pages.map(pg=>[pg.id,pg.name]));
  else if(s.type==='message')html+=property('text','Message',s.text);
  else if(s.type==='set_field')html+=property('field','Field',s.field,availableFields().map(x=>[x,x]))+property('value','Literal value',s.value);
  const steps=f.steps.filter(x=>x.id!==s.id).map(x=>[x.id,`${STEP_TYPES.find(t=>t.type===x.type)?.label||x.type} / ${x.id.slice(-5)}`]);
  if(s.type==='condition')html+=property('trueId','When TRUE',s.trueId,[['','End workflow'],...steps])+property('falseId','When FALSE',s.falseId,[['','End workflow'],...steps]);
  else if(s.type!=='stop')html+=property('nextId','Next step',s.nextId,[['','End workflow'],...steps]);
  html+=`<button class="danger" data-delete ${f.steps.length<=1?'disabled':''}>Delete selected step</button><p class="hint">Cycles, orphaned steps and invalid references are rejected.</p>`;
  return html;
}
function render(){const f=activeFlow(),layout=workflowDiagram(f),s=activeStep();
 const svg=layout.edges.map(x=>`<path d="${E(x.path)}" class="${x.kind}" />`).join('');
 const nodes=layout.nodes.map(x=>`<button class="graph-node ${x.id===stepId?'selected':''} ${x.type==='condition'?'conditional':''}" style="left:${x.x}px;top:${x.y}px" data-step="${E(x.id)}"><span class="eyebrow">${x.id===f.startStepId?'● Start · ':''}${E(STEP_TYPES.find(y=>y.type===x.type)?.label)}</span><strong>${E(summary(x))}</strong><small>${x.type==='condition'?`TRUE → ${x.trueId?'step':'end'} · FALSE → ${x.falseId?'step':'end'}`:x.type==='stop'?'End':x.nextId?'→ Next':'→ End'}</small></button>`).join('');
 const inputs=availableFields().map(field=>`<label>${E(field)}<input data-field="${E(field)}" value="${E(formValues[field]??'')}" /></label>`).join('');
 const model=project.models[0];const cols=model?.fields.filter(x=>!x.primary).map(x=>x.name)||[];
 document.getElementById('app').innerHTML=`<div class="app"><header class="header"><div class="brand"><span class="logo">◧</span><div><strong>Visual Application Studio</strong><small>Alpha 0.4 · workflow designer · offline demo</small></div></div><div class="header-actions"><button data-download>Export JSON</button><button data-reset>Reset demo</button></div></header><div class="layout"><aside class="left"><div class="section-label">PROJECT</div><strong class="project-name">${E(project.name)}</strong><div class="section-label">WORKFLOWS</div>${project.workflows.map(x=>`<button data-flow="${E(x.id)}" class="flow-link ${flowId===x.id?'active':''}">◇ ${E(x.name)}<small>${x.steps.length} steps</small></button>`).join('')}<p class="helper">Click event → condition → data operation → message.</p><h3>Add action</h3><p class="helper">Select a node in the graph, then add a step immediately after it.</p><select id="step-type">${options(STEP_TYPES.map(x=>[x.type,x.label]),insertType)}</select>${s?.type==='condition'?`<select id="insert-branch">${options([['true','TRUE exit'],['false','FALSE exit']],branch)}</select>`:''}<button class="primary" data-add>+ Add connected step</button></aside><main class="main"><div class="intro"><div><span class="eyebrow">WORKFLOW CANVAS</span><h1>${E(f?.name||'No workflow')}</h1><p>Every card is an executable step. Green and red connectors indicate the two branches of a condition.</p></div><span class="chip">${f?.steps.length||0} nodes</span></div><div class="graph-outer"><div class="graph-inner" style="width:${layout.width}px;height:${layout.height}px"><svg width="${layout.width}" height="${layout.height}" aria-hidden="true">${svg}</svg>${nodes}</div></div><div class="preview"><div class="preview-title"><div><span class="eyebrow">INTERACTIVE TEST</span><h2>Run the workflow</h2><p>Memory-only simulation using the same validated workflow engine.</p></div><button class="primary run" data-run>▶ Run workflow</button></div><div class="form-row">${inputs}</div>${notice?`<div class="notice ${noticeError?'error':''}" role="status">${E(notice)}</div>`:''}${trace.length?`<p class="trace">Executed: ${trace.map(t=>E(t.type)).join(' → ')}</p>`:''}<h3>In-memory records</h3><div class="table"><table><thead><tr>${cols.map(c=>`<th>${E(c)}</th>`).join('')}</tr></thead><tbody>${records.length?records.map(r=>`<tr>${cols.map(c=>`<td>${E(r[c]??'')}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}">No records yet</td></tr>`}</tbody></table></div></div></main><aside class="right">${inspector()}</aside></div></div>`;
}
async function run(){trace=[];notice='';noticeError=false;const flow=activeFlow(),pg=sourcePage();
  try{
    trace=await executeWorkflow(flow,{fields:{...formValues},selectedRecords:{}},{
      data:async(op,modelId)=>{
        if(op!=='create')throw new Error('Update and Delete need the local MySQL runtime. This demo is memory-only.');
        const model=project.models.find(m=>m.id===modelId);const payload={};
        walkNodes(pg.components,c=>{if(['input','textarea','select','checkbox'].includes(c.type)&&c.props.bindingModelId===modelId){const f=model.fields.find(x=>x.id===c.props.bindingFieldId);if(f&&!f.primary&&Object.hasOwn(formValues,c.props.field))payload[f.name]=formValues[c.props.field];}});
        records.push(validateRecord(model,payload,'create'));
      },
      message:async text=>{notice=text;},
      navigate:async id=>{notice=`Navigated to ${project.pages.find(p=>p.id===id)?.name||'page'}`;},
      reset:async()=>{formValues={};},
      setField:async(field,value)=>{formValues[field]=value;}
    });
  }catch(e){notice=`Workflow error: ${e.message}`;noticeError=true;}
  render();
}
document.addEventListener('click',e=>{const t=e.target.closest('button');if(!t)return;
  if(t.dataset.step){stepId=t.dataset.step;render();return;}
  if(t.dataset.flow){flowId=t.dataset.flow;stepId=activeFlow()?.startStepId||'';render();return;}
  if(t.hasAttribute('data-run')){void run();return;}
  if(t.hasAttribute('data-add')){addStep(insertType);return;}
  if(t.hasAttribute('data-delete')){if(mutation(p=>removeWorkflowStep(p.workflows.find(w=>w.id===flowId),stepId)))stepId=activeFlow().startStepId;render();return;}
  if(t.hasAttribute('data-download')){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}));a.href=u;a.download='application-workflows-v0.4.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);return;}
  if(t.hasAttribute('data-reset')){try{localStorage.removeItem(KEY);}catch{}project=createProject();flowId=project.workflows[0].id;stepId=activeFlow().startStepId;records=[];trace=[];notice='Example restored';noticeError=false;render();}
});
document.addEventListener('change',e=>{const t=e.target;if(t.id==='step-type'){insertType=t.value;return;}if(t.id==='insert-branch'){branch=t.value;return;}
  if(t.dataset.prop){let value=t.value;mutation(p=>{const w=p.workflows.find(w=>w.id===flowId);if(t.dataset.prop==='flowName')w.name=value;else{const s=w.steps.find(s=>s.id===stepId);s[t.dataset.prop]=value;if(t.dataset.prop==='operator'&&value==='selected'&&!s.modelId)s.modelId=p.models[0]?.id||'';}});}
  if(t.dataset.field){formValues[t.dataset.field]=t.value;}
});
document.addEventListener('input',e=>{if(e.target.dataset.field)formValues[e.target.dataset.field]=e.target.value;});
render();
