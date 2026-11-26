/** Declarative reference picker contract shared by the editor, runtime and exports. */
export function displayFields(model) {
  return model?.fields.filter(field => !field.primary && ['string', 'text'].includes(field.type)) ?? [];
}
export function preferredDisplayField(model) {
  return displayFields(model).find(field => field.name === 'name')?.id ?? displayFields(model)[0]?.id ?? '';
}
export function pickerMetadata(project, node) {
  if (node?.type !== 'select' || !node.props?.referenceDisplayFieldId) return null;
  const model = project.models.find(item => item.id === node.props.bindingModelId);
  const field = model?.fields.find(item => item.id === node.props.bindingFieldId);
  const target = project.models.find(item => item.id === field?.referenceModelId);
  const primary = target?.fields.find(item => item.id === field?.referenceFieldId && item.primary);
  const display = target?.fields.find(item => item.id === node.props.referenceDisplayFieldId && ['string', 'text'].includes(item.type) && !item.primary);
  if (!field || !field.referenceModelId || !primary || !display || field.type !== primary.type)
    throw new Error('Reference picker must target a compatible published foreign key and display field');
  return { model, field, target, primary, display };
}
