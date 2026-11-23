import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateProject, migrateProject } from '../src/lib/studio/model.js';
import { exportMySQL } from '../src/lib/studio/compiler.js';
import { projectRevision } from '../src/lib/studio/revision.js';
const name=process.argv.find(arg=>!arg.startsWith('--')&&arg!==process.argv[0]&&arg!==process.argv[1]);
if(!name){console.error('Usage: npm run runtime:publish -- ./application.project.json [--dry-run]');process.exit(1);}
try{
  const project=validateProject(migrateProject(JSON.parse(await readFile(resolve(name),'utf8'))));
  const ddl=exportMySQL(project);
  if(!process.argv.includes('--dry-run')){
    await writeFile(new URL('../runtime/project.json',import.meta.url),JSON.stringify(project,null,2)+'\n');
    await writeFile(new URL('../runtime/schema.mysql.sql',import.meta.url),ddl);
  }
  console.log(`${process.argv.includes('--dry-run')?'Validated':'Published'} ${project.name} (${projectRevision(project)}) with ${project.models.length} models, ${project.pages.length} pages.`);
  console.log('Review runtime/schema.mysql.sql, run a safe migration if necessary, then restart the SvelteKit server.');
} catch(e){console.error(`Publish failed: ${e.message}`);process.exitCode=1;}
