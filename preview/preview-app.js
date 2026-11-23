// Dependency-free editor built from the same model and compilers as the SvelteKit source.
const E=escapeHtml;
const STORE='visual-application-studio-preview-v1';
const PROP_FIELDS={
  section:['title','tone'],columns:['title','tone'],heading:['text','level'],text:['text'],card:['title','body'],divider:[],
  input:['label','field','placeholder','required','bindingModelId','bindingFieldId'],
  textarea:['label','field','placeholder','required','bindingModelId','bindingFieldId'],
  select:['label','field','options','required','bindingModelId','bindingFieldId'],
  checkbox:['label','field','required','bindingModelId','bindingFieldId'],button:['text','variant','action','targetPageId'],table:['title','columns']
};
const PROP_OPTIONS={level:['1','2','3','4'],tone:['plain','muted'],variant:['primary','secondary'],action:['submit','navigate','reset','message']};
let project=createProject(),active=project.pages[0].id,selected='',tab='pages',modelId=project.models[0]?.id||'',fieldId='',mode='design',viewport='desktop',notice='',fields={},records={},history=[],redoStack=[];
try {const saved=localStorage.getItem(STORE);if(saved){project=validateProject(migrateProject(JSON.parse(saved)));active=project.pages[0].id;modelId=project.models[0]?.id||'';}}catch(err){notice='Unable to restore saved project: '+err.message;}
const page=()=>project.pages.find(p=>p.id===active)||project.pages[0];
const node=()=>findNodeLocation(page(),selected)?.node;
const model=()=>project.models.find(m=>m.id===modelId);
const field=()=>model()?.fields.find(f=>f.id===fieldId);
function save(){try{localStorage.setItem(STORE,JSON.stringify(project));}catch(e){notice='Browser autosave unavailable.';}}
function mutate(fn){const next=cloneProject(project);fn(next);validateProject(next);history.push(project);if(history.length>40)history.shift();redoStack=[];project=next;save();render();}
function safe(fn){try{notice='';mutate(fn);return true;}catch(err){notice=err.message;render();return false;}}
function undo(){if(!history.length)return;redoStack.push(project);project=history.pop();selected='';fieldId='';save();render();}
function redo(){if(!redoStack.length)return;history.push(project);project=redoStack.pop();selected='';fieldId='';save();render();}
function pickPage(id){tab='pages';active=id;selected='';fields={};notice='';render();}
function pickModel(id){tab='data';mode='design';modelId=id;fieldId='';notice='';render();}
function add(type,parent='',index){const c=createComponent(type);if(safe(p=>insertNode(p.pages.find(x=>x.id===active),c,parent,index))){selected=c.id;render();}}
function addPage(){const id=createId('page');if(safe(p=>p.pages.push({id,name:`Page ${p.pages.length+1}`,path:`/page-${p.pages.length+1}`,components:[createComponent('heading')]})))pickPage(id);}
function addModel(){const n=project.models.length+1,id=createId('model');if(safe(p=>p.models.push(createModel(`Model ${n}`,`model_${n}`,id))))pickModel(id);}
function addField(){if(!model())return;const f=createField(`field_${model().fields.length+1}`);if(safe(p=>p.models.find(m=>m.id===modelId).fields.push(f))){fieldId=f.id;render();}}
function updateProp(k,value){safe(p=>{const c=findNodeLocation(p.pages.find(x=>x.id===active),selected)?.node;if(!c)throw new Error('Select a component');c.props[k]=value;
  if(k==='bindingModelId'){const f=p.models.find(m=>m.id===value)?.fields.find(x=>!x.primary);c.props.bindingFieldId=f?.id||'';if(f)c.props.field=f.name;}
  if(k==='bindingFieldId'&&value){const f=p.models.find(m=>m.id===c.props.bindingModelId)?.fields.find(x=>x.id===value);if(f)c.props.field=f.name;}
});}
function updateField(k,v){safe(p=>{const f=p.models.find(m=>m.id===modelId).fields.find(x=>x.id===fieldId);f[k]=v;if(k==='type'){f.referenceModelId='';f.referenceFieldId='';}});}
function setRelation(v){safe(p=>{const f=p.models.find(m=>m.id===modelId).fields.find(x=>x.id===fieldId);const [mId,fId]=v.split('|');f.referenceModelId=mId||'';f.referenceFieldId=fId||'';if(mId){const target=p.models.find(m=>m.id===mId).fields.find(x=>x.id===fId);f.type=target.type;f.primary=false;}});}
function download(name,text,type){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),500);}
function play(c){const p=c.props;if(p.action==='navigate'){if(project.pages.some(pg=>pg.id===p.targetPageId))pickPage(p.targetPageId);else notice='Select a destination page in the inspector.';}else if(p.action==='reset'){fields={};notice='Form reset.';}else if(p.action==='message'){notice=`${p.text} clicked.`;}else{const required=[];walkNodes(page().components,x=>{if(['input','textarea','select','checkbox'].includes(x.type)&&x.props.required&&!fields[x.props.field])required.push(x);});if(required.length)notice=`Required: ${required.map(x=>x.props.label).join(', ')}`;else{records[page().id]=[...(records[page().id]||[]),{...fields}];notice=`Preview submission: ${JSON.stringify(fields)}`;}}render();}
function treeHtml(nodes,depth=0){return nodes.map(n=>`<div class="tree-node" style="padding-left:${depth*13}px"><button class="${selected===n.id?'active':''}" data-select="${E(n.id)}"><span class="tree-glyph">${E(CATALOG.find(x=>x.type===n.type)?.icon||'▤')}</span><span class="tree-name">${E(n.props.title||n.props.label||n.props.text||n.type)}</span>${n.children?`<span class="tree-count">${n.children.length}</span>`:''}</button></div>${n.children?treeHtml(n.children,depth+1):''}`).join('');}
function nodeHtml(c){const p=c.props;switch(c.type){
  case 'heading':{const lvl=[1,2,3,4].includes(+p.level)?+p.level:2;return `<h${lvl}>${E(p.text)}</h${lvl}>`;}
  case 'text':return `<p>${E(p.text)}</p>`;
  case 'card':return `<div class="render-card"><h3>${E(p.title)}</h3><p>${E(p.body)}</p></div>`;
  case 'divider':return '<hr>';
  case 'section':case 'columns':return `<section class="layout-box ${c.type==='columns'?'layout-columns':''} ${p.tone==='muted'?'layout-muted':''}"><h3 class="layout-title">${E(p.title)}</h3><div class="layout-children ${c.type==='columns'?'two-col':''}">${canvasHtml(c.children,c.id)}</div></section>`;
  case 'input':case 'textarea':case 'select':{const disabled=mode==='design'?'disabled':'';let control='';if(c.type==='input')control=`<input class="form-input" data-field="${E(p.field)}" placeholder="${E(p.placeholder)}" value="${E(fields[p.field]||'')}" ${disabled}>`;else if(c.type==='textarea')control=`<textarea class="form-input" data-field="${E(p.field)}" rows="3" placeholder="${E(p.placeholder)}" ${disabled}>${E(fields[p.field]||'')}</textarea>`;else control=`<select class="form-input" data-field="${E(p.field)}" ${disabled}><option value="">Select one…</option>${String(p.options||'').split('\n').filter(Boolean).map(opt=>`<option value="${E(opt)}" ${fields[p.field]===opt?'selected':''}>${E(opt)}</option>`).join('')}</select>`;return `<label class="field-label">${E(p.label)}${p.required?'<em> *</em>':''}</label>${control}`;}
  case 'checkbox':return `<label class="checkline"><input type="checkbox" data-field="${E(p.field)}" ${fields[p.field]?'checked':''} ${mode==='design'?'disabled':''}>${E(p.label)}</label>`;
  case 'button':return `<button class="render-button ${p.variant==='secondary'?'secondary':''}" ${mode==='design'?'disabled':''} data-play="${E(c.id)}">${E(p.text)}</button>`;
  case 'table':{const columns=String(p.columns||'').split(',').map(s=>s.trim()).filter(Boolean);return `<div class="table-wrap"><h3>${E(p.title)}</h3><table><thead><tr>${columns.map(x=>`<th>${E(x)}</th>`).join('')}</tr></thead><tbody><tr>${columns.map(x=>`<td class="muted">${E((records[page().id]||[]).at(-1)?.[x.toLowerCase().replaceAll(' ','_')]||'No data yet')}</td>`).join('')}</tr></tbody></table></div>`;}
  default:return '';
}}
function canvasHtml(nodes,parent=''){return nodes.map((c,i)=>`${mode==='design'?`<div class="dropzone" data-drop-parent="${E(parent)}" data-drop-index="${i}"></div>`:''}<div class="component ${mode==='design'?'editable':''} ${selected===c.id&&mode==='design'?'selected':''}" ${mode==='design'?`draggable="true" data-select="${E(c.id)}"`:''}>${mode==='design'?'<span class="draghandle">⠿</span>':''}${nodeHtml(c)}</div>`).join('')+(mode==='design'?`<div class="dropzone last" data-drop-parent="${E(parent)}" data-drop-index="${nodes.length}">Drop a component here</div>`:'');}
function inspector(){if(tab==='data'){
  const m=model(),f=field();if(!m)return '<div class="inspect-body"><p class="hint">Create an entity to start modelling.</p></div>';
  let content='';if(f){const refs=project.models.flatMap(x=>x.fields.filter(a=>a.primary).map(a=>`<option value="${E(x.id+'|'+a.id)}" ${f.referenceModelId===x.id&&f.referenceFieldId===a.id?'selected':''}>${E(x.name+' → '+a.name)}</option>`)).join('');
    content=`<div class="section-label">ATTRIBUTE</div><label class="property-label">Name<input data-fprop="name" value="${E(f.name)}"></label><label class="property-label">Type<select data-fprop="type" ${f.primary||f.referenceModelId?'disabled':''}>${FIELD_TYPES.map(t=>`<option value="${t}" ${f.type===t?'selected':''}>${t}</option>`).join('')}</select></label><label class="property-label">Required<input type="checkbox" data-fprop="required" ${f.required?'checked':''} ${f.primary?'disabled':''}></label><label class="property-label">Unique<input type="checkbox" data-fprop="unique" ${f.unique?'checked':''} ${f.primary?'disabled':''}></label><label class="property-label">References<select data-relation ${f.primary?'disabled':''}><option value="">None</option>${refs}</select></label>${f.primary?'':'<button class="danger page-delete" data-act="delete-field">Delete attribute</button>'}<button class="property-link" data-act="entity-settings">← Entity settings</button>`;
  }else content=`<div class="section-label">ENTITY</div><label class="property-label">Display name<input data-mprop="name" value="${E(m.name)}"></label><label class="property-label">MySQL table<input data-mprop="table" value="${E(m.table)}"></label><button class="model-add" data-act="add-field">+ Add attribute</button><button class="danger page-delete" data-act="delete-model">Delete entity</button><p class="hint">SQL identifiers use lowercase ASCII letters, digits and underscores. Each model has one primary key.</p>`;
  return `<div class="inspect-body"><div class="selected-info"><div class="selection-icon">▦</div><div><strong>${E(m.name)}</strong><small>${f?'Editing attribute':'Entity settings'}</small></div></div>${content}</div>`;
 }
 const c=node();if(!c||mode!=='design')return `<div class="inspect-body"><div class="section-label">PAGE SETTINGS</div><label class="property-label">Page name<input data-pageprop="name" value="${E(page().name)}"></label><label class="property-label">Page path<input data-pageprop="path" value="${E(page().path)}"></label>${project.pages.length>1?'<button class="danger page-delete" data-act="delete-page">Delete page</button>':''}<p class="hint">Select components in the tree or canvas. Preview data is held in memory only.</p></div>`;
 return `<div class="inspect-body"><div class="selected-info"><div class="selection-icon">${E(CATALOG.find(x=>x.type===c.type)?.icon)}</div><div><strong>${E(CATALOG.find(x=>x.type===c.type)?.label)}</strong><small>Component · ${E(c.type)}</small></div></div><div class="section-label">CONFIGURATION</div>${PROP_FIELDS[c.type].map(k=>{
 const v=c.props[k];let control='';if(k==='required')control=`<input data-prop="${k}" type="checkbox" ${v?'checked':''}>`;
 else if(k==='targetPageId')control=`<select data-prop="${k}"><option value="">Select destination…</option>${project.pages.map(p=>`<option value="${E(p.id)}" ${v===p.id?'selected':''}>${E(p.name)}</option>`).join('')}</select>`;
 else if(k==='bindingModelId')control=`<select data-prop="${k}"><option value="">Unbound</option>${project.models.map(m=>`<option value="${E(m.id)}" ${v===m.id?'selected':''}>${E(m.name)}</option>`).join('')}</select>`;
 else if(k==='bindingFieldId')control=`<select data-prop="${k}"><option value="">No attribute</option>${(project.models.find(m=>m.id===c.props.bindingModelId)?.fields||[]).map(f=>`<option value="${E(f.id)}" ${v===f.id?'selected':''}>${E(f.name+' · '+f.type)}</option>`).join('')}</select>`;
 else if(PROP_OPTIONS[k])control=`<select data-prop="${k}">${PROP_OPTIONS[k].map(opt=>`<option value="${opt}" ${String(v)===opt?'selected':''}>${opt}</option>`).join('')}</select>`;
 else if(['body','options'].includes(k)||(k==='text'&&c.type==='text'))control=`<textarea data-prop="${k}" rows="4">${E(v||'')}</textarea>`;
 else control=`<input data-prop="${k}" value="${E(v??'')}">`;
 return `<label class="property-label">${E(k==='bindingModelId'?'Bound entity':k==='bindingFieldId'?'Bound attribute':k.replace(/[A-Z]/g,x=>' '+x))}${control}</label>`;
 }).join('')}${CONTAINER_TYPES.includes(c.type)?'<button class="model-add" data-act="add-text-inside">+ Add text inside</button>':''}<div class="inspector-buttons"><button data-act="duplicate">Duplicate</button><button class="danger" data-act="remove">Delete</button></div><p class="hint">Nested layouts are editable. Drag components between containers or select them from the tree.</p></div>`;
}
function dataHtml(){const relationships=project.models.flatMap(m=>m.fields.filter(f=>f.referenceModelId).map(f=>{const ref=project.models.find(x=>x.id===f.referenceModelId),rf=ref?.fields.find(x=>x.id===f.referenceFieldId);return `<div class="relation-row"><span>${E(m.table+'.'+f.name)}</span><span>→</span><span>${E(ref?.table+'.'+rf?.name)}</span></div>`;})).join('');
 return `<div class="canvas-scroll data-scroll"><div class="data-workspace"><div class="data-intro"><div><small>SCHEMA DESIGNER</small><h2>Data models</h2><p>Define entities, typed attributes, primary keys and foreign-key relationships.</p></div><button class="render-button" data-act="add-model">+ New entity</button></div>${project.models.length?'':'<div class="empty-state">No models yet. Create an entity to begin.</div>'}<div class="model-grid">${project.models.map(m=>`<section class="model-card ${modelId===m.id?'model-active':''}"><button class="model-header" data-model="${E(m.id)}"><div><small>ENTITY</small><strong>${E(m.name)}</strong><code>${E(m.table)}</code></div><span>▦</span></button><div class="model-fields">${m.fields.map(f=>`<button data-field-select="${E(m.id+'|'+f.id)}" class="${modelId===m.id&&fieldId===f.id?'field-active':''}"><span class="field-name">${f.primary?'◆':f.referenceModelId?'↗':'∙'} ${E(f.name)}</span><span class="field-type">${E(f.type)}${f.required?' · required':''}</span></button>`).join('')}</div><div class="model-footer"><span>${m.fields.length} fields</span><button data-add-field-model="${E(m.id)}">+ Field</button></div></section>`).join('')}</div><div class="relationship-panel"><h3>Relationships</h3>${relationships||'<p>No foreign keys defined yet.</p>'}<p>Foreign keys are generated after table creation, permitting cross-references.</p></div>${notice?`<div class="feedback" role="status">${E(notice)}</div>`:''}</div></div>`;
}
function render(){document.getElementById('app').innerHTML=`<div class="studio"><header class="topbar"><div class="identity"><span class="logo">◧</span><div><strong>Visual Application Studio</strong><small>Visual app building · alpha 0.2</small></div></div><div class="project"><span class="status-dot"></span><input aria-label="Project name" data-project-name value="${E(project.name)}"></div><nav class="actions"><button data-act="undo" ${history.length?'':'disabled'} title="Undo">↶</button><button data-act="redo" ${redoStack.length?'':'disabled'} title="Redo">↷</button><button data-act="import">Import</button><button data-act="export-json">Save JSON</button><button data-act="export-svelte">Export UI</button><button data-act="export-sql">Export SQL</button></nav><input type="file" class="hidden" id="import-file" accept=".json,application/json"></header><div class="workspace"><aside class="sidebar"><div class="workspace-switch"><button class="${tab==='pages'?'active':''}" data-tab="pages">Pages & tree</button><button class="${tab==='data'?'active':''}" data-tab="data">Data models</button></div>${tab==='pages'?`<div class="sidebar-head"><span>PAGES</span><button data-act="add-page">+</button></div><div class="project-tree">${project.pages.map(p=>`<button data-page="${E(p.id)}" class="${active===p.id?'active':''}"><span>▤</span>${E(p.name)}</button>`).join('')}</div><div class="sidebar-head"><span>COMPONENT TREE</span><small>${page().components.length} root items</small></div><div class="component-tree">${treeHtml(page().components)}</div><div class="sidebar-head toolbox-title"><span>COMPONENTS</span><small>Drag or click to add</small></div><div class="toolbox">${['Layout','Content','Form controls','Actions','Data display'].map(g=>`<div class="group-label">${g}</div><div class="tool-grid">${CATALOG.filter(c=>c.group===g).map(c=>`<button class="tool" draggable="true" data-new="${c.type}"><span class="tool-icon">${E(c.icon)}</span>${E(c.label)}</button>`).join('')}</div>`).join('')}</div>`:`<div class="sidebar-head"><span>DATA ENTITIES</span><button data-act="add-model">+</button></div><div class="project-tree">${project.models.map(m=>`<button data-model="${E(m.id)}" class="${modelId===m.id?'active':''}"><span>▦</span>${E(m.name)}<small>${m.fields.length} fields</small></button>`).join('')}</div><p class="sidebar-note">Define typed fields and relationships, then export MySQL DDL.</p>`}</aside><main class="workarea"><div class="canvasbar"><div class="breadcrumbs">${E(project.name)} <span>/</span> <b>${E(tab==='pages'?page().name:'Data model')}</b>${tab==='pages'?`<span class="path">${E(page().path)}</span>`:''}</div>${tab==='pages'?`<div class="canvas-tools"><div class="segment"><button class="${viewport==='desktop'?'chosen':''}" data-viewport="desktop">▣</button><button class="${viewport==='mobile'?'chosen':''}" data-viewport="mobile">▯</button></div><div class="segment"><button class="${mode==='design'?'chosen':''}" data-mode="design">Design</button><button class="${mode==='preview'?'chosen':''}" data-mode="preview">▶ Preview</button></div></div>`:'<div class="canvas-tools"><span class="data-caption">Logical model → MySQL schema</span><button class="model-add" data-act="add-model">+ Entity</button></div>'}</div>${tab==='pages'?`<div class="canvas-scroll"><div class="page-shell ${viewport==='mobile'?'mobile':''}"><div class="page-heading"><div><small>APPLICATION PAGE</small><h2>${E(page().name)}</h2></div><span>${mode==='design'?'DESIGN CANVAS':'LIVE PREVIEW'}</span></div><div class="page-content">${canvasHtml(page().components)}${notice?`<div class="feedback" role="status">${E(notice)}</div>`:''}</div></div></div>`:dataHtml()}<div class="statusbar"><span>● Project autosaved in browser</span><span>${project.pages.length} pages · ${project.models.length} models</span></div></main><aside class="inspector"><div class="inspector-title"><span>${tab==='data'?'DATA PROPERTIES':'PROPERTIES'}</span><span class="inspect-icon">⚙</span></div>${inspector()}</aside></div></div>`;}
const root=document.getElementById('app');
root.addEventListener('click',e=>{
  const el=e.target.closest('[data-act],[data-tab],[data-page],[data-model],[data-field-select],[data-add-field-model],[data-new],[data-mode],[data-viewport],[data-select],[data-play]');
  if(!el)return;const d=el.dataset;
  if(d.tab){tab=d.tab;if(tab==='data'){mode='design';selected='';}render();return;}
  if(d.page){pickPage(d.page);return;}
  if(d.model){pickModel(d.model);return;}
  if(d.fieldSelect){[modelId,fieldId]=d.fieldSelect.split('|');render();return;}
  if(d.addFieldModel){modelId=d.addFieldModel;fieldId='';addField();return;}
  if(d.new){add(d.new,node()&&CONTAINER_TYPES.includes(node().type)?selected:'');return;}
  if(d.mode){mode=d.mode;selected='';notice='';render();return;}
  if(d.viewport){viewport=d.viewport;render();return;}
  if(d.play&&mode==='preview'){const n=findNodeLocation(page(),d.play)?.node;if(n)play(n);return;}
  if(d.select&&mode==='design'){selected=d.select;render();return;}
  switch(d.act){
    case 'undo':undo();break;case 'redo':redo();break;case 'add-page':addPage();break;case 'add-model':addModel();break;case 'add-field':addField();break;
    case 'entity-settings':fieldId='';render();break;
    case 'delete-page':if(project.pages.length>1&&safe(p=>p.pages=p.pages.filter(x=>x.id!==active)))pickPage(project.pages[0].id);break;
    case 'remove':if(safe(p=>removeNode(p.pages.find(x=>x.id===active),selected))){selected='';render();}break;
    case 'duplicate':{if(!node())break;const copy=duplicateNode(node());if(safe(p=>{const pg=p.pages.find(x=>x.id===active),loc=findNodeLocation(pg,selected);insertNode(pg,copy,loc.parentId,loc.index+1);})){selected=copy.id;render();}break;}
    case 'add-text-inside':add('text',selected);break;
    case 'delete-model':if(safe(p=>p.models=p.models.filter(m=>m.id!==modelId))){modelId=project.models[0]?.id||'';fieldId='';render();}break;
    case 'delete-field':if(field()&&!field().primary&&safe(p=>{const m=p.models.find(x=>x.id===modelId);m.fields=m.fields.filter(f=>f.id!==fieldId);})) {fieldId='';render();}break;
    case 'export-json':download('application.project.json',JSON.stringify(project,null,2),'application/json');break;
    case 'export-svelte':download('generated-page.svelte',exportPageToSvelte(page()),'text/plain');break;
    case 'export-sql':try{download('schema.mysql.sql',exportMySQL(project),'text/plain');notice='SQL exported. Review before applying.';}catch(err){notice=err.message;}render();break;
    case 'import':document.getElementById('import-file').click();break;
  }
});
root.addEventListener('change',async e=>{
  const d=e.target.dataset;
  if(e.target.id==='import-file'){
    const f=e.target.files?.[0];if(!f)return;
    try {const data=validateProject(migrateProject(JSON.parse(await f.text())));
      if(safe(p=>{for(const k of Object.keys(p))delete p[k];Object.assign(p,data);})){active=data.pages[0].id;modelId=data.models[0]?.id||'';fieldId='';selected='';tab='pages';notice='Project imported successfully.';}}
    catch(err){notice=`Import failed: ${err.message}`;}render();return;
  }
  if(d.projectName!==undefined)safe(p=>p.name=e.target.value);
  else if(d.pageprop)safe(p=>p.pages.find(x=>x.id===active)[d.pageprop]=e.target.value);
  else if(d.mprop)safe(p=>p.models.find(x=>x.id===modelId)[d.mprop]=e.target.value);
  else if(d.fprop)updateField(d.fprop,e.target.type==='checkbox'?e.target.checked:e.target.value);
  else if(d.relation!==undefined)setRelation(e.target.value);
  else if(d.prop)updateProp(d.prop,e.target.type==='checkbox'?e.target.checked:d.prop==='level'?Number(e.target.value):e.target.value);
  else if(d.field!==undefined)fields[d.field]=e.target.type==='checkbox'?e.target.checked:e.target.value;
});
root.addEventListener('input',e=>{if(e.target.dataset.field!==undefined)fields[e.target.dataset.field]=e.target.value;});
root.addEventListener('dragstart',e=>{const tool=e.target.closest('[data-new]'),comp=e.target.closest('[data-select]');if(tool)e.dataTransfer.setData('text/plain',`new:${tool.dataset.new}`);else if(comp)e.dataTransfer.setData('text/plain',`move:${comp.dataset.select}`);});
root.addEventListener('dragover',e=>{if(e.target.closest('[data-drop-index]'))e.preventDefault();});
root.addEventListener('drop',e=>{const zone=e.target.closest('[data-drop-index]');if(!zone)return;e.preventDefault();e.stopPropagation();const index=+zone.dataset.dropIndex,parent=zone.dataset.dropParent||'',tag=e.dataTransfer.getData('text/plain');if(tag.startsWith('new:')){const type=tag.slice(4);if(CATALOG.some(x=>x.type===type))add(type,parent,index);}else if(tag.startsWith('move:'))safe(p=>moveNode(p.pages.find(x=>x.id===active),tag.slice(5),parent,index));});
render();
