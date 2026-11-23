import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestDirectory, promoteRelease, rollbackRelease, stageRelease, status, validateProfile } from '../scripts/deploy/core.mjs';

const local = { version: 1, environment: 'local', mode: 'local-development', bindHost: '127.0.0.1' };
const staging = { ...local, environment: 'staging' };
const h = c => c.repeat(64);
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'vas-deploy-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = join(home, 'source'), store = join(home, 'store');
  await mkdir(join(source, 'src'), { recursive: true });
  async function release(id) {
    await writeFile(join(source, 'release.json'), JSON.stringify({
      kind: 'vas-standalone-release', releaseId: id, runtimeExposure: 'loopback-development-only'
    }));
    await writeFile(join(source, 'src', 'app.txt'), id);
  }
  await release(h('a'));
  return { home, source, store, release };
}
const verifySource = async source => assert.ok(source.includes('source'));

test('stage, promote, activate a new release and roll back to prior release', async t => {
  const f = await fixture(t);
  const first = await stageRelease({ ...f, verifySource });
  assert.equal(first.releaseId, h('a'));
  assert.equal(first.alreadyStaged, false);
  assert.equal((await stageRelease({ ...f, verifySource })).alreadyStaged, true);
  assert.equal((await status({ store: f.store, environment: 'local' })).active, null);
  const s1 = await promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local });
  assert.equal(s1.active, h('a'));
  assert.equal(s1.revision, 1);
  await f.release(h('b'));
  await stageRelease({ ...f, verifySource });
  const s2 = await promoteRelease({ store: f.store, environment: 'local', to: h('b'), expect: h('a'), profile: local });
  assert.equal(s2.active, h('b'));
  assert.equal(s2.history.length, 2);
  const s3 = await rollbackRelease({ store: f.store, environment: 'local', to: h('a'), expect: h('b'), profile: local });
  assert.equal(s3.active, h('a'));
  assert.equal(s3.history[2].action, 'rollback');
  assert.equal(s3.history[2].from, h('b'));
});

test('rejects stale activation, invalid rollback and unsafe public-facing profiles', async t => {
  const f = await fixture(t);
  await stageRelease({ ...f, verifySource });
  await assert.rejects(promoteRelease({ store: f.store, environment: 'production', to: h('a'), expect: 'none', profile: local }), /Unsupported environment/);
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: { ...local, DB_PASSWORD: 'secret' } }), /permits only/);
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: { ...local, bindHost: '0.0.0.0' } }), /loopback-only/);
  await assert.rejects(rollbackRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local }), /No active/);
  await promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local });
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local }), /Stale deployment/);
  assert.deepEqual(validateProfile(staging, 'staging'), staging);
});

test('detects tampered source in stored artifacts before activation', async t => {
  const f = await fixture(t);
  await stageRelease({ ...f, verifySource });
  await writeFile(join(f.store, 'artifacts', h('a'), 'source', 'src', 'app.txt'), 'tampered');
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local }), /changed since staging/);
});

test('excludes .env secrets, dependency files and local policy and rejects symlinks', async t => {
  const f = await fixture(t);
  await writeFile(join(f.source, '.env'), 'secret');
  await writeFile(join(f.source, '.env.production'), 'secret');
  await mkdir(join(f.source, 'node_modules'));
  await writeFile(join(f.source, 'node_modules', 'secret.txt'), 'secret');
  await writeFile(join(f.source, 'policy.local.json'), 'secret');
  await stageRelease({ ...f, verifySource });
  const names = (await digestDirectory(join(f.store, 'artifacts', h('a'), 'source'))).files.map(x => x.path);
  assert.deepEqual(names.sort(), ['release.json', 'src/app.txt'].sort());
  await symlink(join(f.source, '.env'), join(f.source, 'src', 'unsafe-link'));
  await assert.rejects(stageRelease({ ...f, verifySource }), /Unsupported entry/);
});

test('rejects nested stores and changed code with reused release ID', async t => {
  const f = await fixture(t);
  await assert.rejects(stageRelease({ source: f.source, store: join(f.source, 'store'), verifySource }), /Store cannot be inside/);
  await assert.rejects(stageRelease({ source: f.source, store: f.home, verifySource }), /Store cannot be equal/);
  await stageRelease({ ...f, verifySource });
  await writeFile(join(f.source, 'src', 'app.txt'), 'modified content');
  await assert.rejects(stageRelease({ ...f, verifySource }), /same release ID has different source/i);
});

test('concurrent promotion cannot satisfy the same expected active version twice', async t => {
  const f = await fixture(t);
  await stageRelease({ ...f, verifySource });
  const p = { store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local };
  const results = await Promise.allSettled([promoteRelease(p), promoteRelease(p)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal((await status({ store: f.store, environment: 'local' })).revision, 1);
});
