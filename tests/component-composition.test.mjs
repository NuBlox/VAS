import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createProject, createComponent, cloneProject, saveComponentTemplate, insertLinkedTemplate,
  exposeTemplateInput, removeTemplateInput, setLinkedInput, bindLinkedInput,
  clearLinkedInputBinding, exposeTemplateSlot, appendLinkedSlotNode, updateLinkedSlotNode,
  removeLinkedSlotNode, clearLinkedSlot, renderPageComponents,
  editMasterProperties, detachLinkedInstance, validateProject, walkNodes
} from '../src/lib/studio/model.js';

function setup(){
  const p=createProject();
  const master=p.pages[0].components[1]; // section with text and card
  const template=saveComponentTemplate(p,master,'Customer header','template_customer_header');
  const first=insertLinkedTemplate(p,template.id,p.pages[1].id);
  const second=insertLinkedTemplate(p,template.id,p.pages[0].id);
  return {p,template,first,second};
}
function nodeByMaster(root,masterId){let result;walkNodes([root],n=>{if(n.sourceTemplateNodeId===masterId)result=n;});return result;}

test('typed public inputs propagate across instances with independent overrides and master changes',()=>{
  const {p,template,first,second}=setup();
  const target=template.node.children[0];
  exposeTemplateInput(p,template.id,target.id,'text','headline');
  assert.equal(validateProject(p),p);
  setLinkedInput(p,p.pages[1].id,first.id,'headline','Customer A');
  editMasterProperties(p,template.id,target.id,{text:'Shared default'});
  assert.equal(nodeByMaster(first,target.id).props.text,'Customer A');
  assert.equal(nodeByMaster(second,target.id).props.text,'Shared default');
  assert.equal(renderPageComponents(p,p.pages[1]).at(-1).children[0].props.text,'Customer A');
  assert.equal(validateProject(p),p);
  removeTemplateInput(p,template.id,'headline');
  assert.equal(nodeByMaster(first,target.id).props.text,'Shared default');
  assert.equal(validateProject(p),p);
});

test('form bindings are typed, resolve only at render time and never persist user data',()=>{
  const {p,template,first}=setup();
  const child=template.node.children[0];
  exposeTemplateInput(p,template.id,child.id,'text','headline');
  bindLinkedInput(p,p.pages[1].id,first.id,'headline',{source:'form',field:'name'});
  const stored=cloneProject(p);
  const rendered=renderPageComponents(p,p.pages[1],{fields:{name:'Ada <script>'}});
  assert.equal(rendered.at(-1).children[0].props.text,'Ada <script>');
  assert.deepEqual(p,stored,'runtime values must never mutate the published project');
  assert.equal(validateProject(p),p);
  assert.throws(()=>bindLinkedInput(p,p.pages[1].id,first.id,'headline',{source:'form',field:'missing'}),/form binding/);
  assert.throws(()=>setLinkedInput(p,p.pages[1].id,first.id,'headline',42),/Typed/);
  const malformed=cloneProject(p);malformed.pages[1].components.at(-1).inputBindings.headline.field='not_a_field';
  assert.throws(()=>validateProject(malformed),/form binding/);
  clearLinkedInputBinding(p,p.pages[1].id,first.id,'headline');
  assert.equal(validateProject(p),p);
});

test('selected-record bindings use model field types and selected primary key',()=>{
  const {p,template,first}=setup();
  const target=template.node.children[1];
  exposeTemplateInput(p,template.id,target.id,'title','record_title');
  bindLinkedInput(p,p.pages[1].id,first.id,'record_title',{source:'record',modelId:'model_customer',fieldId:'field_customer_name'});
  const page=renderPageComponents(p,p.pages[1],{
    records:{model_customer:[{id:8,name:'Ada'},{id:9,name:'Grace'}]},
    selected:{model_customer:9}
  });
  assert.equal(page.at(-1).children[1].props.title,'Grace');
  assert.equal(renderPageComponents(p,p.pages[1]).at(-1).children[1].props.title,target.props.title);
  assert.throws(()=>bindLinkedInput(p,p.pages[1].id,first.id,'record_title',{source:'record',modelId:'model_customer',fieldId:'field_customer_id'}),/record binding/);
  assert.equal(validateProject(p),p);
});

