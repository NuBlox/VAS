#!/usr/bin/env node
/** Build a self-contained, reviewable SvelteKit application from a VAS release. */
import { readFile, writeFile, mkdir, mkdtemp, cp, rename, rm, access } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateProject, migrateProject } from '../src/lib/studio/model.js';
import { exportMySQL } from '../src/lib/studio/compiler.js';
import { projectRevision } from '../src/lib/studio/revision.js';
import { releaseId, validatePublication } from '../src/lib/server/runtime/publication.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = join(repo, 'templates/standalone');
const args = process.argv.slice(2);
const usage = 'Usage: npm run app:export -- --out /absolute/output/path [--project ./custom.project.json | --release 64-character-SHA256]';
function option(name) {
  const indexes = args.flatMap((arg,i) => arg === name ? [i] : []);
  if (indexes.length > 1) throw Error(`Duplicate ${name} option`);
  if (!indexes.length) return null;
  const value = args[indexes[0]+1];
  if (!value || value.startsWith('--')) throw Error(`${name} requires a value`);
  return value;
}
const allowed = new Set(['--out','--project','--release']);
for (let i=0;i<args.length;i++) {
  if (!allowed.has(args[i])) throw Error(`${usage}\nUnexpected argument ${args[i]}`);
  i++;
  if (!args[i] || args[i].startsWith('--')) throw Error(usage);
}
const target = option('--out');
const source = option('--project');
const release = option('--release');
if (!target || (source && release)) throw Error(usage);
if (release && !/^[a-f0-9]{64}$/.test(release)) throw Error('Release must be a lowercase SHA-256 identifier');
const output = resolve(target);
if (output === repo || output.startsWith(join(repo,'src')+sep) || output.startsWith(join(repo,'runtime')+sep) || output.startsWith(join(repo,'templates')+sep)) throw Error('Export path would overwrite VAS source or runtime');
const readJson = async file => JSON.parse(await readFile(file,'utf8'));

function validatePaths(project) {
  const unique = new Set();
  for (const page of project.pages) {
    const path=page.path;
    if (path !== '/' && (!/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/i.test(path) || path.startsWith('/api/') || path === '/api'))
      throw Error(`Unsupported standalone page path: ${path}`);
    if (unique.has(path)) throw Error(`Duplicate standalone page path: ${path}`);
    unique.add(path);
  }
}
function schemaDiff(current, incoming) {
  if (!current) return 'New application. All tables are new; no database state is presumed.\n';
  const oldTables=new Map(current.models.map(m=>[m.table,m]));
  const newTables=new Map(incoming.models.map(m=>[m.table,m]));
  const lines=[];
  for (const [table, model] of newTables) {
    const old=oldTables.get(table);
    if (!old) lines.push(`- ADD table ${table} (review creation and constraints)`);
    else if (JSON.stringify(old)!==JSON.stringify(model)) lines.push(`- REVIEW changed table ${table}; create a manual migration and backup first`);
  }
  for (const table of oldTables.keys()) if (!newTables.has(table)) lines.push(`- REMOVED table ${table} from model; DO NOT drop production data automatically`);
  return lines.length?lines.join('\n')+'\n':'No model differences from the studio publication.\n';
}
function readme(project,id) {
  return `# ${project.name} — standalone VAS export\n\nExported release: \`${id}\`\n\nThis is an **independent SvelteKit application** with its own source, release snapshot, database schema and local authenticated CRUD/workflow runtime. It does not require the VAS designer at runtime. Navigation and layout work without a database. Data operations require MySQL and a local account.\n\n**NOT PRODUCTION SAFE:** server APIs deliberately run only on loopback and in development mode. Local users and in-memory sessions are not a hosted identity system. Do not expose this app via LAN, reverse proxy, tunnel or public deployment; do not use personal/customer data.\n\n## Install and validate (macOS)\n\n\`\`\`bash\nbrew install node mysql\ncd <your-export-directory>\nnpm install\nnpm run verify:release\nnpm test\nnpm run check\nnpm run build\nnpm run dev -- --host 127.0.0.1 --open\n\`\`\`\n\n## Local database setup (optional)\n\nFor a **fresh, empty** local MySQL instance, review \`db/initial.mysql.sql\`, \`db/audit.mysql.sql\`, \`db/idempotency.mysql.sql\` and \`db/MIGRATION_PLAN.md\`. Create development and audit databases, provision a restricted user and grant only necessary DML privileges. Run these SQL files manually as an administrator after review; the build and exporter never execute SQL. Then copy \`.env.example\` to \`.env\` and edit your local database credentials. \n\nCreate a local administrator account interactively (do not put your password in shell history):\n\n\`\`\`bash\nread -rs -p 'Local admin password: ' VAS_BOOTSTRAP_PASSWORD; echo\nexport VAS_BOOTSTRAP_PASSWORD\nnpm run auth:user -- operator admin\nunset VAS_BOOTSTRAP_PASSWORD\n\`\`\`\n\nOn macOS zsh, \`read -s 'VAS_BOOTSTRAP_PASSWORD?Local admin password: '\` is an alternative to Bash's \`read -p\`. See the original VAS README for detailed grants.\n\n## Controlled releases\n\n\`release.json\` and \`runtime/releases/${id}.json\` identify the published project. \`npm run verify:release\` checks the active snapshot, manifest, schema and release identifier before build. Generated release files must be reviewed and checked into version control. To update the application, produce a new export; do **not** edit the snapshot or apply database DDL blindly. Use a reviewed migration and rollback plan for schema changes.\n\nGenerated pages: ${project.pages.map(p=>`\`${p.path}\``).join(', ')}.\n`;
}
function plan(project, id, delta) {
  return `# Database change and release plan\n\nApplication: ${project.name}\nRelease: ${id}\n\n## Model changes\n\n${delta}\n## Controlled installation\n\n1. Confirm a fresh isolated database or take and verify a backup of the existing development database.\n2. Review \`initial.mysql.sql\` against the actual schema and manually write migration SQL for an existing database. It is **not** a safe repeatable migration.\n3. Ensure audit and idempotency tables are installed in a separate \`visual_studio_audit\` database.\n4. Grant the application user SELECT/INSERT/UPDATE/DELETE on its business schema; SELECT/INSERT on audit events; SELECT/INSERT/UPDATE on the idempotency table; no DDL grants.\n5. Apply reviewed SQL in an administrative session. Never run it from generated application startup.\n6. Run \`npm run verify:release && npm test && npm run check && npm run build\`. Test locally on loopback.\n7. Roll back the **application code** by restoring its previously versioned release; database rollback requires a separate reviewed plan and backup.\n\nNo automatic migration or production deployment is provided.\n`;
}

