import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateProject, migrateProject } from '../src/lib/studio/model.js';
import { exportMySQL } from '../src/lib/studio/compiler.js';
import { projectRevision } from '../src/lib/studio/revision.js';
import { releaseId } from '../src/lib/server/runtime/publication.js';
import { validatePublication } from '../src/lib/server/runtime/publication.js';

const args=process.argv.slice(2);
const file=args.find(arg=>!arg.startsWith('--'));
if(!file || args.some(arg=>arg.startsWith('--')&&!['--dry-run','--allow-schema-change'].includes(arg))){
  console.error('Usage: npm run runtime:publish -- ./application.project.json [--dry-run] [--allow-schema-change]');
  process.exit(1);
}
const runtime=resolve(import.meta.dirname,'../runtime');
async function readOptional(file) {
  try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function atomicWrite(path,content) {
  const tmp=join(dirname(path),`.vas-${randomUUID()}.tmp`);
  try{await writeFile(tmp,content,{flag:'wx'});await rename(tmp,path);}
  catch(error){try{const {unlink}=await import('node:fs/promises');await unlink(tmp);}catch{}throw error;}
}
try {
  const project=validateProject(migrateProject(JSON.parse(await readFile(resolve(file),'utf8'))));
  const ddl=exportMySQL(project);
  const currentText=await readOptional(join(runtime,'project.json'));
  const current=currentText?validateProject(JSON.parse(currentText)):null;
  const manifestText=await readOptional(join(runtime,'publication.json'));
  const manifest=manifestText?JSON.parse(manifestText):null;
  if (manifest && !current) throw Error('Publication manifest exists without an active project');
  if (manifest) validatePublication(current,manifest);
  const schemaChanged=Boolean(current && JSON.stringify(current.models)!==JSON.stringify(project.models));
  if(schemaChanged&&!args.includes('--allow-schema-change'))throw Error('Data model changed: review the generated DDL and supply --allow-schema-change after planning a database migration. No SQL was executed.');
  const id=releaseId(project);
  const revision=projectRevision(project);
  const unchanged=manifest?.releaseId===id;
  if(!args.includes('--dry-run')&&!unchanged) {
    const releases=join(runtime,'releases');await mkdir(releases,{recursive:true});
    const snapshot=JSON.stringify(project,null,2)+'\n';
    const immutable=join(releases,`${id}.json`);
    const found=await readOptional(immutable);
    if(found && releaseId(JSON.parse(found))!==id)throw Error('Release snapshot collision or corruption');
    if(!found)await writeFile(immutable,snapshot,{flag:'wx'});
    // Fail closed if an interrupted publish leaves a mismatched project and manifest.
    await atomicWrite(join(runtime,'schema.mysql.sql'),ddl);
    await atomicWrite(join(runtime,'project.json'),snapshot);
    await atomicWrite(join(runtime,'publication.json'),JSON.stringify({version:1,projectId:project.id,releaseId:id,editorRevision:revision,previousReleaseId:manifest?.releaseId??null,publishedAt:new Date().toISOString()},null,2)+'\n');
  }
  console.log(`${args.includes('--dry-run')?'Validated':unchanged?'Already published':'Published'} ${project.name}; release ${id}, editor revision ${revision}.`);
  console.log(`Data model change: ${schemaChanged?'YES - requires reviewed migration':'no'}. No SQL was executed. Restart SvelteKit after publishing.`);
} catch(error){console.error(`Publish failed: ${error.message}`);process.exitCode=1;}
