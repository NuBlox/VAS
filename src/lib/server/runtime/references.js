/** Published-model-only reference reads. No caller-supplied SQL or table names. */
import { RecordError, quoteIdentifier, normaliseId } from '../../studio/records.js';
import { pickerMetadata } from '../../studio/references.js';
import { assertModelPermission } from './policy.js';

export function referenceQuery(config, search = '') {
  if (typeof search !== 'string' || search.length > 80 || /[\x00-\x1f\x7f]/.test(search))
    throw new RecordError('Invalid reference search');
  const table = quoteIdentifier(config.target.table);
  const pk = quoteIdentifier(config.primary.name);
  const display = quoteIdentifier(config.display.name);
  const escaped = search.replace(/[!%_]/g, match => '!' + match);
  // Search patterns are bound parameters; identifiers come only from validated project metadata.
  return {
    sql: `SELECT CAST(${pk} AS CHAR) AS id, LEFT(CAST(${display} AS CHAR),255) AS label FROM ${table} WHERE ${display} LIKE ? ESCAPE '!' ORDER BY ${pk} DESC LIMIT 20`,
    params: [`%${escaped}%`]
  };
}
export function publishedPicker(project, pageId, componentId) {
  const page = project.pages.find(p => p.id === pageId);
  if (!page) throw new RecordError('Reference picker not published',404);
  let result = null;
  const walk = nodes => {for(const node of nodes){if(node.id===componentId)result=node; if(node.children)walk(node.children);}};
  walk(page.components);
  if(!result)throw new RecordError('Reference picker not published',404);
  let config;
  try { config = pickerMetadata(project,result); } catch { throw new RecordError('Invalid published reference picker',503); }
  if(!config) throw new RecordError('Reference picker not configured',404);
  return config;
}
export async function searchReferences(connection, project, pageId, componentId, search, actor, policy) {
  const config = publishedPicker(project,pageId,componentId);
  assertModelPermission(actor,config.target.id,'read',policy);
  const statement = referenceQuery(config,search);
  const [rows] = await connection.execute(statement.sql,statement.params);
  return rows.map(row => ({id:String(row.id),label:String(row.label??'')}));
}
export async function assertReferencedValues(connection, project, model, values, actor, policy) {
  for (const field of model.fields) {
    if (!field.referenceModelId || !Object.hasOwn(values,field.name) || values[field.name]===null || values[field.name]==='') continue;
    const target = project.models.find(item => item.id === field.referenceModelId);
    const pk = target?.fields.find(item => item.id === field.referenceFieldId && item.primary);
    if(!target || !pk)throw new RecordError('Invalid published model relationship',503);
    if(actor)assertModelPermission(actor,target.id,'read',policy);
    const id = normaliseId(target,values[field.name]);
    const [rows] = await connection.execute(`SELECT ${quoteIdentifier(pk.name)} FROM ${quoteIdentifier(target.table)} WHERE ${quoteIdentifier(pk.name)} = ? LIMIT 1`,[id]);
    if(!rows.length)throw new RecordError('Referenced record does not exist',409);
  }
}
