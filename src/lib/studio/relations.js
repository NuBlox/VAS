/** Declarative parent/child views: only published field IDs, page IDs and allowlisted columns. */
export function columnNames(model, columns) {
  const values=String(columns??'').split(',').map(x=>x.trim()).filter(Boolean);
  const allowed=new Set(model?.fields.map(f=>f.name));
  if(!model||values.length<1||values.length>12||new Set(values).size!==values.length||values.some(x=>!allowed.has(x)))
    throw new Error('Record columns must be distinct published fields (maximum 12)');
  return values;
}
export function relationshipMetadata(project, node) {
  if(node?.type!=='table'||!node.props?.relationParentModelId)return null;
  const child=project.models.find(m=>m.id===node.props.bindingModelId);
  const parent=project.models.find(m=>m.id===node.props.relationParentModelId);
  const field=child?.fields.find(f=>f.id===node.props.relationFieldId);
  const pk=parent?.fields.find(f=>f.primary);
  if(!child||!parent||!field||!pk||!field.referenceModelId||field.referenceModelId!==parent.id||field.referenceFieldId!==pk.id||field.type!==pk.type)
    throw new Error('Related table must bind to a published parent and its foreign key');
  columnNames(child,node.props.columns);
  return {child,parent,field,primary:pk};
}
export function detailMetadata(project,node) {
  if(node?.type!=='record-detail')return null;
  if(!node.props.bindingModelId)return null;
  const model=project.models.find(m=>m.id===node.props.bindingModelId);
  return {model,columns:columnNames(model,node.props.columns)};
}
/** Pure projection of only related records, useful for offline preview/debugging. */
export function relatedRows(config,records,parentId){
  if(parentId==null||parentId==='')return [];
  return (records??[]).filter(row=>String(row[config.field.name])===String(parentId));
}
