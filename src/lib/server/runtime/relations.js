/** Read-only, bounded related records; the client never supplies SQL identifiers. */
import {RecordError, normaliseId,quoteIdentifier,jsonRecord} from '../../studio/records.js';
import {relationshipMetadata,columnNames} from '../../studio/relations.js';
import {assertModelPermission} from './policy.js';

export function publishedRelation(project,pageId,componentId){
  const page=project.pages.find(p=>p.id===pageId);
  if(!page)throw new RecordError('Related list not published',404);
  let node;
  const walk=nodes=>{for(const n of nodes){if(n.id===componentId)node=n;if(n.children)walk(n.children);}};
  walk(page.components);
  if(!node||node.type!=='table')throw new RecordError('Related list not published',404);
  try{
    const relation=relationshipMetadata(project,node);
    if(!relation)throw new Error('Not a related list');
    return {...relation,columns:columnNames(relation.child,node.props.columns)};
  }catch {throw new RecordError('Invalid published related list',503);}
}
export function pagination(rawPage='0',rawLimit='20'){
  if(!/^(0|[1-9]\d{0,2})$/.test(String(rawPage))||!/^(?:[1-9]|1\d|2[0-5])$/.test(String(rawLimit)))
    throw new RecordError('Invalid related-list pagination');
  const page=Number(rawPage),limit=Number(rawLimit);
  if(page>40)throw new RecordError('Related-list page limit exceeded');
  return {page,limit,offset:page*limit};
}
export function relatedStatements(config,parentId,page='0',limit='20'){
  const id=normaliseId(config.parent,parentId),paged=pagination(page,limit);
  const table=quoteIdentifier(config.child.table),foreign=quoteIdentifier(config.field.name),pk=quoteIdentifier(config.child.fields.find(f=>f.primary).name);
  const fields=[...new Set([...config.columns,config.child.fields.find(f=>f.primary).name])];
  return {parent:{sql:`SELECT 1 FROM ${quoteIdentifier(config.parent.table)} WHERE ${quoteIdentifier(config.primary.name)} = ? LIMIT 1`,params:[id]},
    children:{sql:`SELECT ${fields.map(quoteIdentifier).join(', ')} FROM ${table} WHERE ${foreign} = ? ORDER BY ${pk} DESC LIMIT ? OFFSET ?`,params:[id,paged.limit,paged.offset]},
    ...paged};
}
export async function listRelatedRecords(db,project,pageId,componentId,parentId,page,limit,actor,policy){
  const config=publishedRelation(project,pageId,componentId);
  assertModelPermission(actor,config.parent.id,'read',policy);
  assertModelPermission(actor,config.child.id,'read',policy);
  const stmts=relatedStatements(config,parentId,page,limit);
  const [existing]=await db.execute(stmts.parent.sql,stmts.parent.params);
  if(!existing.length)throw new RecordError('Parent record not found',404);
  const [rows]=await db.execute(stmts.children.sql,stmts.children.params);
  return {records:rows.map(jsonRecord),page:stmts.page,limit:stmts.limit,hasMore:rows.length===stmts.limit};
}
