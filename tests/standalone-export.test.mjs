import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { releaseId } from '../src/lib/server/runtime/publication.js';
import { createProject } from '../src/lib/studio/model.js';

const exporter=resolve(import.meta.dirname,'../scripts/export-application.mjs');
function run(args,cwd){return spawnSync(process.execPath,[exporter,...args],{cwd,encoding:'utf8'});}
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));

test('exports independent, verifiable SvelteKit application with runtime routes and guarded DDL',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vas-export-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const dest=join(dir,'app');const result=run(['--out',dest],dir);
  assert.equal(result.status,0,result.stderr);
  const snapshot=await readJSON(join(dest,'runtime/project.json'));
  const release=await readJSON(join(dest,'release.json'));
  assert.equal(release.releaseId,releaseId(snapshot));
  assert.equal(release.runtimeExposure,'loopback-development-only');
  assert.ok((await readFile(join(dest,'src/lib/StandaloneApp.svelte'),'utf8')).includes('RenderNode'));
  assert.ok((await readFile(join(dest,'src/lib/server/runtime/config.js'),'utf8')).includes('loopbackClients'));
  assert.ok((await readFile(join(dest,'src/routes/api/runtime/workflows/[workflowId]/+server.js'),'utf8')).includes('executePublishedWorkflow'));
  await assert.rejects(access(join(dest,'src/routes/+page.svelte.nonexistent')));
  await assert.rejects(access(join(dest,'src/routes/+page.svelte.from-editor')));
  assert.equal(spawnSync(process.execPath,['scripts/verify-release.mjs'],{cwd:dest}).status,0);
  assert.equal(run(['--out',dest],dir).status,1,'must never overwrite existing export');
  const sql=await readFile(join(dest,'db/initial.mysql.sql'),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS/);
  await writeFile(join(dest,'runtime/project.json'),'{}');
  assert.notEqual(spawnSync(process.execPath,['scripts/verify-release.mjs'],{cwd:dest}).status,0,'tampered release must fail');
});

test('supports explicit project exports and refuses unsafe paths',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'vas-path-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const project=createProject();
  project.pages[0].path='/overview';
  const file=join(dir,'custom.json');await writeFile(file,JSON.stringify(project));
  assert.equal(run(['--project',file,'--out',join(dir,'custom')],dir).status,0);
  const bad=createProject();bad.pages[0].path='/api/override';
  await writeFile(file,JSON.stringify(bad));
  assert.notEqual(run(['--project',file,'--out',join(dir,'invalid')],dir).status,0);
  await assert.rejects(access(join(dir,'invalid')));
  bad.pages[0].path='/';bad.pages[1].path='/';await writeFile(file,JSON.stringify(bad));
  assert.notEqual(run(['--project',file,'--out',join(dir,'duplicate')],dir).status,0);
  assert.notEqual(run(['--release','0'.repeat(64),'--out',join(dir,'missing')],dir).status,0);
});
