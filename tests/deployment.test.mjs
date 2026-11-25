import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestDirectory, promoteRelease, rollbackRelease, stageRelease as rawStageRelease, signRelease, activateRelease, validateActivation, status, validateProfile } from '../scripts/deploy/core.mjs';
import { signArtifact, verifyArtifactSignature, generatePublisherKeys } from '../scripts/deploy/signing.mjs';
import { generateKeyPairSync } from 'node:crypto';

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
  const keys=generateKeyPairSync('ed25519');
  const privatePem=keys.privateKey.export({type:'pkcs8',format:'pem'});
  const trustedPublicPem=keys.publicKey.export({type:'spki',format:'pem'});
  return { home, source, store, release, privatePem, trustedPublicPem };
}
const verifySource = async source => assert.ok(source.includes('source'));
async function stageRelease(args){
  const staged=await rawStageRelease(args);
  await signRelease({store:args.store,releaseId:staged.releaseId,privatePem:args.privatePem});
  return staged;
}

test('stage, promote, activate a new release and roll back to prior release', async t => {
  const f = await fixture(t);
  const first = await stageRelease({ ...f, verifySource });
  assert.equal(first.releaseId, h('a'));
  assert.equal(first.alreadyStaged, false);
  assert.equal((await stageRelease({ ...f, verifySource })).alreadyStaged, true);
  assert.equal((await status({ store: f.store, environment: 'local', trustedPublicPem:f.trustedPublicPem })).active, null);
  const s1 = await promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local, trustedPublicPem:f.trustedPublicPem });
  assert.equal(s1.active, h('a'));
  assert.equal(s1.revision, 1);
  await f.release(h('b'));
  await stageRelease({ ...f, verifySource });
  const s2 = await promoteRelease({ store: f.store, environment: 'local', to: h('b'), expect: h('a'), profile: local, trustedPublicPem:f.trustedPublicPem });
  assert.equal(s2.active, h('b'));
  assert.equal(s2.history.length, 2);
  const s3 = await rollbackRelease({ store: f.store, environment: 'local', to: h('a'), expect: h('b'), profile: local, trustedPublicPem:f.trustedPublicPem });
  assert.equal(s3.active, h('a'));
  assert.equal(s3.history[2].action, 'rollback');
  assert.equal(s3.history[2].from, h('b'));
});

test('rejects stale activation, invalid rollback and unsafe public-facing profiles', async t => {
  const f = await fixture(t);
  await stageRelease({ ...f, verifySource });
  await assert.rejects(promoteRelease({ store: f.store, environment: 'production', to: h('a'), expect: 'none', profile: local, trustedPublicPem:f.trustedPublicPem }), /Unsupported environment/);
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: { ...local, DB_PASSWORD: 'secret' } }), /permits only/);
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: { ...local, bindHost: '0.0.0.0' } }), /loopback-only/);
  await assert.rejects(rollbackRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local, trustedPublicPem:f.trustedPublicPem }), /No active/);
  await promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local, trustedPublicPem:f.trustedPublicPem });
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local, trustedPublicPem:f.trustedPublicPem }), /Stale deployment/);
  assert.deepEqual(validateProfile(staging, 'staging'), staging);
});

