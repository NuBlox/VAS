import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export const ENVIRONMENTS = Object.freeze(['local', 'staging']);
const EXCLUDED = new Set(['node_modules', '.git', '.svelte-kit', 'build', '.vas', 'coverage', '.DS_Store', 'exports', '.env']);
const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_FILES = 5000, MAX_FILE_SIZE = 8 * 1024 * 1024, MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
function ensure(ok, message) { if (!ok) throw Error(message); }
function excluded(name) { return EXCLUDED.has(name) || name.startsWith('.env.') || name.endsWith('.local.json'); }
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
async function artifact(store, id) {
  ensure(HASH_RE.test(id), 'Invalid release identifier');
  const folder = join(store, 'artifacts', id);
  const manifest = await json(join(folder, 'artifact.json'));
  ensure(manifest.version === 1 && manifest.releaseId === id && HASH_RE.test(manifest.digest), 'Invalid artifact manifest');
  const actual = await digestDirectory(join(folder, 'source'));
  ensure(manifest.digest === actual.digest && manifest.fileCount === actual.fileCount, 'Artifact contents have changed since staging');
  ensure((await sourceId(join(folder, 'source'))) === id, 'Artifact release identity mismatch');
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
export async function status({ store, environment }) {
  const root = resolve(store);
  const current = await state(root, environment);
  if (current.active) await artifact(root, current.active);
  return current;
}
async function transition({ store, environment, to, expect, profile, action }) {
  ensure(typeof expect === 'string' && (expect === 'none' || HASH_RE.test(expect)), 'Provide --expect none or current release ID');
  validateProfile(profile, environment);
  return locked(resolve(store), async () => {
    const root = resolve(store);
    const current = await state(root, environment);
    ensure((current.active ?? 'none') === expect, 'Stale deployment state: expected ' + expect + ', actual ' + (current.active ?? 'none'));
    const candidate = await artifact(root, to);
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
