import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateProject } from '../src/lib/studio/model.js';
import { releaseId } from '../src/lib/server/runtime/publication.js';
test('generated application release is independently verifiable', () => {
  const root=resolve(import.meta.dirname,'..');
  execFileSync(process.execPath,['scripts/verify-release.mjs'],{cwd:root});
  const app=validateProject(JSON.parse(readFileSync(resolve(root,'runtime/project.json'),'utf8')));
  const release=JSON.parse(readFileSync(resolve(root,'release.json'),'utf8'));
  assert.equal(release.releaseId,releaseId(app));
  assert.ok(app.pages.length>0);
});