test('detects tampered source in stored artifacts before activation', async t => {
  const f = await fixture(t);
  await stageRelease({ ...f, verifySource });
  await writeFile(join(f.store, 'artifacts', h('a'), 'source', 'src', 'app.txt'), 'tampered');
  await assert.rejects(promoteRelease({ store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local, trustedPublicPem:f.trustedPublicPem }), /changed since staging/);
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
  const p = { store: f.store, environment: 'local', to: h('a'), expect: 'none', profile: local, trustedPublicPem:f.trustedPublicPem };
  const results = await Promise.allSettled([promoteRelease(p), promoteRelease(p)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal((await status({ store: f.store, environment: 'local', trustedPublicPem:f.trustedPublicPem })).revision, 1);
});

test('Ed25519 provenance rejects unknown keys, modified signatures and unsigned candidates',async t=>{
  const f=await fixture(t);
  await rawStageRelease({...f,verifySource});
  await assert.rejects(promoteRelease({store:f.store,environment:'local',to:h('a'),expect:'none',profile:local,trustedPublicPem:f.trustedPublicPem}),/Unsigned release/);
  const proof=await signRelease({store:f.store,releaseId:h('a'),privatePem:f.privatePem});
  const manifest=JSON.parse(await readFile(join(f.store,'artifacts',h('a'),'artifact.json'),'utf8'));
  assert.equal(verifyArtifactSignature(manifest,proof,f.trustedPublicPem),proof.publisherFingerprint);
  const intruder=generateKeyPairSync('ed25519');
  const intruderPem=intruder.publicKey.export({format:'pem',type:'spki'});
  await assert.rejects(promoteRelease({store:f.store,environment:'local',to:h('a'),expect:'none',profile:local,trustedPublicPem:intruderPem}),/not signed by the configured publisher/);
  assert.throws(()=>verifyArtifactSignature(manifest,{...proof,signature:proof.signature.replace(/^./,proof.signature[0]==='A'?'B':'A')},f.trustedPublicPem),/signature verification failed/);
  await assert.rejects(signRelease({store:f.store,releaseId:h('a'),privatePem:intruder.privateKey.export({format:'pem',type:'pkcs8'})}),/already been signed/);
});

test('atomic activation prepares a runtime, detects changes and requires reactivation after a promotion',async t=>{
  const f=await fixture(t);
  await stageRelease({...f,verifySource});
  await promoteRelease({store:f.store,environment:'local',to:h('a'),expect:'none',profile:local,trustedPublicPem:f.trustedPublicPem});
  let calls=0;
  const args={store:f.store,environment:'local',to:h('a'),profile:local,trustedPublicPem:f.trustedPublicPem,prepareRuntime:async path=>{calls++;assert.equal((await readFile(join(path,'src','app.txt'),'utf8')),h(calls===1?'a':'b')); }};
  const first=await activateRelease(args);
  assert.equal(first.alreadyActivated,false);
  assert.equal(calls,1);
  assert.equal((await activateRelease(args)).alreadyActivated,true);
  assert.equal(calls,1);
  const state=await status({store:f.store,environment:'local',trustedPublicPem:f.trustedPublicPem});
  assert.equal(state.pendingActivation,false);
  assert.equal(state.activated,h('a'));
  await f.release(h('b'));
  await stageRelease({...f,verifySource});
  await promoteRelease({store:f.store,environment:'local',to:h('b'),expect:h('a'),profile:local,trustedPublicPem:f.trustedPublicPem});
  const pending=await status({store:f.store,environment:'local',trustedPublicPem:f.trustedPublicPem});
  assert.equal(pending.pendingActivation,true);
  await assert.rejects(validateActivation({store:f.store,environment:'local',trustedPublicPem:f.trustedPublicPem}),/Activation is stale/);
  await activateRelease({...args,to:h('b')});
  assert.equal((await status({store:f.store,environment:'local',trustedPublicPem:f.trustedPublicPem})).pendingActivation,false);
  await rollbackRelease({store:f.store,environment:'local',to:h('a'),expect:h('b'),profile:local,trustedPublicPem:f.trustedPublicPem});
  await activateRelease(args);
  assert.equal((await validateActivation({store:f.store,environment:'local',trustedPublicPem:f.trustedPublicPem})).releaseId,h('a'));
  assert.equal(calls,2,'prepared runtime is reused rather than reinstalled after rollback');
});

test('runtime activation fails closed if preparation changes signed source',async t=>{
  const f=await fixture(t);
  await stageRelease({...f,verifySource});
  await promoteRelease({store:f.store,environment:'local',to:h('a'),expect:'none',profile:local,trustedPublicPem:f.trustedPublicPem});
  await assert.rejects(activateRelease({store:f.store,environment:'local',to:h('a'),profile:local,trustedPublicPem:f.trustedPublicPem,prepareRuntime:async path=>{await writeFile(join(path,'src','app.txt'),'modified');}}),/Runtime preparation modified release source/);
  assert.equal((await status({store:f.store,environment:'local',trustedPublicPem:f.trustedPublicPem})).pendingActivation,true);
});

test('publisher keys are never overwritten, and staged bundles exclude private key extensions',async t=>{
  const f=await fixture(t);
  const privatePath=join(f.home,'publisher','private.pem');
  const publicPath=join(f.home,'publisher','public.pem');
  const keys=await generatePublisherKeys({privatePath,publicPath});
  assert.match(keys.publisherFingerprint,/^[a-f0-9]{64}$/);
  await assert.rejects(generatePublisherKeys({privatePath,publicPath}),/EEXIST/);
  await writeFile(join(f.source,'src','private.pem'),'PRIVATE KEY DUMMY');
  await writeFile(join(f.source,'src','private.key'),'PRIVATE KEY DUMMY');
  await stageRelease({...f,verifySource});
  const files=(await digestDirectory(join(f.store,'artifacts',h('a'),'source'))).files.map(x=>x.path);
  assert.deepEqual(files,['release.json','src/app.txt']);
});
