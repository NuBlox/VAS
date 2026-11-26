/** Destructive only inside a disposable loopback MySQL acceptance database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createAcceptanceProject} from '../scripts/generate-customer-order-acceptance.mjs';
import {scaffoldMasterDetail} from '../src/lib/studio/master-detail.js';
import {exportMySQL} from '../src/lib/studio/compiler.js';
const safe=(process.env.GITHUB_ACTIONS==='true'||process.env.VAS_ACCEPTANCE_DISPOSABLE==='yes') &&
  process.env.MYSQL_INTEGRATION==='1' && (process.env.DB_HOST??'127.0.0.1')==='127.0.0.1' &&
  (process.env.DB_NAME??'visual_studio_dev')==='visual_studio_dev';
test('exported master-detail runtime returns only the chosen customer orders with role checks and pagination',{
  skip:safe?false:'Requires a disposable CI MySQL 8 database and explicit opt-in'
},async t=>{
  const directory=await mkdtemp(join(tmpdir(),'vas19-mysql-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const project=createAcceptanceProject(),customer=project.models[0],order=project.models[1];
  const foreign=order.fields.find(f=>f.referenceModelId===customer.id);
  const {masterPageId,tableId}=scaffoldMasterDetail(project,customer.id,order.id,foreign.id);
  const projectPath=join(directory,'project.json'),output=join(directory,'generated-app');
  await writeFile(projectPath,JSON.stringify(project));
  const generated=spawnSync(process.execPath,[resolve('scripts/export-application.mjs'),'--project',projectPath,'--out',output],{encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const runtime=await import(pathToFileURL(join(output,'src/lib/server/runtime/relations.js')).href);
  const {createPool}=await import('mysql2/promise');
  const pool=createPool({host:'127.0.0.1',port:Number(process.env.DB_PORT??3306),database:'visual_studio_dev',
    user:process.env.DB_USER??'root',password:process.env.DB_PASSWORD??'',connectionLimit:3,bigNumberStrings:true,dateStrings:true});
  try{
    await pool.query('DROP TABLE IF EXISTS `vas_acceptance_orders`');
    await pool.query('DROP TABLE IF EXISTS `vas_acceptance_customers`');
    for(const query of exportMySQL(project).split(';').map(q=>q.trim()).filter(Boolean))await pool.query(query);
    await pool.execute('INSERT INTO `vas_acceptance_customers` (`name`,`email`) VALUES (?,?),(?,?)', ['Ada','ada@example.test','Grace','grace@example.test']);
    const [parents]=await pool.execute('SELECT `id`,`name` FROM `vas_acceptance_customers` ORDER BY `id`');
    const [ada,grace]=parents.map(p=>String(p.id));
    for(let i=0;i<4;i++)await pool.execute('INSERT INTO `vas_acceptance_orders` (`name`,`customer_id`,`amount`) VALUES (?,?,?)',[`Ada #${i}`,ada,'10.00']);
    await pool.execute('INSERT INTO `vas_acceptance_orders` (`name`,`customer_id`,`amount`) VALUES (?,?,?)',['Grace #1',grace,'20.00']);
    const actor={id:'reader',role:'viewer'};
    const get=(parent,page='0',limit='2',policy=null)=>runtime.listRelatedRecords(pool,project,masterPageId,tableId,parent,page,limit,actor,policy);
    const first=await get(ada),second=await get(ada,'1'),last=await get(ada,'2');
    assert.equal(first.records.length,2);assert.equal(first.hasMore,true);
    assert.equal(second.records.length,2);assert.equal(last.records.length,0);
    assert.ok([...first.records,...second.records].every(row=>row.name.startsWith('Ada #')));
    const graceOrders=await get(grace);assert.deepEqual(graceOrders.records.map(r=>r.name),['Grace #1']);
    await assert.rejects(get('999999999'),{status:404});
    await assert.rejects(get('1 OR 1=1'),{status:400});
    await assert.rejects(get(ada,'41'),{status:400});
    await assert.rejects(get(ada,'0','26'),{status:400});
    await assert.rejects(runtime.listRelatedRecords(pool,project,masterPageId,tableId,ada,'0','20',actor,
      {models:{[customer.id]:{read:['admin']}}}),{status:403});
    await assert.rejects(runtime.listRelatedRecords(pool,project,masterPageId,tableId,ada,'0','20',actor,
      {models:{[order.id]:{read:['admin']}}}),{status:403});
    await assert.rejects(runtime.listRelatedRecords(pool,project,masterPageId,'invalid',ada,'0','20',actor,null),{status:404});
  }finally{
    try{await pool.query('DROP TABLE IF EXISTS `vas_acceptance_orders`');await pool.query('DROP TABLE IF EXISTS `vas_acceptance_customers`');}finally{await pool.end();}
  }
});
