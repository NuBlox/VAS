import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile, symlink, readlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { signArtifact, verifyArtifactSignature } from './signing.mjs';

export const ENVIRONMENTS = Object.freeze(['local', 'staging']);
const EXCLUDED = new Set(['node_modules', '.git', '.svelte-kit', 'build', '.vas', 'coverage', '.DS_Store', 'exports', '.env']);
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_FILES = 5000, MAX_FILE_SIZE = 8 * 1024 * 1024, MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
function ensure(ok, message) { if (!ok) throw Error(message); }
function excluded(name) { return EXCLUDED.has(name) || name.startsWith('.env.') || name.endsWith('.local.json') || /\.(pem|key|p12|pfx)$/i.test(name); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function optional(path, defaultValue) {
  try { return await json(path); } catch (error) { if (error.code === 'ENOENT') return defaultValue; throw error; }
}
async function atomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.tmp-' + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}
async function locked(store, fn) {
  await mkdir(store, { recursive: true });
  const lock = join(store, '.lock');
  try { await mkdir(lock); } catch (e) {
    if (e.code === 'EEXIST') throw Error('Release store is locked by another operation');
    throw e;
  }
  try { return await fn(); } finally { await rm(lock, { recursive: true, force: true }); }
}
async function listFiles(root) {
  const files = [];
  async function walk(directory, prefix = '') {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (excluded(entry.name)) continue;
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw Error('Unsupported entry in release source: ' + rel);
      if (entry.isDirectory()) await walk(join(directory, entry.name), rel);
      else {
        const size = (await stat(join(directory, entry.name))).size;
        ensure(size <= MAX_FILE_SIZE, 'File too large for bundle: ' + rel);
        files.push({ path: rel, size });
        ensure(files.length <= MAX_FILES, 'Too many release files');
      }
    }
  }
  await walk(root);
  ensure(files.reduce((sum, f) => sum + f.size, 0) <= MAX_BUNDLE_BYTES, 'Bundle too large');
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export async function digestDirectory(root) {
  const files = await listFiles(root);
  const hash = createHash('sha256');
  for (const file of files) {
    const digest = createHash('sha256').update(await readFile(join(root, file.path))).digest('hex');
    hash.update(JSON.stringify([file.path, file.size, digest]) + '\n');
  }
  return { digest: hash.digest('hex'), fileCount: files.length, files };
}
export function validateProfile(profile, env) {
  ensure(ENVIRONMENTS.includes(env), 'Unsupported environment ' + env + '; only local and staging are supported');
  ensure(profile && typeof profile === 'object' && !Array.isArray(profile), 'Missing deployment profile');
  ensure(JSON.stringify(Object.keys(profile).sort()) === JSON.stringify(['bindHost', 'environment', 'mode', 'version']), 'Profile permits only version, environment, mode, bindHost (no secrets)');
  ensure(profile.version === 1 && profile.environment === env && profile.mode === 'local-development' && profile.bindHost === '127.0.0.1', 'Profile must enforce loopback-only development mode');
  return profile;
}
async function sourceId(source) {
  const release = await json(join(source, 'release.json'));
  ensure(release.kind === 'vas-standalone-release' && release.runtimeExposure === 'loopback-development-only' && HASH_RE.test(release.releaseId), 'Source is not a loopback-only VAS release');
  return release.releaseId;
}
async function artifact(store, id, trustedPublicPem) {
  ensure(HASH_RE.test(id), 'Invalid release identifier');
  const folder = join(store, 'artifacts', id);
  const manifest = await json(join(folder, 'artifact.json'));
  ensure(manifest.version === 1 && manifest.releaseId === id && HASH_RE.test(manifest.digest), 'Invalid artifact manifest');
  const actual = await digestDirectory(join(folder, 'source'));
  ensure(manifest.digest === actual.digest && manifest.fileCount === actual.fileCount, 'Artifact contents have changed since staging');
  ensure((await sourceId(join(folder, 'source'))) === id, 'Artifact release identity mismatch');
  if (trustedPublicPem) {
    const proof=await optional(join(folder,'signature.json'),null);
    ensure(proof,'Unsigned release cannot be trusted');
    verifyArtifactSignature(manifest,proof,trustedPublicPem);
  }
  return manifest;
}
export async function stageRelease({ source, store, verifySource }) {
  const src = resolve(source), root = resolve(store);
  ensure(src !== root && !src.startsWith(root + sep), 'Store cannot be equal to or an ancestor of source');
  ensure(!root.startsWith(src + sep), 'Store cannot be inside source (would recursively package the store)');
  ensure(typeof verifySource === 'function', 'Stage requires a full verification callback');
  const id = await sourceId(src);
  await verifySource(src);
  const before = await digestDirectory(src);
  return locked(root, async () => {
    const destination = join(root, 'artifacts', id);
    if (await optional(join(destination, 'artifact.json'), null)) {
      const existing = await artifact(root, id);
      ensure(existing.digest === before.digest, 'Same release ID has different source contents; export a new release');
      return { releaseId: id, artifact: existing, alreadyStaged: true };
    }
    await mkdir(join(root, 'artifacts'), { recursive: true });
    const temp = await mkdtemp(join(root, 'artifacts', '.stage-'));
    try {
      await mkdir(join(temp, 'source'), { recursive: true });
      for (const file of before.files) {
        const target = join(temp, 'source', file.path);
        await mkdir(dirname(target), { recursive: true });
        await cp(join(src, file.path), target, { force: false, errorOnExist: true });
      }
      const after = await digestDirectory(join(temp, 'source'));
      ensure(before.digest === after.digest, 'Source changed while staging');
      const item = { version: 1, releaseId: id, digest: after.digest, fileCount: after.fileCount,
        stagedAt: new Date().toISOString(), validation: ['verify:release', 'test', 'check', 'build'],
        exposure: 'loopback-development-only' };
      await writeFile(join(temp, 'artifact.json'), JSON.stringify(item, null, 2) + '\n', { flag: 'wx' });
      await rename(temp, destination);
      return { releaseId: id, artifact: item, alreadyStaged: false };
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}
const statePath = (store, env) => join(store, 'environments', env + '.json');
async function state(store, env) {
  ensure(ENVIRONMENTS.includes(env), 'Only local and staging environments are supported');
  const current = await optional(statePath(store, env), { version: 1, environment: env, revision: 0, active: null, history: [] });
  ensure(current.version === 1 && current.environment === env && Number.isSafeInteger(current.revision)
    && current.revision >= 0 && (current.active === null || HASH_RE.test(current.active))
    && Array.isArray(current.history), 'Invalid environment state');
  return current;
}
export async function status({store,environment,trustedPublicPem}) {
  const root=resolve(store);
  const current=await state(root,environment);
  if(current.active) await artifact(root,current.active,trustedPublicPem);
  const activation=await optional(join(root,'environments',environment,'activation.json'),null);
  if(activation && trustedPublicPem && current.active===activation.releaseId && current.revision===activation.stateRevision)
    await validateActivation({store:root,environment,trustedPublicPem,expectedRelease:activation.releaseId});
  return {...current,activated:activation?.releaseId??null,pendingActivation:current.active!==(activation?.releaseId??null)};
}
async function transition({ store, environment, to, expect, profile, action, trustedPublicPem }) {
  ensure(typeof expect === 'string' && (expect === 'none' || HASH_RE.test(expect)), 'Provide --expect none or current release ID');
  validateProfile(profile, environment);
  ensure(typeof trustedPublicPem==='string' && trustedPublicPem.length>0,'Trusted publisher public key required');
  return locked(resolve(store), async () => {
    const root = resolve(store);
    const current = await state(root, environment);
    ensure((current.active ?? 'none') === expect, 'Stale deployment state: expected ' + expect + ', actual ' + (current.active ?? 'none'));
    const candidate = await artifact(root, to, trustedPublicPem);
    if (action === 'rollback') {
      ensure(current.active !== null, 'No active release to roll back');
      ensure(current.history.some(h => h.to === to), 'Rollback target has not previously been active');
    }
    ensure(to !== current.active, 'Selected release is already active');
    const old = current.active;
    current.revision += 1;
    current.active = to;
    current.history.push({ revision: current.revision, action, from: old, to,
      at: new Date().toISOString(), artifactDigest: candidate.digest });
    ensure(current.history.length <= 500, 'Deployment history limit reached; archive review required');
    await atomic(statePath(root, environment), current);
    return current;
  });
}
export async function promoteRelease(args) { return transition({ ...args, action: 'promote' }); }
export async function rollbackRelease(args) { return transition({ ...args, action: 'rollback' }); }

/** Sign a staged artifact; the private key never enters the staging store. */
export async function signRelease({store,releaseId,privatePem}) {
  ensure(privatePem,'Publisher private key required');
  const root=resolve(store);
  return locked(root,async()=>{
    const artifact=await artifact(root,releaseId);
    const destination=join(root,'artifacts',releaseId,'signature.json');
    const previous=await optional(destination,null);
    const proof=signArtifact(artifact,privatePem);
    if(previous) {
      ensure(JSON.stringify(previous)===JSON.stringify(proof),'Release has already been signed; cannot replace publisher signature');
      return proof;
    }
    await writeFile(destination,JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
    return proof;
  });
}

/** Validate that the live disk pointer matches an authenticated, published release. */
export async function validateActivation({store,environment,trustedPublicPem,expectedRelease}) {
  ensure(trustedPublicPem,'Trusted publisher public key required');
  ensure(ENVIRONMENTS.includes(environment),'Unsupported environment');
  const root=resolve(store);
  const activation=await json(join(root,'environments',environment,'activation.json'));
  ensure(activation.version===1 && HASH_RE.test(activation.releaseId),'Invalid activated release');
  if(expectedRelease) ensure(activation.releaseId===expectedRelease,'Activated release does not match expected release');
  const state=await state(root,environment);
  ensure(state.active===activation.releaseId && state.revision===activation.stateRevision,'Activation is stale; promote/rollback requires explicit reactivation');
  const manifest=await artifact(root,activation.releaseId,trustedPublicPem);
  ensure(activation.artifactDigest===manifest.digest,'Activation artifact digest mismatch');
  const directory=join(root,'environments',environment);
  const link=await readlink(join(directory,'current'));
  ensure(link===join('deployments',activation.releaseId,'source'),'Runtime activation link points outside selected release');
  const deployed=join(directory,'deployments',activation.releaseId,'source');
  const actual=await digestDirectory(deployed);
  ensure(actual.digest===manifest.digest,'Activated runtime files have changed');
  return {releaseId:activation.releaseId,path:deployed,artifactDigest:manifest.digest,stateRevision:state.revision};
}

/** Materialize verified application files, prepare offline dependencies, atomically switch local runtime.
 * Does not stop running processes, expose ports or change any database.
 */
export async function activateRelease({store,environment,to,profile,trustedPublicPem,prepareRuntime}) {
  validateProfile(profile,environment);
  ensure(trustedPublicPem,'Trusted publisher public key required');
  ensure(typeof prepareRuntime==='function','A runtime preparation callback is required');
  ensure(HASH_RE.test(to),'Invalid target release');
  const root=resolve(store);
  return locked(root,async()=>{
    const state=await state(root,environment);
    ensure(state.active===to,'Release must first be promoted in the chosen environment');
    const manifest=await artifact(root,to,trustedPublicPem);
    const envRoot=join(root,'environments',environment);
    const deployment=join(envRoot,'deployments',to);
    const target=join(deployment,'source');
    const current=await optional(join(envRoot,'activation.json'),null);
    if(current?.releaseId===to && current.stateRevision===state.revision) {
      return {...await validateActivation({store:root,environment,trustedPublicPem,expectedRelease:to}),alreadyActivated:true};
    }
    await mkdir(join(envRoot,'deployments'),{recursive:true});
    const existing=await stat(deployment).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
    if(!existing){
      const temporary=await mkdtemp(join(envRoot,'deployments','.prepare-'));
      try {
        await mkdir(join(temporary,'source'));
        const staged=join(root,'artifacts',to,'source');
        for(const file of (await digestDirectory(staged)).files){
          const destination=join(temporary,'source',file.path);
          await mkdir(dirname(destination),{recursive:true});
          await cp(join(staged,file.path),destination,{errorOnExist:true,force:false});
        }
        ensure((await digestDirectory(join(temporary,'source'))).digest===manifest.digest,'Runtime source differs from signed artifact');
        await prepareRuntime(join(temporary,'source'));
        ensure((await digestDirectory(join(temporary,'source'))).digest===manifest.digest,'Runtime preparation modified release source');
        await rename(temporary,deployment);
      }finally{await rm(temporary,{recursive:true,force:true});}
    } else {
      ensure((await digestDirectory(target)).digest===manifest.digest,'Previously prepared runtime has changed');
    }
    const link=join(envRoot,`.current-${randomUUID()}`);
    try{
      await symlink(join('deployments',to,'source'),link,'dir');
      await rename(link,join(envRoot,'current'));
    }finally{await rm(link,{force:true});}
    await atomic(join(envRoot,'activation.json'),{version:1,releaseId:to,artifactDigest:manifest.digest,stateRevision:state.revision,activatedAt:new Date().toISOString()});
    return {...await validateActivation({store:root,environment,trustedPublicPem,expectedRelease:to}),alreadyActivated:false};
  });
}
