#!/usr/bin/env node
/** A deterministic metadata fixture for CI's generated-app compilation. */
import { writeFile } from 'node:fs/promises';
import { createProject, saveComponentTemplate, insertLinkedTemplate, exposeTemplateInput,
  exposeTemplateSlot, setLinkedInput, bindLinkedInput, appendLinkedSlotNode,
  updateLinkedSlotNode, validateProject } from '../src/lib/studio/model.js';
const output=process.argv[2];
if(!output||process.argv.length!==3){console.error('Usage: node scripts/generate-composition-fixture.mjs /absolute/path.json');process.exit(2);}
const p=createProject(),template=saveComponentTemplate(p,p.pages[0].components[1],'Customer summary','template_customer_summary');
exposeTemplateInput(p,template.id,template.node.children[0].id,'text','summary');
exposeTemplateInput(p,template.id,template.node.children[1].id,'title','selected_name');
exposeTemplateSlot(p,template.id,template.node.id,'details');
const first=insertLinkedTemplate(p,template.id,p.pages[1].id);
setLinkedInput(p,p.pages[1].id,first.id,'summary','Customer input form');
bindLinkedInput(p,p.pages[1].id,first.id,'selected_name',{source:'form',field:'name'});
const title=appendLinkedSlotNode(p,p.pages[1].id,first.id,'details','card');
updateLinkedSlotNode(p,p.pages[1].id,first.id,'details',title.id,{title:'Customer details',body:'This content belongs only to this instance.'});
validateProject(p);
await writeFile(output,JSON.stringify(p,null,2)+'\n');
console.log(`Composed fixture written to ${output}`);
