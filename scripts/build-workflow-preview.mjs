/** Build the standalone offline workflow demo from the shared, tested modules. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const plain = (text, alias) => text.replace(/\bplain\b/g, alias);
const stripExports = (text) => text.replaceAll('export ', '');

const workflow = plain(stripExports(read('src/lib/studio/workflow.js')), 'workflowPlain');
const model = stripExports(read('src/lib/studio/model.js'))
  .replace("import { createStep, validateWorkflows } from './workflow.js';", '');
const records = plain(stripExports(read('src/lib/studio/records.js')), 'recordsPlain');
const app = read('preview/workflows-app.js');
const style = read('preview/workflows-style.css');
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Visual Application Studio 0.4 · Workflow Designer</title>' +
  '<style>' + style + '</style></head><body><div id="app"></div><script>\n' +
  workflow + '\n' + model + '\n' + records + '\n' + app + '\n</script></body></html>';

for (const path of ['preview/workflows.html', 'preview/index.html']) {
  writeFileSync(resolve(root, path), html);
}
console.log(`Built standalone preview (${html.length} characters)`);