async function main() {
  let existing;
  try { await access(output); existing=true; } catch(e) { if(e.code!=='ENOENT') throw e; existing=false; }
  if(existing) throw Error(`Output already exists; refusing to overwrite: ${output}`);
  const project = validateProject(migrateProject(await readJson(source ? resolve(source) : release ? join(repo,'runtime/releases',`${release}.json`) : join(repo,'runtime/project.json'))));
  validatePaths(project);
  const id=releaseId(project);
  if(release && id!==release) throw Error('Stored release snapshot does not match its hash');
  if(!source && !release) validatePublication(project,await readJson(join(repo,'runtime/publication.json')));
  const current=await readJson(join(repo,'runtime/project.json'));
  const delta=schemaDiff(current,project);
  const manifest={version:1,projectId:project.id,releaseId:id,editorRevision:projectRevision(project),previousReleaseId:null,publishedAt:new Date().toISOString()};
  const parent=dirname(output);
  await mkdir(parent,{recursive:true});
  const temporary=await mkdtemp(join(parent,'.vas-export-'));
  let moved=false;
  try {
    async function copyFiles(relativePaths) {
      for(const path of relativePaths) {
        await mkdir(dirname(join(temporary,path)),{recursive:true});
        await cp(join(repo,path),join(temporary,path),{recursive:true,force:false});
      }
    }
    await copyFiles(['jsconfig.json','vite.config.js','src/app.html','src/lib/studio','src/lib/server/runtime','src/routes/api/runtime','scripts/local-user.mjs']);
    await cp(template,temporary,{recursive:true});
    await mkdir(join(temporary,'runtime/releases'),{recursive:true});
    await mkdir(join(temporary,'db'),{recursive:true});
    await mkdir(join(temporary,'tests'),{recursive:true});
    await copyFiles(['runtime/audit.mysql.sql','runtime/idempotency.mysql.sql','runtime/policy.example.json']);
    for(const [file,body] of [
      ['runtime/project.json',JSON.stringify(project,null,2)+'\n'],
      ['runtime/publication.json',JSON.stringify(manifest,null,2)+'\n'],
      [`runtime/releases/${id}.json`,JSON.stringify(project,null,2)+'\n'],
      ['db/initial.mysql.sql',exportMySQL(project)],
      ['db/audit.mysql.sql',await readFile(join(repo,'runtime/audit.mysql.sql'),'utf8')],
      ['db/idempotency.mysql.sql',await readFile(join(repo,'runtime/idempotency.mysql.sql'),'utf8')],
      ['db/MIGRATION_PLAN.md',plan(project,id,delta)],
      ['release.json',JSON.stringify({kind:'vas-standalone-release',version:1,projectId:project.id,releaseId:id,editorRevision:manifest.editorRevision,requiredSchema:'reviewed-mysql8',runtimeExposure:'loopback-development-only'},null,2)+'\n'],
      ['README.md',readme(project,id)]
    ]) { const path=join(temporary,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,body); }
    await cp(join(repo,'scripts/verify-standalone-release.mjs'),join(temporary,'scripts/verify-release.mjs'));
    await cp(join(repo,'templates/test-sources/generated.test.mjs'),join(temporary,'tests/generated.test.mjs'));
    const name=project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,54)||'application';
    const pkg=JSON.parse(await readFile(join(repo,'package.json'),'utf8'));
    pkg.name=`vas-app-${name}`;
    pkg.private=true;
    pkg.version='0.8.0';
    pkg.scripts={dev:'vite dev',build:'npm run verify:release && vite build',preview:'vite preview',check:'svelte-kit sync && svelte-check --tsconfig ./jsconfig.json',test:'node --test tests/*.test.mjs','verify:release':'node scripts/verify-release.mjs','auth:user':'node scripts/local-user.mjs'};
    await writeFile(join(temporary,'package.json'),JSON.stringify(pkg,null,2)+'\n');
    await writeFile(join(temporary,'.gitignore'),await readFile(join(repo,'.gitignore'),'utf8'));
    await writeFile(join(temporary,'.env.example'),await readFile(join(repo,'.env.example'),'utf8'));
    await rename(temporary,output);moved=true;
    console.log(`Exported ${project.name} to ${output}\nRelease ID: ${id}\nPages: ${project.pages.length}; models: ${project.models.length}; workflows: ${project.workflows.length}.\nNo migrations or deployments were executed.`);
  } finally {if(!moved) await rm(temporary,{recursive:true,force:true});}
}
try{await main();}catch(error){console.error(`Standalone export failed: ${error.message}`);process.exitCode=1;}
