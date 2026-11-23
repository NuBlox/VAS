#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateProject } from '../src/lib/studio/model.js';
import { validatePublication, releaseId } from '../src/lib/server/runtime/publication.js';
import { exportMySQL } from '../src/lib/studio/compiler.js';
import { projectRevision } from '../src/lib/studio/revision.js';
const root=resolve(import.meta.dirname,'..');
const read=async name=>readFile(resolve(root,name),'utf8');
try {
  const release=JSON.parse(await read('release.json'));
  const project=validateProject(JSON.parse(await read('runtime/project.json')));
  const manifest=JSON.parse(await read('runtime/publication.json'));
  validatePublication(project,manifest);
  if(release?.kind!=='vas-standalone-release'||release?.version!==1||release.projectId!==project.id||release.releaseId!==releaseId(project)||release.editorRevision!==projectRevision(project)||release.runtimeExposure!=='loopback-development-only')throw Error('Exported release identity differs from its published model');
  const snapshot=JSON.parse(await read(`runtime/releases/${release.releaseId}.json`));
  if(releaseId(snapshot)!==release.releaseId)throw Error('Immutable release snapshot is invalid');
  if(await read('db/initial.mysql.sql')!==exportMySQL(project))throw Error('Initial MySQL schema differs from the release model');
  console.log(`Verified standalone release ${release.releaseId} (${project.pages.length} pages, ${project.models.length} models).`);
} catch (error) {console.error(`Release verification failed: ${error.message}`);process.exitCode=1;}
