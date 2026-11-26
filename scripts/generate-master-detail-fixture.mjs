#!/usr/bin/env node
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createAcceptanceProject} from './generate-customer-order-acceptance.mjs';
import {scaffoldMasterDetail} from '../src/lib/studio/master-detail.js';
import {validateProject} from '../src/lib/studio/model.js';
const output=process.argv[2];
if(!output||output.startsWith('--'))throw Error('Usage: node scripts/generate-master-detail-fixture.mjs /absolute/project.json');
const project=createAcceptanceProject();
const customer=project.models.find(m=>m.name==='Customer'),order=project.models.find(m=>m.name==='Order');
const fk=order.fields.find(f=>f.referenceModelId===customer.id);
const relation=scaffoldMasterDetail(project,customer.id,order.id,fk.id);
validateProject(project);
await writeFile(resolve(output),JSON.stringify(project,null,2)+'\n',{flag:'wx'});
console.log(`Generated ${project.name} with ${project.pages.length} pages; master-detail route ${relation.route}`);
