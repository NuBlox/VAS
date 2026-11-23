#!/usr/bin/env node
/** Local release candidate manager: no public deployment or database migration. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stageRelease, promoteRelease, rollbackRelease, status, validateProfile } from './core.mjs';

const usage = 'Usage: node scripts/deploy/manage.mjs <stage|promote|rollback|status> --store PATH [--source PATH] [--env local|staging] [--release SHA256] [--expect SHA256|none] [--profile deployment/profiles/local.json]';
const argv = process.argv.slice(2);
const action = argv.shift();
const options = {};
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i], value = argv[i + 1];
  if (!['--store', '--source', '--env', '--release', '--expect', '--profile'].includes(key)
    || !value || value.startsWith('--') || options[key]) throw Error(usage);
  options[key] = value;
}
if (!['stage', 'promote', 'rollback', 'status'].includes(action) || !options['--store']) throw Error(usage);
const store = resolve(options['--store']), source = resolve(options['--source'] ?? '.');
const environment = options['--env'] ?? 'local';
async function verifySource(src) {
  const checks = [[process.execPath, ['scripts/verify-release.mjs']],
    ['npm', ['test']], ['npm', ['run', 'check']], ['npm', ['run', 'build']]];
  for (const [program, args] of checks) {
    const run = spawnSync(program, args, { cwd: src, stdio: 'inherit', env: process.env });
    if (run.error || run.status !== 0) throw Error(program + ' ' + args.join(' ') + ' failed; refusing to stage');
  }
}
try {
  let result;
  if (action === 'stage') result = await stageRelease({ source, store, verifySource });
  else if (action === 'status') result = await status({ store, environment });
  else {
    if (!options['--release'] || !options['--expect'] || !options['--profile']) throw Error(usage);
    const profile = JSON.parse(await readFile(resolve(options['--profile']), 'utf8'));
    validateProfile(profile, environment);
    const args = { store, environment, to: options['--release'], expect: options['--expect'], profile };
    result = action === 'promote' ? await promoteRelease(args) : await rollbackRelease(args);
  }
  console.log(JSON.stringify({ action, store, environment, ...result }, null, 2));
} catch (error) { console.error('VAS deployment ' + (action ?? '') + ' failed: ' + error.message); process.exitCode = 1; }
