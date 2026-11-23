import { RecordError, sqlFor, normaliseId, jsonRecord } from '../../studio/records.js';

export function getPublishedModel(project,modelId) {
  const model=project.models.find(m=>m.id===modelId);
  if(!model)throw new RecordError('Model is not published to this runtime',404);
  return model;
}
export async function listRecords(db,model) {
  const {sql,params}=sqlFor(model,'list');
  const [rows]=await db.execute(sql,params);
  return rows.map(jsonRecord);
}
export async function getRecord(db,model,id) {
  const {sql,params}=sqlFor(model,'get',{},id);
  const [rows]=await db.execute(sql,params);
  if(!rows.length)throw new RecordError('Record not found',404);
  return jsonRecord(rows[0]);
}
export async function createRecord(db,model,payload) {
  const {sql,params}=sqlFor(model,'create',payload);
  // INSERT and LAST_INSERT_ID() use the same pooled connection.
  const connection=await db.getConnection();
  try{
    await connection.execute(sql,params);
    const [ids]=await connection.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
    return await getRecord(connection,model,ids[0].id);
  }finally{connection.release();}
}
export async function updateRecord(db,model,id,payload) {
  const {sql,params}=sqlFor(model,'update',payload,id);
  const [result]=await db.execute(sql,params);
  if(!result.affectedRows)throw new RecordError('Record not found',404);
  return getRecord(db,model,id);
}
export async function deleteRecord(db,model,id) {
  const {sql,params}=sqlFor(model,'delete',{},id);
  const [result]=await db.execute(sql,params);
  if(!result.affectedRows)throw new RecordError('Record not found',404);
  return {deleted:true,id:normaliseId(model,id)};
}
