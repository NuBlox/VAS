/** Export is declarative UI markup; it never executes project-supplied JavaScript. */
import { validateProject } from './model.js';
export function escapeHtml(value='') {return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
export function exportPageToSvelte(page) {
  const E=escapeHtml;
  const output=['<!-- Generated UI only: actions, access control and persistence require runtime wiring. -->','<main class="generated-page">'];
  function emit(nodes,indent='  ') {
    for(const {type,props:p,children=[]} of nodes){
      switch(type){
        case 'section': case 'columns':
          output.push(`${indent}<section class="${type==='columns'?'layout-columns':'layout-section'}"><h2>${E(p.title)}</h2>`);
          emit(children,indent+'  ');output.push(`${indent}</section>`);break;
        case 'heading': {const h=[1,2,3,4].includes(Number(p.level))?Number(p.level):2;output.push(`${indent}<h${h}>${E(p.text)}</h${h}>`);break;}
        case 'text':output.push(`${indent}<p>${E(p.text)}</p>`);break;
        case 'input':output.push(`${indent}<label>${E(p.label)}<input name="${E(p.field)}" placeholder="${E(p.placeholder)}"${p.required?' required':''} /></label>`);break;
        case 'textarea':output.push(`${indent}<label>${E(p.label)}<textarea name="${E(p.field)}" placeholder="${E(p.placeholder)}"${p.required?' required':''}></textarea></label>`);break;
        case 'select':output.push(`${indent}<label>${E(p.label)}<select name="${E(p.field)}"${p.required?' required':''}>${String(p.options??'').split('\n').filter(Boolean).map(o=>`<option>${E(o)}</option>`).join('')}</select></label>`);break;
        case 'checkbox':output.push(`${indent}<label><input type="checkbox" name="${E(p.field)}"${p.required?' required':''} /> ${E(p.label)}</label>`);break;
        case 'button':output.push(`${indent}<button type="button" class="${p.variant==='secondary'?'secondary':'primary'}">${E(p.text)}</button>`);break;
        case 'card':output.push(`${indent}<section class="card"><h3>${E(p.title)}</h3><p>${E(p.body)}</p></section>`);break;
        case 'divider':output.push(`${indent}<hr />`);break;
        case 'record-detail':{const cols=String(p.columns??'').split(',').map(x=>x.trim()).filter(Boolean);output.push(`${indent}<section><h3>${E(p.title)}</h3><dl>${cols.map(x=>`<dt>${E(x)}</dt><dd>Selected value</dd>`).join('')}</dl></section>`);break;}
        case 'table':{const cols=String(p.columns??'').split(',').map(x=>x.trim()).filter(Boolean);output.push(`${indent}<section><h3>${E(p.title)}</h3><table><thead><tr>${cols.map(x=>`<th>${E(x)}</th>`).join('')}</tr></thead><tbody></tbody></table></section>`);break;}
        default:throw new Error(`Cannot export component: ${type}`);
      }
    }
  }
  emit(page.components);
  output.push('</main>','<style>','.generated-page { max-width:900px; padding:2rem; margin:auto; display:grid; gap:1rem; font:14px system-ui }','.layout-section { border:1px solid #dce3ef; padding:1rem; display:grid; gap:1rem; border-radius:12px }','.layout-columns { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; }','.layout-columns > h2 { grid-column:1/-1 }','@media(max-width:620px) { .layout-columns { grid-template-columns:1fr } }','label {display:grid;gap:0.5rem} input,textarea,select {padding:0.7rem;border:1px solid #cbd5e1;border-radius:7px}','.card{padding:1rem;border:1px solid #dce3ef;border-radius:10px}button{padding:0.8rem;border:0;border-radius:8px}.primary{background:#2563eb;color:white}.secondary{background:#e2e8f0}', '</style>');
  return output.join('\n');
}
/** MySQL 8 compatible initial schema only. Never runs SQL against a real database. */
export function exportMySQL(project) {
  validateProject(project);
  const t={string:'VARCHAR(255)',text:'TEXT',integer:'BIGINT UNSIGNED',decimal:'DECIMAL(18,4)',boolean:'TINYINT(1)',date:'DATE',datetime:'DATETIME(3)'};
  const quote=id=>'`'+id+'`'; // validated ASCII SQL identifiers, no arbitrary SQL fragments
  const lines=['-- Generated MySQL schema. Review migrations before applying.','-- Visual Application Studio schema version 3',''];
  for(const model of project.models) {
    const columns=model.fields.map(f=>{
      let sql=`  ${quote(f.name)} ${t[f.type]}`;
      if(f.required||f.primary)sql+=' NOT NULL';
      if(f.primary&&f.type==='integer')sql+=' AUTO_INCREMENT';
      if(f.unique&&!f.primary)sql+=' UNIQUE';
      return sql;
    });
    const pk=model.fields.find(f=>f.primary);
    columns.push(`  PRIMARY KEY (${quote(pk.name)})`);
    lines.push(`CREATE TABLE IF NOT EXISTS ${quote(model.table)} (`,columns.join(',\n'),' ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;'.trimStart(),'');
  }
  // Foreign keys follow table creation so model ordering does not matter.
  for(const model of project.models)for(const f of model.fields)if(f.referenceModelId){
    const target=project.models.find(m=>m.id===f.referenceModelId),targetField=target.fields.find(x=>x.id===f.referenceFieldId);
    const constraint=`fk_${model.table}_${f.name}`;
    if(constraint.length>64)throw new Error('Foreign key constraint name exceeds MySQL 64-character limit');
    lines.push(`ALTER TABLE ${quote(model.table)} ADD CONSTRAINT ${quote(constraint)} FOREIGN KEY (${quote(f.name)}) REFERENCES ${quote(target.table)} (${quote(targetField.name)});`);
  }
  return lines.join('\n')+'\n';
}
