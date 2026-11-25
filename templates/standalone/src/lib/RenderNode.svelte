<script>
  /** Recursive, metadata-only UI renderer. No project-supplied expressions or HTML execute. */
  export let node;
  export let fields;
  export let records;
  export let selected;
  export let primaryNames;
  export let busy = false;
  export let action;
  export let change;
  export let choose;
  const props = node.props;
  const columns = String(props.columns ?? '').split(',').map(c => c.trim()).filter(Boolean);
  const heading = [1, 2, 3, 4].includes(Number(props.level)) ? `h${props.level}` : 'h2';
</script>

{#if node.type === 'section' || node.type === 'columns'}
  <section class:columns={node.type === 'columns'} class="container">
    {#if props.title}<h2>{props.title}</h2>{/if}
    {#each node.children ?? [] as child (child.id)}
      <svelte:self node={child} {fields} {records} {selected} {primaryNames} {busy} {action} {change} {choose} />
    {/each}
  </section>
{:else if node.type === 'heading'}
  <svelte:element this={heading}>{props.text}</svelte:element>
{:else if node.type === 'text'}
  <p>{props.text}</p>
{:else if node.type === 'card'}
  <article class="card"><h3>{props.title}</h3><p>{props.body}</p></article>
{:else if node.type === 'divider'}
  <hr />
{:else if node.type === 'input' || node.type === 'textarea' || node.type === 'select'}
  <label><span>{props.label}</span>
    {#if node.type === 'textarea'}
      <textarea name={props.field} placeholder={props.placeholder ?? ''} required={props.required ?? false} value={fields[props.field] ?? ''} on:input={event => change(props.field, event.currentTarget.value)} on:change={event => {change(props.field,event.currentTarget.value);action(node,'change');}} on:blur={() => action(node,'blur')}></textarea>
    {:else if node.type === 'select'}
      <select name={props.field} required={props.required ?? false} value={fields[props.field] ?? ''} on:change={event => {change(props.field,event.currentTarget.value);action(node,'change');}}>
        <option value="">Choose…</option>
        {#each String(props.options ?? '').split('\n').filter(Boolean) as option}
          <option value={option}>{option}</option>
        {/each}
      </select>
    {:else}
      <input name={props.field} placeholder={props.placeholder ?? ''} required={props.required ?? false} value={fields[props.field] ?? ''} on:input={event => change(props.field, event.currentTarget.value)} on:change={event => {change(props.field,event.currentTarget.value);action(node,'change');}} on:blur={() => action(node,'blur')} />
    {/if}
  </label>
{:else if node.type === 'checkbox'}
  <label class="inline"><input type="checkbox" name={props.field} checked={Boolean(fields[props.field])} on:change={event => {change(props.field,event.currentTarget.checked);action(node,'change');}} /> {props.label}</label>
{:else if node.type === 'button'}
  <button class:secondary={props.variant === 'secondary'} type="button" disabled={busy} on:click={() => action(node)}>{props.text}</button>
{:else if node.type === 'table'}
  <section class="table-wrap"><h3>{props.title}</h3>
    {#if !props.bindingModelId}<p>Bind this table to a model to display records.</p>
    {:else}
      <table><thead><tr><th>Selection</th>{#each columns as col}<th>{col}</th>{/each}</tr></thead><tbody>
        {#each records[props.bindingModelId] ?? [] as item, index}
          <tr><td><input type="radio" name={'selected-' + props.bindingModelId} checked={String(selected[props.bindingModelId] ?? '') === String(item[primaryNames[props.bindingModelId]])} aria-label={'Select row ' + (index + 1)} on:change={() => choose(props.bindingModelId, item)} /></td>
            {#each columns as col}<td>{String(item[col] ?? '')}</td>{/each}
          </tr>
        {:else}<tr><td colspan={columns.length + 1}>No records loaded</td></tr>{/each}
      </tbody></table>
    {/if}
  </section>
{/if}

<style>
  .container{display:grid;gap:1rem;border:1px solid #dbe3ef;border-radius:12px;padding:1.2rem;min-width:0}
  .columns{grid-template-columns:repeat(2,minmax(0,1fr))}.columns>h2{grid-column:1/-1}
  label{display:grid;gap:.4rem;color:#34435c}label span{font-weight:600;font-size:.85rem}
  input:not([type=checkbox]):not([type=radio]),textarea,select{width:100%;box-sizing:border-box;padding:.7rem;border:1px solid #c8d3e3;border-radius:7px;font:inherit}
  .inline{display:flex;align-items:center;gap:.55rem}
  button{justify-self:start;border:0;border-radius:8px;padding:.7rem 1.15rem;background:#2563eb;color:white;font-weight:650;cursor:pointer}
  button.secondary{background:#e2e8f0;color:#2d3f5f}button:disabled{opacity:.55;cursor:wait}
  .card{border:1px solid #d7e1ee;border-radius:10px;padding:1rem} .card h3{margin-top:0}
  .table-wrap{min-width:0;overflow-x:auto}.table-wrap table{width:100%;border-collapse:collapse}.table-wrap th,.table-wrap td{padding:.7rem;border-bottom:1px solid #e1e6f0;text-align:left}
  @media(max-width:640px){.columns{grid-template-columns:1fr}.columns>h2{grid-column:auto}}
</style>
