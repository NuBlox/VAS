#!/usr/bin/env node
/** Local developer release management. Never exposes a network service or changes a database. */
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stageRelease, signRelease, promoteRelease, rollbackRelease, activateRelease, validateActivation, status, validateProfile } from './core.mjs';
import { generatePublisherKeys, fingerprint } from './signing.mjs';

const usage=`Usage: node scripts/deploy/manage.mjs <keygen|stage|sign|promote|rollback|activate|status|run>
  keygen --private-key /external/private.pem --public-key /external/public.pem
  stage --store /absolute/store --signing-key /external/private.pem [--source /generated/app]
  sign --store /absolute/store --release SHA256 --signing-key /external/private.pem
  promote|rollback --store /absolute/store --env local|staging --release SHA256 --expect SHA256|none --profile deployment/profiles/local.json --trusted-key /external/public.pem
  activate --store /absolute/store --env local|staging --release SHA256 --profile deployment/profiles/local.json --trusted-key /external/public.pem
  status|run --store /absolute/store --env local|staging --trusted-key /external/public.pem
  Production/public environments are forbidden. Activation switches a disk symlink, NOT a running service or MySQL schema.`;
const argv=process.argv.slice(2);
const action=argv.shift();
const options={};
for(let i=0;i<argv.length;i+=2) {
  const key=argv[i],value=argv[i+1];
  if(!['--store','--source','--env','--release','--expect','--profile','--signing-key','--trusted-key','--private-key','--public-key'].includes(key)||!value||value.startsWith('--')||options[key])throw Error(usage);
  options[key]=value;
}
if(!['keygen','stage','sign','promote','rollback','activate','status','run'].includes(action))throw Error(usage);
const store=options['--store']?resolve(options['--store']):null;
const source=resolve(options['--source']??'.');
const environment=options['--env']??'local';
const release=options['--release'];
const requireOption=(name)=>{if(!options[name])throw Error(`${name} is required.\n${usage}`);return options[name];};
const read=(name)=>readFile(resolve(requireOption(name)),'utf8');
function outside(path,root) {const p=resolve(path),r=resolve(root);return p!==r && !p.startsWith(r+sep);}
async function verified(src){
  for(const [program,args] of [[process.execPath,['scripts/verify-release.mjs']],['npm',['test']],['npm',['run','check']],['npm',['run','build']]]) {
    const result=spawnSync(program,args,{cwd:src,stdio:'inherit',env:process.env});
    if(result.error||result.status!==0)throw Error(`${program} ${args.join(' ')} failed; refusing to stage release`);
  }
}
async function prepared(src) {
  for(const [program,args] of [['npm',['ci','--no-audit','--no-fund']],...[[process.execPath,['scripts/verify-release.mjs']],['npm',['run','check']],['npm',['run','build']]]]) {
    const result=spawnSync(program,args,{cwd:src,stdio:'inherit',env:process.env});
    if(result.error||result.status!==0)throw Error(`Runtime preparation failed: ${program} ${args.join(' ')}`);
  }
}
try {
  let result;
  if(action==='keygen') {
    const privatePath=resolve(requireOption('--private-key'));
    const publicPath=resolve(requireOption('--public-key'));
    if(!outside(privatePath,source)||!outside(publicPath,source))throw Error('Publisher keys must be stored outside application source');
    result=await generatePublisherKeys({privatePath,publicPath});
  } else {
    if(!store)throw Error(`--store required.\n${usage}`);
    if(action==='stage') {
      const keyPath=resolve(requireOption('--signing-key'));
      if(!outside(keyPath,source)||!outside(keyPath,store))throw Error('Private key must remain outside the source and release store');
      result=await stageRelease({source,store,verifySource:verified});
      const proof=await signRelease({store,releaseId:result.releaseId,privatePem:await read('--signing-key')});
      result={...result,publisherFingerprint:proof.publisherFingerprint,signed:true};
    } else if(action==='sign') {
      const keyPath=resolve(requireOption('--signing-key'));
      if(!outside(keyPath,source)||!outside(keyPath,store))throw Error('Private key must remain outside the source and release store');
      result=await signRelease({store,releaseId:requireOption('--release'),privatePem:await read('--signing-key')});
    } else {
      const trustedPublicPem=await read('--trusted-key');
      if(action==='status') {
        result=await status({store,environment,trustedPublicPem});
      } else if(action==='run') {
        const activation=await validateActivation({store,environment,trustedPublicPem});
        if(process.env.NODE_ENV==='production')throw Error('Local developer runtime may not start in production mode');
        console.error(`Starting verified ${activation.releaseId} on loopback 127.0.0.1. Stop with Ctrl+C.`);
        const child=spawnSync('npm',['run','dev','--','--host','127.0.0.1'],{cwd:activation.path,stdio:'inherit',env:{...process.env,NODE_ENV:'development'}});
        if(child.error||child.status!==0)throw Error(`Local runtime exited unsuccessfully: ${child.error?.message??child.status}`);
        result={releaseId:activation.releaseId,exited:true};
      } else {
        const profile=JSON.parse(await readFile(resolve(requireOption('--profile')),'utf8'));
        validateProfile(profile,environment);
        if(action==='activate') {
          result=await activateRelease({store,environment,to:requireOption('--release'),profile,trustedPublicPem,prepareRuntime:prepared});
        } else {
          const args={store,environment,to:requireOption('--release'),expect:requireOption('--expect'),profile,trustedPublicPem};
          result=action==='promote'?await promoteRelease(args):await rollbackRelease(args);
        }
      }
    }
  }
  console.log(JSON.stringify({action,store,environment,...result},null,2));
}catch(error) {console.error(`VAS deployment ${action??''} failed: ${error.message}`);process.exitCode=1;}
