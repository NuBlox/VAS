/** Read-only published data-view execution. SQL is compiled only from validated metadata. */
import { RecordError, normaliseValue, normaliseId, quoteIdentifier, jsonRecord } from '../../studio/records.js';
import { viewForComponent,assertViewBindings } from '../../studio/data-views.js';
import { assertModelPermission } from './policy.js';

const q=quoteIdentifier;
export function viewStatements(config,{query='',parentId='',page='0',bindings={}}={}){
  const {view,model,parent,foreign}=config;
  if(typeof query!=='string'||query.length>80||/\u0000/.test(query))throw new RecordError('Invalid search query');
  if(!/^(0|[1-9]\d{0,2})$/.test(String(page))||Number(page)>40)throw new RecordError('Data-view page limit exceeded');
  try{assertViewBindings(view,bindings);}catch(e){throw new RecordError(e.message);}
  const pk=model.fields.find(f=>f.primary);
  if(!pk)throw new RecordError('Model primary key unavailable',503);
  const selectFields=[...new Set([...view.columns,pk.name])];
  const where=[],params=[];
  let parentQuery=null;const selectedQueries=[];
  for(const [index,filter] of view.filters.entries()){
    const field=model.fields.find(f=>f.name===filter.field);
    let val;
    if(filter.source==='literal')val=filter.value;
    else if(filter.source==='search'){
      if(!query)continue;
      val=query;
    }else if(filter.source==='form'||filter.source==='selected'){
      val=bindings[index];
      if(filter.source==='selected'){
        const selectedModel=config.selectedModels?.get(filter.binding);
        const primary=selectedModel?.fields.find(f=>f.primary);
        if(!selectedModel||!primary)throw new RecordError('Invalid selected-record filter',503);
        val=normaliseId(selectedModel,val);
        selectedQueries.push({modelId:selectedModel.id,sql:`SELECT 1 FROM ${q(selectedModel.table)} WHERE ${q(primary.name)} = ? LIMIT 1`,params:[val]});
      }
    }else{
      if(!parent||!foreign)throw new RecordError('Invalid published parent filter',503);
      val=normaliseId(parent,parentId);
      if(!parentQuery){const parentPk=parent.fields.find(f=>f.primary);
        parentQuery={sql:`SELECT 1 FROM ${q(parent.table)} WHERE ${q(parentPk.name)} = ? LIMIT 1`,params:[val]};}
    }
    const fieldSql=q(field.name);
    if(filter.operator==='contains'){
      where.push(`LOCATE(?, ${fieldSql}) > 0`);params.push(String(val));
    }else{
      const checked=normaliseValue(field,val);
      if(checked===null)throw new RecordError('Empty data-view predicate');
      where.push(`${fieldSql} ${filter.operator==='gte'?'>=':filter.operator==='lte'?'<=':'='} ?`);
      params.push(checked);
    }
  }
  // Mandatory parent scope cannot be omitted or rewritten by untrusted query parameters.
  if(foreign&&!parentQuery)throw new RecordError('Parent selection is required');
  const sort=q(view.sort.field),direction=view.sort.direction.toUpperCase();
  const order=`${sort} ${direction}${view.sort.field===pk.name?'':`, ${q(pk.name)} ASC`}`;
  const offset=Number(page)*view.pageSize;
  const sql=`SELECT ${selectFields.map(q).join(', ')} FROM ${q(model.table)}${where.length?' WHERE '+where.join(' AND '):''} ORDER BY ${order} LIMIT ? OFFSET ?`;
  return {sql,params:[...params,view.pageSize,offset],parentQuery,selectedQueries,page:Number(page),limit:view.pageSize};
}
export async function executePublishedView(db,project,{pageId,componentId,query='',parentId='',page='0',bindings={}},actor,policy){
  let config;
  try{config=viewForComponent(project,pageId,componentId);}catch(e){throw new RecordError(e.message,503);}
  assertModelPermission(actor,config.model.id,'read',policy);
  if(config.parent)assertModelPermission(actor,config.parent.id,'read',policy);
  const selectedModels=new Map();
  for(const filter of config.view.filters.filter(f=>f.source==='selected')){
    const model=project.models.find(m=>m.id===filter.binding);
    if(!model)throw new RecordError('Invalid published selected-record filter',503);
    assertModelPermission(actor,model.id,'read',policy);
    selectedModels.set(model.id,model);
  }
  const statement=viewStatements({...config,selectedModels},{query,parentId,page,bindings});
  for(const check of statement.selectedQueries){
    const [rows]=await db.execute(check.sql,check.params);
    if(!rows.length)throw new RecordError('Selected record not found',404);
  }
  if(statement.parentQuery){
    const [parents]=await db.execute(statement.parentQuery.sql,statement.parentQuery.params);
    if(!parents.length)throw new RecordError('Parent record not found',404);
  }
  const [rows]=await db.execute(statement.sql,statement.params);
  return {records:rows.map(jsonRecord),page:statement.page,limit:statement.limit,hasMore:rows.length===statement.limit};
}
