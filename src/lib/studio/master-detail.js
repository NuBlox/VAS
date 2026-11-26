/** Author two editable master/detail pages from an existing validated model relationship. */
import { createId,createComponent,validateProject } from './model.js';
import {columnNames,relationshipMetadata} from './relations.js';
function component(type,props){const node=createComponent(type);Object.assign(node.props,props);return node;}
export function scaffoldMasterDetail(project,parentModelId,childModelId,foreignFieldId){
  validateProject(project);
  const parent=project.models.find(m=>m.id===parentModelId);
  const child=project.models.find(m=>m.id===childModelId);
  const fk=child?.fields.find(f=>f.id===foreignFieldId);
  const pk=parent?.fields.find(f=>f.primary);
  if(!parent||!child||!fk||!pk||fk.referenceModelId!==parent.id||fk.referenceFieldId!==pk.id)
    throw Error('Choose a published parent and a related child foreign key');
  if(project.pages.length>98)throw Error('Project page limit reached');
  const routes=new Set(project.pages.map(p=>p.path));let suffix=1;
  const base=n=>`/relationships/${parent.table}-${child.table}${n===1?'':'-'+n}`;
  while(routes.has(base(suffix))||routes.has(base(suffix)+'/detail'))suffix++;
  const parentPage={id:createId('page'),name:`${parent.name} → ${child.name}`,path:base(suffix),components:[]};
  const detailPage={id:createId('page'),name:`${child.name} detail`,path:base(suffix)+'/detail',components:[]};
  const parentCols=columnNames(parent,parent.fields.slice(0,6).map(f=>f.name).join(','));
  const childCols=columnNames(child,child.fields.slice(0,6).map(f=>f.name).join(','));
  const parentTable=component('table',{title:`Select ${parent.name}`,columns:parentCols.join(','),bindingModelId:parent.id});
  const relatedTable=component('table',{title:`Related ${child.name}`,columns:childCols.join(','),bindingModelId:child.id,
    relationParentModelId:parent.id,relationFieldId:fk.id,detailPageId:detailPage.id});
  parentPage.components=[component('heading',{text:`${parent.name} and ${child.name}`,level:1}),
    component('text',{text:`Select a ${parent.name.toLowerCase()} to view its related ${child.name.toLowerCase()} records.`}),parentTable,relatedTable];
  detailPage.components=[component('heading',{text:`${child.name} details`,level:1}),
    component('record-detail',{title:`Selected ${child.name}`,columns:childCols.join(','),bindingModelId:child.id}),
    component('button',{text:`Back to ${parent.name}`,variant:'secondary',action:'navigate',targetPageId:parentPage.id,keepSelection:true})];
  // Ensure the relation contract and all page/component IDs are sound before mutating the caller.
  relationshipMetadata(project,relatedTable);
  const candidate=structuredClone(project);
  candidate.pages.push(parentPage,detailPage);
  validateProject(candidate);
  project.pages.push(parentPage,detailPage);
  return {masterPageId:parentPage.id,detailPageId:detailPage.id,tableId:relatedTable.id,route:parentPage.path};
}
