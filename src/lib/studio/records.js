/** Shared, deterministic validation for model-bound records. No dynamic code execution. */
export class RecordError extends Error {
  constructor(message, status=400) { super(message); this.name='RecordError'; this.status=status; }
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const utf8Bytes = value => new TextEncoder().encode(value).length;
function validDate(text) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
  const [y,m,d]=text.split('-').map(Number);
  if(y<1000||y>9999||m<1||m>12||d<1||d>31)return false;
  const actual=new Date(Date.UTC(y,m-1,d));
  return actual.getUTCFullYear()===y&&actual.getUTCMonth()+1===m&&actual.getUTCDate()===d;
}
export function normaliseValue(field,value) {
  if(value===null||value===undefined||value==='') {
    if(field.required||field.primary)throw new RecordError(`${field.name} is required`);
    return null;
  }
  switch(field.type) {
    case 'string':case 'text':{
      if(typeof value!=='string')throw new RecordError(`${field.name} must be text`);
      if(field.required&&!value.trim())throw new RecordError(`${field.name} is required`);
      if(utf8Bytes(value)>(field.type==='string'?255:65535))throw new RecordError(`${field.name} is too long`);
      return value;
    }
    case 'integer':{
      if(!((typeof value==='string'&&value.length<=20&&/^(0|[1-9]\d*)$/.test(value))||(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)))throw new RecordError(`${field.name} must be a non-negative integer`);
      const n=BigInt(value);
      if(n>18446744073709551615n)throw new RecordError(`${field.name} exceeds BIGINT UNSIGNED`);
      return n.toString();
    }
    case 'decimal':{
      if(!(typeof value==='string'||typeof value==='number')||!(/^-?\d{1,14}(?:\.\d{1,4})?$/.test(String(value))))throw new RecordError(`${field.name} requires DECIMAL(18,4)`);
      return String(value);
    }
    case 'boolean':{
      if(typeof value!=='boolean')throw new RecordError(`${field.name} must be true or false`);
      return value?1:0;
    }
    case 'date':{
      if(typeof value!=='string'||!validDate(value))throw new RecordError(`${field.name} requires YYYY-MM-DD`);
      return value;
    }
    case 'datetime':{
      if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value))throw new RecordError(`${field.name} requires a local date/time`);
      const clean=value.replace('T',' '),[date,time]=clean.split(' ');
      if(!validDate(date))throw new RecordError(`${field.name} has an invalid date`);
      const [h,m,s='0']=time.split(':');
      if(+h>23||+m>59||+s.split('.')[0]>59)throw new RecordError(`${field.name} has an invalid time`);
      return clean;
    }
    default:throw new RecordError('Unsupported field type');
  }
}
export function primaryField(model){const pk=model.fields.find(field=>field.primary);if(!pk)throw new RecordError('Missing model primary key');return pk;}
export function normaliseId(model,raw) { return normaliseValue(primaryField(model),raw); }
export function validateRecord(model,payload,operation='create') {
  if(!plain(payload))throw new RecordError('Expected a JSON object');
  if(!['create','update'].includes(operation))throw new RecordError('Unknown operation');
  const pk=primaryField(model),byName=new Map(model.fields.map(f=>[f.name,f]));
  const output={};
  for(const [name,value] of Object.entries(payload)){
    const field=byName.get(name);
    if(!field||field.primary)throw new RecordError(`Field ${name} is not writable`);
    output[name]=normaliseValue(field,value);
  }
  if(operation==='create')for(const field of model.fields){
    if(!field.primary&&field.required&&!Object.hasOwn(output,field.name))throw new RecordError(`${field.name} is required`);
  }
  if(operation==='update'&&!Object.keys(output).length)throw new RecordError('No fields supplied for update');
  if(operation==='create'&&pk.type!=='integer')throw new RecordError('This version requires an integer auto-generated primary key');
  return output;
}
export function quoteIdentifier(name) {
  if(typeof name!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(name))throw new RecordError('Invalid SQL identifier');
  return '`'+name+'`';
}
/** Generates allowlisted, parameterised statements from a validated published model. */
export function sqlFor(model,operation,data={},id) {
  const table=quoteIdentifier(model.table),pk=quoteIdentifier(primaryField(model).name);
  if(operation==='list')return {sql:`SELECT * FROM ${table} ORDER BY ${pk} DESC LIMIT 50`,params:[]};
  if(operation==='get')return {sql:`SELECT * FROM ${table} WHERE ${pk} = ? LIMIT 1`,params:[normaliseId(model,id)]};
  if(operation==='delete')return {sql:`DELETE FROM ${table} WHERE ${pk} = ? LIMIT 1`,params:[normaliseId(model,id)]};
  if(operation==='create'||operation==='update') {
    const checked=validateRecord(model,data,operation),keys=Object.keys(checked),params=keys.map(k=>checked[k]);
    if(operation==='create')return keys.length?{sql:`INSERT INTO ${table} (${keys.map(quoteIdentifier).join(', ')}) VALUES (${keys.map(()=>'?').join(', ')})`,params}:{sql:`INSERT INTO ${table} () VALUES ()`,params:[]};
    return {sql:`UPDATE ${table} SET ${keys.map(k=>`${quoteIdentifier(k)} = ?`).join(', ')} WHERE ${pk} = ? LIMIT 1`,params:[...params,normaliseId(model,id)]};
  }
  throw new RecordError('Unsupported record operation');
}
export function jsonRecord(record) {
  if(!record)return null;
  return Object.fromEntries(Object.entries(record).map(([key,value])=>[key,typeof value==='bigint'?value.toString():value instanceof Date?value.toISOString():value]));
}