test('named slot content is independent per instance and detaching preserves the resolved content',()=>{
  const {p,template,first,second}=setup();
  exposeTemplateSlot(p,template.id,template.node.id,'details');
  const custom=appendLinkedSlotNode(p,p.pages[1].id,first.id,'details','heading');
  updateLinkedSlotNode(p,p.pages[1].id,first.id,'details',custom.id,{text:'Special customer'});
  const rendered=renderPageComponents(p,p.pages[1]);
  assert.equal(rendered.at(-1).children[0].props.text,'Special customer');
  assert.equal(renderPageComponents(p,p.pages[0]).at(-1).children[0].props.text,template.node.children[0].props.text);
  assert.equal(validateProject(p),p);
  const clone=cloneProject(p);
  clone.pages[1].components.at(-1).slotFills.details[0].id=p.pages[1].components[0].id;
  assert.throws(()=>validateProject(clone),/Duplicate slot content/);
  detachLinkedInstance(p.pages[1],first.id,p);
  assert.equal(first.children[0].props.text,'Special customer');
  assert.equal(first.sourceTemplateId,undefined);
  assert.equal(validateProject(p),p);
  clearLinkedSlot(p,p.pages[0].id,second.id,'details');
  assert.equal(validateProject(p),p);
});

test('slot elements remain editable without replacing unrelated sibling IDs',()=>{
  const {p,template,first}=setup();
  exposeTemplateSlot(p,template.id,template.node.id,'footer');
  const a=appendLinkedSlotNode(p,p.pages[1].id,first.id,'footer','text');
  const b=appendLinkedSlotNode(p,p.pages[1].id,first.id,'footer','card');
  updateLinkedSlotNode(p,p.pages[1].id,first.id,'footer',b.id,{title:'Account details'});
  assert.equal(first.slotFills.footer[0].id,a.id);
  assert.equal(first.slotFills.footer[1].props.title,'Account details');
  removeLinkedSlotNode(p,p.pages[1].id,first.id,'footer',a.id);
  assert.equal(first.slotFills.footer.length,1);
  assert.equal(first.slotFills.footer[0].id,b.id);
  clearLinkedSlot(p,p.pages[1].id,first.id,'footer');
  assert.equal(renderPageComponents(p,p.pages[1]).at(-1).children.length,template.node.children.length);
  assert.equal(validateProject(p),p);
});

test('malformed interfaces, unsafe bound props and duplicate slot names fail validation',()=>{
  const {p,template,first}=setup();
  const target=template.node.children[0];
  assert.throws(()=>exposeTemplateInput(p,template.id,target.id,'bindingModelId','internal_db'),/target/);
  assert.throws(()=>exposeTemplateInput(p,template.id,target.id,'text','Invalid Case'),/name/);
  exposeTemplateInput(p,template.id,target.id,'text','title');
  assert.throws(()=>exposeTemplateInput(p,template.id,target.id,'text','other'),/Duplicate/);
  exposeTemplateSlot(p,template.id,template.node.id,'footer');
  assert.throws(()=>exposeTemplateSlot(p,template.id,template.node.id,'footer2'),/Duplicate/);
  assert.throws(()=>appendLinkedSlotNode(p,p.pages[1].id,first.id,'footer','button'),/type/);
  const wrong=cloneProject(p);wrong.templates[0].inputs[0].prop='action';
  assert.throws(()=>validateProject(wrong),/template input/);
  const bogus=cloneProject(p);bogus.pages[1].components.at(-1).inputValues={title:false};
  assert.throws(()=>validateProject(bogus),/typed component/);
});

test('standalone exports preserve typed inputs and named slot content with runtime resolver',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vas-compose-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const {p,template,first}=setup();
  exposeTemplateInput(p,template.id,template.node.children[0].id,'text','welcome');
  setLinkedInput(p,p.pages[1].id,first.id,'welcome','Hello from the export');
  exposeTemplateSlot(p,template.id,template.node.id,'footer');
  appendLinkedSlotNode(p,p.pages[1].id,first.id,'footer','card');
  const projectPath=join(dir,'project.json');await writeFile(projectPath,JSON.stringify(p));
  const output=join(dir,'export');const script=resolve(import.meta.dirname,'../scripts/export-application.mjs');
  const run=spawnSync(process.execPath,[script,'--project',projectPath,'--out',output],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const exported=JSON.parse(await readFile(join(output,'runtime/project.json'),'utf8'));
  assert.deepEqual(exported.templates,p.templates);
  assert.equal(exported.pages[1].components.at(-1).slotFills.footer[0].type,'card');
  const renderer=await readFile(join(output,'src/lib/StandaloneApp.svelte'),'utf8');
  assert.match(renderer,/renderPageComponents/);
  const verification=spawnSync(process.execPath,['scripts/verify-release.mjs'],{cwd:output,encoding:'utf8'});
  assert.equal(verification.status,0,verification.stderr);
});
