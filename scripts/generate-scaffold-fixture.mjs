#!/usr/bin/env node
/** Repeatable, synthetic fixture for generated CRUD screens. Never changes live projects. */
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createProject, validateProject } from '../src/lib/studio/model.js';
import { scaffoldModelCrud } from '../src/lib/studio/scaffold.js';

const target = process.argv[2];
if (!target || process.argv.length !== 3) {
  console.error('Usage: npm run scaffold:generate -- /path/to/generated.project.json');
  process.exitCode = 2;
} else {
  const project = createProject();
  project.name = 'Generated Customer and Order Workspace';
  project.id = 'vas_generated_crud_acceptance';
  scaffoldModelCrud(project, 'model_customer');
  scaffoldModelCrud(project, 'model_order');
  validateProject(project);
  const output = resolve(target);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(project, null, 2)}\n`, { flag: 'wx' });
  console.log(`Wrote ${project.pages.length} pages, ${project.models.length} models, ${project.workflows.length} workflows to ${output}`);
}
