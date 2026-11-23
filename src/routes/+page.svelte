<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { CATALOG, CONTAINER_TYPES, FIELD_TYPES, createProject, createComponent, createId, createField, createModel, cloneProject, validateProject, migrateProject, findNodeLocation, insertNode, moveNode, removeNode, duplicateNode, walkNodes } from '#lib/studio/model.js';
  import { exportPageToSvelte, exportMySQL } from '#lib/studio/compiler.js';
  import { projectRevision } from '#lib/studio/revision.js';
  import { validateRecord } from '#lib/studio/records.js';
  import { STEP_TYPES, OPERATORS, createStep, createWorkflow, workflowForButton, insertWorkflowStep, removeWorkflowStep, workflowDiagram, executeWorkflow } from '#lib/studio/workflow.js';

  const STORE='visual-application-studio-v1';
  const properties={
    section:['title','tone'],columns:['title','tone'],
    heading:['text','level'],text:['text'],card:['title','body'],divider:[],
    input:['label','field','placeholder','required','bindingModelId','bindingFieldId'],
    textarea:['label','field','placeholder','required','bindingModelId','bindingFieldId'],
    select:['label','field','options','required','bindingModelId','bindingFieldId'],
    checkbox:['label','field','required','bindingModelId','bindingFieldId'],
    button:['text','variant','action','targetPageId','bindingModelId'],table:['title','columns','bindingModelId']
  };
  const selectOptions={
    level:[['1','1'],['2','2'],['3','3'],['4','4']],tone:[['plain','Plain'],['muted','Muted']],
    variant:[['primary','Primary'],['secondary','Secondary']],
    action:[['submit','Submit form (preview)'],['create','Create database record'],['update','Update selected record'],['delete','Delete selected record'],['navigate','Navigate to page'],['reset','Reset form'],['message','Show message']]
  };
  let project=$state(createProject());
  let activeId=$state(project.pages[0].id);
  let selectedId=$state('');
  let tab=$state('pages');
  let activeModelId=$state(project.models[0].id);
  let activeFieldId=$state('');
  let activeWorkflowId=$state(project.workflows[0]?.id??'');
  let activeStepId=$state(project.workflows[0]?.startStepId??'');
  let newStepType=$state('message');
  let newStepBranch=$state('true');
  let workflowTrace=$state([]);
  let mode=$state('design');
  let viewport=$state('desktop');
  let hydrated=$state(false);
  let previous=$state([]),upcoming=$state([]),notice=$state(''),fields=$state({}),records=$state({});
  let importElement;
  let runtimeState=$state({enabled:false,projectId:'',revision:'',reason:'Local database runtime not configured'});
  let runtimeMode=$state('memory'),liveRecords=$state({}),selectedRecords=$state({}),busy=$state(false);
  let runtimeReady=$derived(runtimeState.enabled&&runtimeState.projectId===project.id&&runtimeState.revision===projectRevision(project));
  let page=$derived(project.pages.find(p=>p.id===activeId)??project.pages[0]);
  let selected=$derived(findNodeLocation(page,selectedId)?.node);
  let activeModel=$derived(project.models.find(m=>m.id===activeModelId));
  let activeField=$derived(activeModel?.fields.find(f=>f.id===activeFieldId));
  let modelIds=$derived(new Map(project.models.map(m=>[m.id,m])));
  let activeWorkflow=$derived(project.workflows.find(w=>w.id===activeWorkflowId));
  let activeStep=$derived(activeWorkflow?.steps.find(s=>s.id===activeStepId));
  let diagram=$derived(workflowDiagram(activeWorkflow));
  let flowSourcePage=$derived(project.pages.find(p=>p.id===activeWorkflow?.trigger.pageId));
  let flowFields=$derived((()=>{const result=[];if(flowSourcePage)walkNodes(flowSourcePage.components,c=>{if(['input','textarea','select','checkbox'].includes(c.type)&&c.props.field&&!result.includes(c.props.field))result.push(c.props.field);});return result;})());
  let allTriggers=$derived((()=>{const result=[];for(const pg of project.pages)walkNodes(pg.components,c=>{if(c.type==='button')result.push({id:c.id,pageId:pg.id,label:`${pg.name} / ${c.props.text}`});});return result;})());

  onMount(()=>{void (async()=>{
    let saved=false;
    try {const raw=localStorage.getItem(STORE);if(raw){project=validateProject(migrateProject(JSON.parse(raw)));saved=true;activeId=project.pages[0].id;activeModelId=project.models[0]?.id??'';activeWorkflowId=project.workflows[0]?.id??'';activeStepId=project.workflows[0]?.startStepId??'';}}
    catch(e){notice=`Unable to restore project: ${e.message}`;}
    try {
      const response=await fetch('/api/runtime');
      if(response.ok)runtimeState=await response.json();
      if(runtimeState.enabled&&!saved){
        const published=await fetch('/api/runtime/project');
        if(published.ok){project=validateProject(migrateProject(await published.json()));activeId=project.pages[0].id;activeModelId=project.models[0]?.id??'';activeWorkflowId=project.workflows[0]?.id??'';activeStepId=project.workflows[0]?.startStepId??'';}
      }
    }catch{runtimeState={enabled:false,projectId:'',revision:'',reason:'Runtime not available'};}
    hydrated=true;
  })();});
  $effect(()=>{if(hydrated)try{localStorage.setItem(STORE,JSON.stringify(project));}catch(e){notice='Browser autosave unavailable.';}});

  function change(fn){
    const next=cloneProject(project);fn(next);validateProject(next);
    previous=[...previous.slice(-39),cloneProject(project)];upcoming=[];project=next;
  }
  function safe(fn){try{change(fn);notice='';}catch(e){notice=e.message;}}
  function undo(){if(!previous.length)return;upcoming=[...upcoming,cloneProject(project)];project=previous.at(-1);previous=previous.slice(0,-1);selectedId='';activeFieldId='';}
  function redo(){if(!upcoming.length)return;previous=[...previous,cloneProject(project)];project=upcoming.at(-1);upcoming=upcoming.slice(0,-1);selectedId='';activeFieldId='';}
  function selectPage(id){tab='pages';activeId=id;selectedId='';fields={};notice='';if(runtimeMode==='mysql')void refreshLive();}
  function selectData(){tab='data';mode='design';selectedId='';activeModelId=project.models[0]?.id??'';activeFieldId='';notice='';}
  function selectWorkflows(id=activeWorkflowId){tab='workflows';mode='design';selectedId='';activeWorkflowId=id||project.workflows[0]?.id||'';activeStepId=project.workflows.find(w=>w.id===activeWorkflowId)?.startStepId??'';notice='';}
  function createWorkflowFromButton(pageId=activeId,componentId=''){
    const trigger=componentId?{pageId,componentId}:allTriggers.find(t=>!project.workflows.some(w=>w.trigger.pageId===t.pageId&&w.trigger.componentId===t.id));
    if(!trigger){notice='Add an unassigned button to a page before creating another workflow.';return;}
    const existing=workflowForButton(project,trigger.pageId,trigger.componentId??trigger.id);
    if(existing){selectWorkflows(existing.id);return;}
    const flow=createWorkflow(trigger.pageId,trigger.componentId??trigger.id,`On ${allTriggers.find(t=>t.id===(trigger.componentId??trigger.id))?.label??'button click'}`);
    safe(p=>p.workflows.push(flow));
    if(!notice)selectWorkflows(flow.id);
  }
  function updateWorkflowName(value){safe(p=>p.workflows.find(w=>w.id===activeWorkflowId).name=value);}
  function updateWorkflowTrigger(value){const [pageId,componentId]=value.split('|');safe(p=>{const w=p.workflows.find(w=>w.id===activeWorkflowId);w.trigger.pageId=pageId;w.trigger.componentId=componentId;});}
  function deleteWorkflow(){if(!activeWorkflow)return;safe(p=>{p.workflows=p.workflows.filter(w=>w.id!==activeWorkflowId);});if(!notice)selectWorkflows(project.workflows[0]?.id??'');}
  function addWorkflowStep(){
    if(!activeWorkflow||!activeStep){notice='Select a workflow step before adding another.';return;}
    if(newStepType==='condition'&&!flowFields.length){notice='Add a form field to the trigger page before creating a condition.';return;}
    if(['create','update','delete'].includes(newStepType)&&!project.models.length){notice='Create a data model first.';return;}
    const values={};
    if(newStepType==='condition')values.field=flowFields[0];
    if(newStepType==='set_field'){
      if(!flowFields.length){notice='Add a form field to the trigger page first.';return;}
      values.field=flowFields[0];
    }
    if(['create','update','delete'].includes(newStepType))values.modelId=project.models[0].id;
    if(newStepType==='navigate')values.pageId=project.pages[0].id;
    const step=createStep(newStepType,undefined,values);
    safe(p=>insertWorkflowStep(p.workflows.find(w=>w.id===activeWorkflowId),step,activeStepId,newStepBranch));
    if(!notice)activeStepId=step.id;
  }
  function editWorkflowStep(key,value){safe(p=>{const s=p.workflows.find(w=>w.id===activeWorkflowId).steps.find(s=>s.id===activeStepId);s[key]=value;if(key==='operator'&&value==='selected'&&!s.modelId)s.modelId=p.models[0]?.id??'';});}
  function changeWorkflowStepType(type){
    if(!activeStep||type===activeStep.type)return;
    const original=activeStep;
    const outgoing=original.type==='condition'?[original.trueId,original.falseId].filter(Boolean):original.nextId?[original.nextId]:[];
    if(new Set(outgoing).size>1){notice='Reconnect the condition branches before changing its type.';return;}
    if(type==='condition'&&!flowFields.length){notice='Add a form field before creating a condition.';return;}
    if(['create','update','delete'].includes(type)&&!project.models.length){notice='Create a data model first.';return;}
    const step=createStep(type,original.id);
    if(type==='condition'){step.field=flowFields[0];step.trueId=outgoing[0]??'';}
    else if(type!=='stop')step.nextId=outgoing[0]??'';
    if(type==='set_field'){
      if(!flowFields.length){notice='Add a form field first.';return;}
      step.field=flowFields[0];
    }
    if(['create','update','delete'].includes(type))step.modelId=project.models[0].id;
    if(type==='navigate')step.pageId=project.pages[0].id;
    safe(p=>{const flow=p.workflows.find(w=>w.id===activeWorkflowId);flow.steps[flow.steps.findIndex(s=>s.id===original.id)]=step;});
  }
  function deleteWorkflowStep(){if(!activeStep)return;safe(p=>removeWorkflowStep(p.workflows.find(w=>w.id===activeWorkflowId),activeStepId));if(!notice)activeStepId=project.workflows.find(w=>w.id===activeWorkflowId)?.startStepId??'';}
  function stepDescription(s){
    if(s.type==='condition')return s.operator==='selected'?`Record selected · ${modelIds.get(s.modelId)?.name??'Model'}`:`${s.field} ${OPERATORS.find(o=>o.value===s.operator)?.label.toLowerCase()??s.operator}${['equals','not_equals','greater_than','less_than'].includes(s.operator)?` ${s.value}`:''}`;
    if(['create','update','delete'].includes(s.type))return modelIds.get(s.modelId)?.name??'Data model';
    if(s.type==='navigate')return project.pages.find(p=>p.id===s.pageId)?.name??'Page';
    if(s.type==='message')return s.text;
    if(s.type==='set_field')return `${s.field} = ${s.value}`;
    return s.type==='reset'?'Clear current form':'End';
  }
  function addPage(){const id=createId('page');change(p=>p.pages.push({id,name:`New page ${p.pages.length+1}`,path:`/page-${p.pages.length+1}`,components:[createComponent('heading')]}));selectPage(id);}
  function deletePage(){if(project.pages.length<2)return;change(p=>{p.pages=p.pages.filter(x=>x.id!==activeId);});selectPage(project.pages[0].id);}
  function addComponent(type,parentId='',index){
    const node=createComponent(type);
    safe(p=>insertNode(p.pages.find(pg=>pg.id===activeId),node,parentId,index));
    if(!notice)selectedId=node.id;
  }
  function updateProps(key,value){
    safe(p=>{
      const c=findNodeLocation(p.pages.find(x=>x.id===activeId),selectedId)?.node;
      if(!c)throw new Error('Select a component');
      c.props[key]=value;
      if(key==='bindingModelId'){
        const model=p.models.find(m=>m.id===value);
        const field=model?.fields.find(f=>!f.primary);
        if(['input','textarea','select','checkbox'].includes(c.type)){
          c.props.bindingFieldId=field?.id??'';
          if(field)c.props.field=field.name;
        }
        if(c.type==='table'&&model)c.props.columns=model.fields.filter(f=>!f.primary).map(f=>f.name).join(',');
      }
      if(key==='bindingFieldId'&&value){
        const field=p.models.find(m=>m.id===c.props.bindingModelId)?.fields.find(f=>f.id===value);
        if(field)c.props.field=field.name;
      }
    });
  }
  function deleteSelected(){safe(p=>removeNode(p.pages.find(pg=>pg.id===activeId),selectedId));selectedId='';}
  function duplicateSelected(){if(!selected)return;const node=duplicateNode(selected);safe(p=>{
    const pg=p.pages.find(x=>x.id===activeId),pos=findNodeLocation(pg,selectedId);
    insertNode(pg,node,pos.parentId,pos.index+1);
  });if(!notice)selectedId=node.id;}
  function beginDrag(e,tag){e.stopPropagation();e.dataTransfer?.setData('text/plain',tag);}
  function onDrop(e,parentId,index){e.preventDefault();e.stopPropagation();if(mode!=='design'||tab!=='pages')return;
    const tag=e.dataTransfer?.getData('text/plain')??'';
    if(tag.startsWith('new:')){const type=tag.slice(4);if(CATALOG.some(c=>c.type===type))addComponent(type,parentId,index);}
    else if(tag.startsWith('move:'))safe(p=>moveNode(p.pages.find(x=>x.id===activeId),tag.slice(5),parentId,index));
  }
  function requiredNodes(){const nodes=[];walkNodes(page.components,c=>{if(['input','textarea','select','checkbox'].includes(c.type)&&c.props.required&&!fields[c.props.field])nodes.push(c);});return nodes;}
  function modelForAction(component){
    const direct=component.props.bindingModelId;
    if(direct)return project.models.find(m=>m.id===direct);
    const ids=new Set();walkNodes(page.components,c=>{if(['input','textarea','select','checkbox'].includes(c.type)&&c.props.bindingModelId)ids.add(c.props.bindingModelId);});
    if(ids.size!==1)throw new Error('Bind the action button to one data model.');
    return project.models.find(m=>m.id===[...ids][0]);
  }
  function payloadForModel(model,operation){
    const data={};let count=0;
    walkNodes(page.components,c=>{
      if(['input','textarea','select','checkbox'].includes(c.type)&&c.props.bindingModelId===model.id){
        const attribute=model.fields.find(f=>f.id===c.props.bindingFieldId);
        if(!attribute||attribute.primary)return;
        if(Object.hasOwn(data,attribute.name))throw new Error(`Duplicate field binding: ${attribute.name}`);
        const raw=fields[c.props.field];
        if(raw!==undefined&&raw!==''||c.type==='checkbox'&&raw===false)data[attribute.name]=raw;
        count++;
      }
    });
    if(!count)throw new Error(`Add controls bound to ${model.name} first.`);
    return validateRecord(model,data,operation);
  }
  async function requestRecords(modelId,method='GET',recordId='',payload){
    const url=`/api/runtime/models/${encodeURIComponent(modelId)}${recordId?`/${encodeURIComponent(recordId)}`:''}`;
    const response=await fetch(url,{method,headers:{'x-studio-project-id':project.id,'x-studio-project-revision':projectRevision(project),...(payload!==undefined?{'content-type':'application/json'}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});
    let result;try{result=await response.json();}catch{throw new Error(`Server returned HTTP ${response.status}`);}
    if(!response.ok)throw new Error(result.error??`Server returned HTTP ${response.status}`);
    return result;
  }
  async function refreshLive(){
    if(!runtimeReady||runtimeMode!=='mysql')return;
    const ids=new Set();walkNodes(page.components,c=>{if(c.type==='table'&&c.props.bindingModelId)ids.add(c.props.bindingModelId);});
    for(const id of ids){
      try{const result=await requestRecords(id);liveRecords={...liveRecords,[id]:result.records};}
      catch(e){notice=`MySQL read failed: ${e.message}`;}
    }
  }
  async function enterPreview(){mode='preview';selectedId='';notice='';if(runtimeMode==='mysql')await refreshLive();}
  async function chooseRuntime(value){
    runtimeMode=value;notice='';if(value==='mysql'){
      if(!runtimeReady){runtimeMode='memory';notice='Your editor project differs from the published runtime, or MySQL is disabled. Export and publish the project to continue.';return;}
      await refreshLive();
    }
  }
  function inputType(component){
    const f=project.models.find(m=>m.id===component.props.bindingModelId)?.fields.find(f=>f.id===component.props.bindingFieldId);
    return f?.type==='date'?'date':f?.type==='datetime'?'datetime-local':f?.type==='decimal'?'number':'text';
  }
  function selectRecord(modelId,record){
    const model=project.models.find(m=>m.id===modelId),pk=model?.fields.find(f=>f.primary);
    if(!pk)return;
    selectedRecords={...selectedRecords,[modelId]:String(record[pk.name])};
    const next={...fields};
    walkNodes(page.components,c=>{
      if(['input','textarea','select','checkbox'].includes(c.type)&&c.props.bindingModelId===modelId){
        const field=model.fields.find(f=>f.id===c.props.bindingFieldId);
        if(field){const raw=record[field.name];next[c.props.field]=field.type==='boolean'?Boolean(raw):field.type==='datetime'&&typeof raw==='string'?raw.replace(' ','T'):raw??'';}
      }
    });
    fields=next;notice=`Selected ${model.name} record ${record[pk.name]}.`;
  }
  async function activate(c){
    const workflow=workflowForButton(project,page.id,c.id);
    if(workflow){
      if(busy)return;
      busy=true;workflowTrace=[];notice='';
      try{
        const trace=await executeWorkflow(workflow,{fields:{...fields},selectedRecords:{...selectedRecords}}, {
          data:async(operation,modelId)=>{
            const model=project.models.find(m=>m.id===modelId);if(!model)throw new Error('Workflow model is missing');
            if(runtimeMode!=='mysql'){
              if(operation!=='create')throw new Error('Update and delete workflows require MySQL (local).');
              const value=payloadForModel(model,'create');records={...records,[page.id]:[...(records[page.id]??[]),value]};return;
            }
            if(!runtimeReady)throw new Error('Publish this project to use MySQL workflows.');
            const id=selectedRecords[modelId];
            if(operation==='create')await requestRecords(modelId,'POST','',payloadForModel(model,'create'));
            if(operation==='update'){
              if(!id)throw new Error('Select a record in the data table to update.');
              await requestRecords(modelId,'PATCH',id,payloadForModel(model,'update'));
            }
            if(operation==='delete'){
              if(!id)throw new Error('Select a record in the data table to delete.');
              if(!confirm(`Delete ${model.name} record ${id}?`))throw new Error('Deletion cancelled.');
              await requestRecords(modelId,'DELETE',id);selectedRecords={...selectedRecords,[modelId]:''};
            }
            await refreshLive();
          },
          navigate:async pageId=>selectPage(pageId),
          message:async text=>{notice=text;},
          reset:async()=>{fields={};selectedRecords={};},
          setField:async(field,value)=>{fields={...fields,[field]:value};}
        });
        workflowTrace=trace;
      }catch(e){notice=`Workflow: ${e.message}`;}finally{busy=false;}
      return;
    }
    const {action,targetPageId}=c.props;
    if(action==='navigate'){if(project.pages.some(pg=>pg.id===targetPageId))selectPage(targetPageId);else notice='Choose a destination page.';return;}
    if(action==='reset'){fields={};selectedRecords={};notice='Form reset.';return;}
    if(action==='message'){notice=`${c.props.text} clicked.`;return;}
    if(runtimeMode!=='mysql'){
      if(['update','delete'].includes(action)){notice='Choose MySQL (local) in preview to update or delete database records.';return;}
      const missing=requiredNodes();if(missing.length){notice=`Required: ${missing.map(x=>x.props.label).join(', ')}`;return;}
      records={...records,[page.id]:[...(records[page.id]??[]),{...fields}]};notice=`Preview submission: ${JSON.stringify(fields)}`;return;
    }
    if(!runtimeReady){notice='Runtime project mismatch. Publish the current project before saving records.';return;}
    if(busy)return;
    busy=true;
    try{
      const model=modelForAction(c);if(!model)throw new Error('Select a valid bound data model.');
      const id=selectedRecords[model.id];let result;
      if(action==='delete'){
        if(!id)throw new Error('Select a record in the bound data table first.');
        if(!confirm(`Delete ${model.name} record ${id}? This cannot be undone.`))return;
        result=await requestRecords(model.id,'DELETE',id);
        selectedRecords={...selectedRecords,[model.id]:''};fields={};
      }else if(action==='update'){
        if(!id)throw new Error('Select a record in the bound data table first.');
        result=await requestRecords(model.id,'PATCH',id,payloadForModel(model,'update'));
      }else{
        result=await requestRecords(model.id,'POST','',payloadForModel(model,'create'));
      }
      notice=action==='delete'?`Deleted ${model.name} record ${id}.`:`Saved ${model.name} record ${result.record[model.fields.find(f=>f.primary).name]}.`;
      await refreshLive();
    }catch(e){notice=`MySQL: ${e.message}`;}finally{busy=false;}
  }
  async function loadPublished(){
    if(!runtimeState.enabled)return;
    if(!confirm('Replace the browser editor project with the locally published application? Export any unsaved work first.'))return;
    try{const response=await fetch('/api/runtime/project');if(!response.ok)throw new Error('Published project unavailable');
      const next=validateProject(migrateProject(await response.json()));project=next;activeId=next.pages[0].id;activeModelId=next.models[0]?.id??'';activeWorkflowId=next.workflows[0]?.id??'';activeStepId=next.workflows[0]?.startStepId??'';previous=[];upcoming=[];selectedId='';fields={};liveRecords={};selectedRecords={};runtimeMode='memory';notice='Published project loaded. Open Preview and choose MySQL (local).';
    }catch(e){notice=e.message;}
  }
  function addModel(){const n=project.models.length+1, id=createId('model');safe(p=>p.models.push(createModel(`Model ${n}`,`model_${n}`,id)));if(!notice){activeModelId=id;activeFieldId='';}}
  function updateModel(key,value){safe(p=>{const m=p.models.find(m=>m.id===activeModelId);m[key]=value;});}
  function deleteModel(){if(!activeModel)return;safe(p=>{p.models=p.models.filter(m=>m.id!==activeModelId);});if(!notice){activeModelId=project.models[0]?.id??'';activeFieldId='';}}
  function addField(){if(!activeModel)return;const field=createField(`field_${activeModel.fields.length+1}`);safe(p=>p.models.find(m=>m.id===activeModelId).fields.push(field));if(!notice)activeFieldId=field.id;}
  function editField(key,value){safe(p=>{
    const f=p.models.find(m=>m.id===activeModelId).fields.find(f=>f.id===activeFieldId);
    f[key]=value;
    if(key==='type'&&(f.referenceModelId||f.referenceFieldId)){f.referenceModelId='';f.referenceFieldId='';}
  });}
  function setRelation(value){safe(p=>{
    const f=p.models.find(m=>m.id===activeModelId).fields.find(f=>f.id===activeFieldId);
    const [modelId,fieldId]=value.split('|');
    f.referenceModelId=modelId??'';f.referenceFieldId=fieldId??'';
    if(modelId){const ref=p.models.find(m=>m.id===modelId).fields.find(x=>x.id===fieldId);f.type=ref.type;f.primary=false;}
  });}
  function deleteField(){if(!activeField||activeField.primary)return;
    safe(p=>{const m=p.models.find(m=>m.id===activeModelId);m.fields=m.fields.filter(f=>f.id!==activeFieldId);});
    if(!notice)activeFieldId='';
  }
  function download(name,text,mime){const url=URL.createObjectURL(new Blob([text],{type:mime}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
  function exportProject(){download('application.project.json',JSON.stringify(project,null,2),'application/json');}
  function exportUI(){download('generated-page.svelte',exportPageToSvelte(page),'text/plain');}
  function exportSQL(){try{download('schema.mysql.sql',exportMySQL(project),'text/plain');notice='MySQL DDL generated. Review before applying.';}catch(e){notice=e.message;}}
  async function importProject(e){const file=e.currentTarget.files?.[0];if(!file)return;
    try{const data=validateProject(migrateProject(JSON.parse(await file.text())));
      change(p=>{for(const k of Object.keys(p))delete p[k];Object.assign(p,data);});
      selectPage(data.pages[0].id);activeModelId=data.models[0]?.id??'';activeWorkflowId=data.workflows[0]?.id??'';activeStepId=data.workflows[0]?.startStepId??'';notice='Project imported.';
    }catch(err){notice=`Import failed: ${err.message}`;}e.currentTarget.value='';
  }
</script>

<svelte:head><title>Visual Application Studio</title><meta name="description" content="A metadata-driven, visual app builder with a relational model designer." /></svelte:head>

{#snippet treeNodes(nodes,depth)}
  {#each nodes as node (node.id)}
    <div class="tree-node" style:padding-left={`${depth*12}px`}>
      <button class:active={selectedId===node.id} onclick={()=>{tab='pages';mode='design';selectedId=node.id;}} title={`Select ${node.type}`}>
        <span class="tree-glyph">{CATALOG.find(x=>x.type===node.type)?.icon}</span>
        <span class="tree-name">{node.props.title??node.props.label??node.props.text??node.type}</span>
        {#if node.children}<span class="tree-count">{node.children.length}</span>{/if}
      </button>
    </div>
    {#if node.children}{@render treeNodes(node.children,depth+1)}{/if}
  {/each}
{/snippet}

{#snippet canvasNodes(nodes,parentId='')}
  {#each nodes as component,i (component.id)}
    {#if mode==='design'}<div role="presentation" class="dropzone" ondragover={e=>e.preventDefault()} ondrop={e=>onDrop(e,parentId,i)}></div>{/if}
    <div class="component" class:selected={selectedId===component.id&&mode==='design'} class:editable={mode==='design'} draggable={mode==='design'}
      ondragstart={e=>beginDrag(e,`move:${component.id}`)} onclick={e=>{e.stopPropagation();if(mode==='design')selectedId=component.id;}}
      onkeydown={e=>{if(mode==='design'&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();selectedId=component.id;}}}
      role="button" tabindex={mode==='design'?0:-1} aria-label={`Component ${component.type}`}>
      {#if mode==='design'}<span class="draghandle">⠿</span>{/if}
      {#if CONTAINER_TYPES.includes(component.type)}
        <section class="layout-box" class:layout-columns={component.type==='columns'} class:layout-muted={component.props.tone==='muted'}>
          <h3 class="layout-title">{component.props.title}</h3>
          <div class="layout-children" class:two-col={component.type==='columns'}>{@render canvasNodes(component.children,component.id)}</div>
        </section>
      {:else if component.type==='heading'}<svelte:element this={`h${[1,2,3,4].includes(Number(component.props.level))?component.props.level:2}`}>{component.props.text}</svelte:element>
      {:else if component.type==='text'}<p>{component.props.text}</p>
      {:else if component.type==='card'}<div class="render-card"><h3>{component.props.title}</h3><p>{component.props.body}</p></div>
      {:else if component.type==='divider'}<hr />
      {:else if ['input','textarea','select'].includes(component.type)}
        <label class="field-label">{component.props.label}{#if component.props.required}<em> *</em>{/if}</label>
        {#if component.type==='input'}<input class="form-input" type={inputType(component)} step={inputType(component)==='number'?'0.0001':undefined} placeholder={component.props.placeholder} disabled={mode==='design'} value={fields[component.props.field]??''} oninput={e=>fields={...fields,[component.props.field]:e.currentTarget.value}} />
        {:else if component.type==='textarea'}<textarea class="form-input" rows="3" placeholder={component.props.placeholder} disabled={mode==='design'} value={fields[component.props.field]??''} oninput={e=>fields={...fields,[component.props.field]:e.currentTarget.value}}></textarea>
        {:else}<select class="form-input" disabled={mode==='design'} value={fields[component.props.field]??''} onchange={e=>fields={...fields,[component.props.field]:e.currentTarget.value}}><option value="">Select one…</option>{#each String(component.props.options??'').split('\n').filter(Boolean) as opt}<option value={opt}>{opt}</option>{/each}</select>{/if}
      {:else if component.type==='checkbox'}<label class="checkline"><input type="checkbox" disabled={mode==='design'} checked={Boolean(fields[component.props.field])} onchange={e=>fields={...fields,[component.props.field]:e.currentTarget.checked}} />{component.props.label}</label>
      {:else if component.type==='button'}<button class:secondary={component.props.variant==='secondary'} class="render-button" onclick={e=>{e.stopPropagation();if(mode==='preview')activate(component);}} disabled={mode==='design'}>{component.props.text}</button>
      {:else if component.type==='table'}<div class="table-wrap"><h3>{component.props.title}</h3><table><thead><tr>{#each String(component.props.columns??'').split(',').filter(Boolean) as col}<th>{col.trim()}</th>{/each}{#if mode==='preview'&&runtimeMode==='mysql'&&component.props.bindingModelId}<th>Record</th>{/if}</tr></thead><tbody>
        {#if mode==='preview'&&runtimeMode==='mysql'&&component.props.bindingModelId}
          {#each (liveRecords[component.props.bindingModelId]??[]) as record,i}
            <tr>{#each String(component.props.columns??'').split(',').filter(Boolean) as col}<td>{String(record[col.trim()]??'—')}</td>{/each}<td><button class="row-select" onclick={e=>{e.stopPropagation();selectRecord(component.props.bindingModelId,record);}}>Select</button></td></tr>
          {:else}<tr><td class="muted" colspan={String(component.props.columns??'').split(',').filter(Boolean).length+1}>No records yet. Use a bound Create button to add one.</td></tr>{/each}
        {:else}<tr>{#each String(component.props.columns??'').split(',').filter(Boolean) as col}<td class="muted">{(records[page.id]??[]).length?String((records[page.id]??[]).at(-1)?.[col.trim().toLowerCase().replaceAll(' ','_')]??'—'):'No data yet'}</td>{/each}</tr>{/if}
      </tbody></table></div>{/if}
    </div>
  {/each}
  {#if mode==='design'}<div class="dropzone last" role="presentation" ondragover={e=>e.preventDefault()} ondrop={e=>onDrop(e,parentId,nodes.length)}>Drop a component here</div>{/if}
{/snippet}

<div class="studio" class:workflow-view={tab==='workflows'}>
  <header class="topbar">
    <div class="identity"><span class="logo">◧</span><div><strong>Visual Application Studio</strong><small>Visual app building · alpha 0.4</small></div></div>
    <div class="project"><span class="status-dot"></span><input aria-label="Project name" value={project.name} onchange={e=>safe(p=>p.name=e.currentTarget.value)} /></div>
    <nav class="actions" aria-label="Project actions">
      <button onclick={undo} disabled={!previous.length} title="Undo">↶</button>
      <button onclick={redo} disabled={!upcoming.length} title="Redo">↷</button>
      <button onclick={()=>importElement?.click()}>Import</button>
      <button onclick={exportProject} title="Save all project metadata">Save JSON</button>
      <button onclick={exportUI} title="Export selected page as Svelte markup">Export UI</button>
      <button onclick={exportSQL} title="Export generated MySQL DDL">Export SQL</button>
      {#if runtimeState.enabled}<button onclick={loadPublished} title="Replace browser editor with locally published metadata">Load published</button>{/if}
    </nav>
    <input class="hidden" type="file" accept="application/json,.json" bind:this={importElement} onchange={importProject} />
  </header>
  <div class="workspace">
    <aside class="sidebar">
      <div class="workspace-switch"><button class:active={tab==='pages'} onclick={()=>tab='pages'}>Pages & tree</button><button class:active={tab==='data'} onclick={selectData}>Data models</button><button class:active={tab==='workflows'} onclick={()=>selectWorkflows()}>Workflows</button></div>
      {#if tab==='pages'}
        <div class="sidebar-head"><span>PAGES</span><button onclick={addPage} aria-label="Add page">+</button></div>
        <div class="project-tree">
          {#each project.pages as pg (pg.id)}<button class:active={pg.id===activeId} onclick={()=>selectPage(pg.id)}><span>▤</span>{pg.name}</button>{/each}
        </div>
        <div class="sidebar-head"><span>COMPONENT TREE</span><small>{page.components.length} root items</small></div>
        <div class="component-tree">{@render treeNodes(page.components,0)}</div>
        <div class="sidebar-head toolbox-title"><span>COMPONENTS</span><small>Drag or click to add</small></div>
        <div class="toolbox">{#each ['Layout','Content','Form controls','Actions','Data display'] as group}
          <div class="group-label">{group}</div><div class="tool-grid">{#each CATALOG.filter(c=>c.group===group) as item (item.type)}
            <button class="tool" draggable="true" ondragstart={e=>beginDrag(e,`new:${item.type}`)} onclick={()=>addComponent(item.type,selected&&CONTAINER_TYPES.includes(selected.type)?selected.id:'')}><span class="tool-icon">{item.icon}</span>{item.label}</button>
          {/each}</div>
        {/each}</div>
      {:else if tab==='workflows'}
        <div class="sidebar-head"><span>WORKFLOWS</span><button onclick={()=>createWorkflowFromButton()} aria-label="Add workflow">+</button></div>
        <div class="project-tree workflow-list">{#each project.workflows as flow (flow.id)}<button class:active={activeWorkflowId===flow.id} onclick={()=>selectWorkflows(flow.id)}><span>◇</span>{flow.name}<small>{flow.steps.length} steps</small></button>{:else}<p class="sidebar-note">Add a button on a page, then create its click workflow.</p>{/each}</div>
        <p class="sidebar-note">Each workflow starts when its bound button is clicked in Preview. Connections and conditions execute in order.</p>
      {:else}
        <div class="sidebar-head"><span>DATA ENTITIES</span><button onclick={addModel} aria-label="Add model">+</button></div>
        <div class="project-tree">{#each project.models as model (model.id)}<button class:active={activeModelId===model.id} onclick={()=>{activeModelId=model.id;activeFieldId='';}}><span>▦</span>{model.name}<small>{model.fields.length} fields</small></button>{/each}</div>
        <p class="sidebar-note">Define typed fields and relationships, then export a reviewable MySQL schema.</p>
      {/if}
    </aside>
    <main class="workarea">
      <div class="canvasbar"><div class="breadcrumbs">{project.name} <span>/</span><b>{tab==='pages'?page.name:tab==='data'?'Data model':'Workflow designer'}</b>{#if tab==='pages'}<span class="path">{page.path}</span>{/if}</div>
        {#if tab==='pages'}<div class="canvas-tools"><div class="segment"><button class:chosen={viewport==='desktop'} onclick={()=>viewport='desktop'} title="Desktop">▣</button><button class:chosen={viewport==='mobile'} onclick={()=>viewport='mobile'} title="Mobile">▯</button></div><div class="segment"><button class:chosen={mode==='design'} onclick={()=>mode='design'}>Design</button><button class:chosen={mode==='preview'} onclick={enterPreview}>▶ Preview</button></div></div>
        {:else if tab==='data'}<div class="canvas-tools"><span class="data-caption">Logical model → MySQL schema</span><button class="model-add" onclick={addModel}>+ Entity</button></div>
        {:else}<div class="canvas-tools"><span class="data-caption">Button event → branch → actions</span><button class="model-add" onclick={()=>createWorkflowFromButton()}>+ Workflow</button></div>{/if}
      </div>
      {#if tab==='pages'}
        <div class="canvas-scroll"><div class="page-shell" class:mobile={viewport==='mobile'}><div class="page-heading"><div><small>APPLICATION PAGE</small><h2>{page.name}</h2></div><span>{mode==='design'?'DESIGN CANVAS':'LIVE PREVIEW'}</span></div>
          {#if mode==='preview'}
            <div class="runtime-toolbar"><span>Data source</span><button class:chosen={runtimeMode==='memory'} onclick={()=>chooseRuntime('memory')}>Memory preview</button><button class:chosen={runtimeMode==='mysql'} disabled={!runtimeReady} onclick={()=>chooseRuntime('mysql')}>MySQL (local)</button><span class="runtime-message">{runtimeReady?'Published model matches editor':runtimeState.reason||'Editor changes must be published before live data is available'}</span>{#if workflowTrace.length}<span class="runtime-message">Workflow: {workflowTrace.map(x=>x.type).join(' → ')}</span>{/if}</div>
          {/if}
          <div class="page-content">{@render canvasNodes(page.components,'')}{#if notice}<div class="feedback" role="status">{notice}</div>{/if}</div>
        </div></div>
      {:else if tab==='data'}
        <div class="canvas-scroll data-scroll"><div class="data-workspace"><div class="data-intro"><div><small>SCHEMA DESIGNER</small><h2>Data models</h2><p>Create entities, edit fields, and connect foreign keys. All metadata stays in your project.</p></div><button class="render-button" onclick={addModel}>+ New entity</button></div>
          {#if !project.models.length}<div class="empty-state">No models yet. Create an entity to define its table and attributes.</div>{/if}
          <div class="model-grid">
            {#each project.models as model (model.id)}
              <section class="model-card" class:model-active={activeModelId===model.id}>
                <button class="model-header" onclick={()=>{activeModelId=model.id;activeFieldId='';}}><div><small>ENTITY</small><strong>{model.name}</strong><code>{model.table}</code></div><span>▦</span></button>
                <div class="model-fields">{#each model.fields as field (field.id)}
                  <button class:field-active={activeFieldId===field.id&&activeModelId===model.id} onclick={()=>{activeModelId=model.id;activeFieldId=field.id;}}>
                    <span class="field-name">{field.primary?'◆':field.referenceModelId?'↗':'∙'} {field.name}</span><span class="field-type">{field.type}{field.required?' · required':''}</span>
                  </button>
                {/each}</div>
                <div class="model-footer"><span>{model.fields.length} fields</span><button onclick={()=>{activeModelId=model.id;activeFieldId='';addField();}}>+ Field</button></div>
              </section>
            {/each}
          </div>
          <div class="relationship-panel"><h3>Relationships</h3>
            {#each project.models as m}{#each m.fields.filter(f=>f.referenceModelId) as f}
              <div class="relation-row"><span>{m.table}.{f.name}</span><span>→</span><span>{modelIds.get(f.referenceModelId)?.table}.{modelIds.get(f.referenceModelId)?.fields.find(x=>x.id===f.referenceFieldId)?.name}</span></div>
            {/each}{/each}
            <p>Foreign keys are generated after table creation to support cross-references.</p>
          </div>
          {#if notice}<div class="feedback" role="status">{notice}</div>{/if}
        </div></div>
      {:else}
        <div class="canvas-scroll workflow-scroll">
          <div class="workflow-workspace">
            {#if activeWorkflow}
              <div class="workflow-intro"><div><small>VISUAL LOGIC DESIGNER</small><h2>{activeWorkflow.name}</h2><p>Click the cards to edit each step. Lines show execution paths; green is true and red is false.</p></div><button class="model-add" onclick={()=>{tab='pages';activeId=activeWorkflow.trigger.pageId;selectedId=activeWorkflow.trigger.componentId;}}>Edit trigger button</button></div>
              <div class="workflow-toolbar"><span>Insert after selected step</span><select aria-label="New step type" bind:value={newStepType}>{#each STEP_TYPES as kind}<option value={kind.type}>{kind.label}</option>{/each}</select>
                {#if activeStep?.type==='condition'}<select aria-label="New step branch" bind:value={newStepBranch}><option value="true">True branch</option><option value="false">False branch</option></select>{/if}
                <button onclick={addWorkflowStep} disabled={!activeStep}>+ Add step</button>
                <span class="workflow-count">{activeWorkflow.steps.length} steps · {project.workflows.length} workflows</span>
              </div>
              <div class="workflow-diagram-wrap" aria-label="Workflow diagram"><div class="workflow-diagram" style:width={`${diagram.width}px`} style:height={`${diagram.height}px`}>
                <svg class="workflow-wires" width={diagram.width} height={diagram.height} aria-hidden="true">
                  {#each diagram.edges as edge (`${edge.from}-${edge.to}-${edge.kind}`)}<path d={edge.path} class:edge-true={edge.kind==='true'} class:edge-false={edge.kind==='false'} fill="none" stroke-width="2.5" />{/each}
                </svg>
                {#each diagram.nodes as node (node.id)}
                  <button class="workflow-node" class:node-selected={activeStepId===node.id} class:node-condition={node.type==='condition'} style:left={`${node.x}px`} style:top={`${node.y}px`} onclick={()=>activeStepId=node.id}>
                    <small>{node.id===activeWorkflow.startStepId?'▶ START · ':''}{STEP_TYPES.find(k=>k.type===node.type)?.label}</small>
                    <strong>{stepDescription(node)}</strong>
                    <span>{node.type==='condition'?`TRUE → ${node.trueId?'step':'END'}   |   FALSE → ${node.falseId?'step':'END'}`:node.type==='stop'?'END':node.nextId?'→ next step':'→ END'}</span>
                  </button>
                {/each}
              </div></div>
              <div class="workflow-instructions"><strong>How it works</strong><span>Choose an action in the toolbar, click <b>Add step</b>, then select a card to change its targets and settings. Cyclic or broken paths are rejected automatically.</span></div>
            {:else}
              <div class="empty-state">No workflows yet. Create a button in the page designer, then click <b>+ Workflow</b> to connect visual logic to it.</div>
            {/if}
            {#if notice}<div class="feedback" role="status">{notice}</div>{/if}
          </div>
        </div>
      {/if}
      <div class="statusbar"><span>● Browser autosave · {runtimeReady?'MySQL published project available':'MySQL preview not connected'}</span><span>{project.pages.length} pages · {project.models.length} models · {project.workflows.length} workflows</span></div>
    </main>
    <aside class="inspector"><div class="inspector-title"><span>{tab==='data'?'DATA PROPERTIES':tab==='workflows'?'WORKFLOW PROPERTIES':'PROPERTIES'}</span><span class="inspect-icon">⚙</span></div>
      {#if tab==='data'}
        {#if activeModel}
          <div class="inspect-body"><div class="selected-info"><div class="selection-icon">▦</div><div><strong>{activeModel.name}</strong><small>{activeField?'Editing attribute':'Entity settings'}</small></div></div>
            {#if activeField}
              <div class="section-label">ATTRIBUTE</div>
              <label class="property-label">Name<input value={activeField.name} onchange={e=>editField('name',e.currentTarget.value)} /></label>
              <label class="property-label">Type<select value={activeField.type} disabled={activeField.primary||Boolean(activeField.referenceModelId)} onchange={e=>editField('type',e.currentTarget.value)}>{#each FIELD_TYPES as type}<option value={type}>{type}</option>{/each}</select></label>
              <label class="property-label">Required <input type="checkbox" checked={activeField.required} disabled={activeField.primary} onchange={e=>editField('required',e.currentTarget.checked)} /></label>
              <label class="property-label">Unique <input type="checkbox" checked={activeField.unique} disabled={activeField.primary} onchange={e=>editField('unique',e.currentTarget.checked)} /></label>
              <label class="property-label">References<select value={activeField.referenceModelId?`${activeField.referenceModelId}|${activeField.referenceFieldId}`:''} disabled={activeField.primary} onchange={e=>setRelation(e.currentTarget.value)}><option value="">None</option>{#each project.models as m}{#each m.fields.filter(f=>f.primary) as f}<option value={`${m.id}|${f.id}`}>{m.name} → {f.name}</option>{/each}{/each}</select></label>
              {#if !activeField.primary}<button class="danger page-delete" onclick={deleteField}>Delete attribute</button>{/if}
              <button class="property-link" onclick={()=>activeFieldId=''}>← Entity settings</button>
            {:else}
              <div class="section-label">ENTITY</div>
              <label class="property-label">Display name<input value={activeModel.name} onchange={e=>updateModel('name',e.currentTarget.value)} /></label>
              <label class="property-label">MySQL table<input value={activeModel.table} onchange={e=>updateModel('table',e.currentTarget.value)} /></label>
              <button class="model-add" onclick={addField}>+ Add attribute</button>
              <button class="danger page-delete" onclick={deleteModel}>Delete entity</button>
              <p class="hint">Names use lowercase ASCII letters, digits and underscores. One primary key is required per entity.</p>
            {/if}
          </div>
        {:else}<div class="inspect-body"><p class="hint">Create an entity to begin modelling data.</p></div>{/if}
      {:else if tab==='workflows'}
        <div class="inspect-body">
          {#if activeWorkflow}
            <div class="selected-info"><div class="selection-icon">◇</div><div><strong>{activeWorkflow.name}</strong><small>Click event · {activeWorkflow.steps.length} steps</small></div></div>
            <div class="section-label">WORKFLOW</div>
            <label class="property-label">Name<input value={activeWorkflow.name} onchange={e=>updateWorkflowName(e.currentTarget.value)} /></label>
            <label class="property-label">Triggered by button<select value={`${activeWorkflow.trigger.pageId}|${activeWorkflow.trigger.componentId}`} onchange={e=>updateWorkflowTrigger(e.currentTarget.value)}>{#each allTriggers as target}<option value={`${target.pageId}|${target.id}`} disabled={Boolean(project.workflows.find(w=>w.id!==activeWorkflowId&&w.trigger.pageId===target.pageId&&w.trigger.componentId===target.id))}>{target.label}</option>{/each}</select></label>
            <button class="danger page-delete" onclick={deleteWorkflow}>Delete workflow</button>
            {#if activeStep}
              <div class="section-label">SELECTED STEP</div>
              <label class="property-label">Action type<select value={activeStep.type} onchange={e=>changeWorkflowStepType(e.currentTarget.value)}>{#each STEP_TYPES as kind}<option value={kind.type}>{kind.label}</option>{/each}</select></label>
              {#if activeStep.type==='condition'}
                <label class="property-label">Operator<select value={activeStep.operator} onchange={e=>editWorkflowStep('operator',e.currentTarget.value)}>{#each OPERATORS as op}<option value={op.value}>{op.label}</option>{/each}</select></label>
                {#if activeStep.operator==='selected'}<label class="property-label">Selected entity<select value={activeStep.modelId} onchange={e=>editWorkflowStep('modelId',e.currentTarget.value)}>{#each project.models as m}<option value={m.id}>{m.name}</option>{/each}</select></label>
                {:else}<label class="property-label">Form field<select value={activeStep.field} onchange={e=>editWorkflowStep('field',e.currentTarget.value)}>{#each flowFields as field}<option value={field}>{field}</option>{/each}</select></label>{/if}
                {#if ['equals','not_equals','greater_than','less_than'].includes(activeStep.operator)}<label class="property-label">Compare with<input value={activeStep.value} onchange={e=>editWorkflowStep('value',e.currentTarget.value)} /></label>{/if}
              {:else if ['create','update','delete'].includes(activeStep.type)}
                <label class="property-label">Entity<select value={activeStep.modelId} onchange={e=>editWorkflowStep('modelId',e.currentTarget.value)}>{#each project.models as m}<option value={m.id}>{m.name}</option>{/each}</select></label>
              {:else if activeStep.type==='navigate'}
                <label class="property-label">Destination page<select value={activeStep.pageId} onchange={e=>editWorkflowStep('pageId',e.currentTarget.value)}>{#each project.pages as p}<option value={p.id}>{p.name}</option>{/each}</select></label>
              {:else if activeStep.type==='message'}
                <label class="property-label">Message<textarea value={activeStep.text} rows="4" onchange={e=>editWorkflowStep('text',e.currentTarget.value)}></textarea></label>
              {:else if activeStep.type==='set_field'}
                <label class="property-label">Form field<select value={activeStep.field} onchange={e=>editWorkflowStep('field',e.currentTarget.value)}>{#each flowFields as field}<option value={field}>{field}</option>{/each}</select></label>
                <label class="property-label">Literal value<input value={activeStep.value} onchange={e=>editWorkflowStep('value',e.currentTarget.value)} /></label>
              {/if}
              {#if activeStep.type==='condition'}
                {#each [['trueId','When true'],['falseId','When false']] as [key,label]}
                  <label class="property-label">{label}<select value={activeStep[key]} onchange={e=>editWorkflowStep(key,e.currentTarget.value)}><option value="">End workflow</option>{#each activeWorkflow.steps.filter(x=>x.id!==activeStepId) as s}<option value={s.id}>{STEP_TYPES.find(x=>x.type===s.type)?.label} · {s.id.slice(-6)}</option>{/each}</select></label>
                {/each}
              {:else if activeStep.type!=='stop'}
                <label class="property-label">Next step<select value={activeStep.nextId} onchange={e=>editWorkflowStep('nextId',e.currentTarget.value)}><option value="">End workflow</option>{#each activeWorkflow.steps.filter(x=>x.id!==activeStepId) as s}<option value={s.id}>{STEP_TYPES.find(x=>x.type===s.type)?.label} · {s.id.slice(-6)}</option>{/each}</select></label>
              {/if}
              <button class="danger page-delete" onclick={deleteWorkflowStep} disabled={activeWorkflow.steps.length===1}>Delete selected step</button>
              <p class="hint">Each step must stay reachable. Rewire its incoming and outgoing paths before removing branches.</p>
            {:else}<p class="hint">Select a workflow step card in the diagram to configure its action and connections.</p>{/if}
          {:else}<p class="hint">Create a workflow to configure its click trigger and actions.</p>{/if}
        </div>
      {:else if selected&&mode==='design'}
        <div class="inspect-body"><div class="selected-info"><div class="selection-icon">{CATALOG.find(x=>x.type===selected.type)?.icon}</div><div><strong>{CATALOG.find(x=>x.type===selected.type)?.label}</strong><small>Component · {selected.type}</small></div></div>
          <div class="section-label">CONFIGURATION</div>
          {#each properties[selected.type] as key}
            <label class="property-label">{key==='targetPageId'?'Navigate to page':key==='bindingModelId'?'Bound entity':key==='bindingFieldId'?'Bound attribute':key.replaceAll(/([A-Z])/g,' $1')}
              {#if key==='required'}<input type="checkbox" checked={Boolean(selected.props[key])} onchange={e=>updateProps(key,e.currentTarget.checked)} />
              {:else if key==='targetPageId'}<select value={String(selected.props[key]??'')} onchange={e=>updateProps(key,e.currentTarget.value)}><option value="">Select destination…</option>{#each project.pages as p}<option value={p.id}>{p.name}</option>{/each}</select>
              {:else if key==='bindingModelId'}<select value={String(selected.props[key]??'')} onchange={e=>updateProps(key,e.currentTarget.value)}><option value="">Unbound</option>{#each project.models as m}<option value={m.id}>{m.name}</option>{/each}</select>
              {:else if key==='bindingFieldId'}<select value={String(selected.props[key]??'')} onchange={e=>updateProps(key,e.currentTarget.value)}><option value="">No attribute</option>{#each (modelIds.get(selected.props.bindingModelId)?.fields??[]) as f}<option value={f.id}>{f.name} · {f.type}</option>{/each}</select>
              {:else if selectOptions[key]}<select value={String(selected.props[key]??'')} onchange={e=>updateProps(key,key==='level'?Number(e.currentTarget.value):e.currentTarget.value)}>{#each selectOptions[key] as [value,label]}<option value={value}>{label}</option>{/each}</select>
              {:else if key==='body'||key==='options'||(key==='text'&&selected.type==='text')}<textarea rows="4" value={String(selected.props[key]??'')} onchange={e=>updateProps(key,e.currentTarget.value)}></textarea>
              {:else}<input type="text" value={String(selected.props[key]??'')} onchange={e=>updateProps(key,e.currentTarget.value)} />{/if}
            </label>
          {/each}
          {#if selected.type==='button'}
            <div class="section-label">ON CLICK</div>
            <p class="hint">{workflowForButton(project,activeId,selected.id)?.name??'Uses the legacy button action until a workflow is connected.'}</p>
            <button class="model-add" onclick={()=>createWorkflowFromButton(activeId,selected.id)}>{workflowForButton(project,activeId,selected.id)?'Edit visual workflow':'+ Create visual workflow'}</button>
          {/if}
          {#if CONTAINER_TYPES.includes(selected.type)}<button class="model-add" onclick={()=>addComponent('text',selected.id)}>+ Add text inside</button>{/if}
          <div class="inspector-buttons"><button onclick={duplicateSelected}>Duplicate</button><button class="danger" onclick={deleteSelected}>Delete</button></div>
          <p class="hint">Drag into a layout on the canvas or click a container in the tree before adding components.</p>
        </div>
      {:else}
        <div class="inspect-body"><div class="section-label">PAGE SETTINGS</div>
          <label class="property-label">Page name<input value={page.name} onchange={e=>safe(p=>p.pages.find(x=>x.id===activeId).name=e.currentTarget.value)} /></label>
          <label class="property-label">Page path<input value={page.path} onchange={e=>safe(p=>p.pages.find(x=>x.id===activeId).path=e.currentTarget.value)} /></label>
          {#if project.pages.length>1}<button class="danger page-delete" onclick={deletePage}>Delete page</button>{/if}
          <p class="hint">{mode==='preview'?'Switch to MySQL (local) to use published models for CRUD. Unpublished projects stay in memory preview.':'Select components from the canvas or the component tree to edit properties.'}</p>
        </div>
      {/if}
    </aside>
  </div>
</div>
