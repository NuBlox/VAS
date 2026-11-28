<script>
  /** Shared metadata-only data view. The runtime resolves all SQL identifiers from its published snapshot. */
  import {inspectDataView} from './data-views.js';
  export let node;
  export let project;
  export let pageId;
  export let records = {};
  export let selected = {};
  export let fields = {};
  export let runtimeActive = false;
  export let onSelect = () => {};

  let search = '';
  let pageNumber = 0;
  let result = {records: [], page: 0, hasMore: false};
  let failure = '';
  let requestKey = '';
  let requestNumber = 0;
  $: view = (project?.dataViews ?? []).find(v => v.id === node?.props?.dataViewId);
  $: parentId = node?.props?.relationParentModelId ? selected[node.props.relationParentModelId] : '';
  $: parentMissing = Boolean(node?.props?.relationParentModelId) && (parentId === '' || parentId === undefined || parentId === null);
  $: bindings = Object.fromEntries((view?.filters??[]).flatMap((filter,index)=>{
    if(filter.source==='form')return fields[filter.binding]===undefined?[]:[[String(index),fields[filter.binding]]];
    if(filter.source==='selected')return selected[filter.binding]===undefined?[]:[[String(index),selected[filter.binding]]];
    return [];
  }));
  $: missingBindings = (view?.filters??[]).some((filter,index)=>['form','selected'].includes(filter.source) &&
    (bindings[index]===undefined||bindings[index]===null||bindings[index]===''));
  $: offline = view ? inspectDataView(view, records?.[view.modelId] ?? [], {query: search, parentId, page: pageNumber,bindings}) : {records: [], page: 0, hasMore: false};
  $: displayed = runtimeActive ? result : offline;
  $: columns = view?.columns ?? [];
  $: primary = project?.models.find(m => m.id === view?.modelId)?.fields.find(f => f.primary)?.name ?? 'id';
  $: if (runtimeActive && view && !parentMissing && !missingBindings) {
    const key = JSON.stringify([pageId, node?.id, pageNumber, search, parentId, bindings]);
    if (key !== requestKey) { requestKey = key; void load(); }
  } else { requestKey = ''; result = {records: [], page: 0, hasMore: false}; failure = ''; }

  async function load(){
    const request = ++requestNumber;
    const selectedParent=String(parentId),requestedSearch=search,requestedPage=pageNumber;
    const params = new URLSearchParams({pageId, page: String(pageNumber), q: search, bindings: JSON.stringify(bindings)});
    if (node.props.relationParentModelId) params.set('parentId', String(parentId));
    const expectedBindings=JSON.stringify(bindings);
    try {
      const response = await fetch('/api/runtime/views/' + encodeURIComponent(node.id) + '?' + params, {cache:'no-store'});
      const body = await response.json();
      if (!response.ok) throw Error(body.error ?? 'Data view unavailable');
      if (request === requestNumber && String(parentId)===selectedParent && search===requestedSearch && pageNumber===requestedPage && JSON.stringify(bindings)===expectedBindings) {result = body; failure = '';}
    } catch (error) { if (request === requestNumber && String(parentId)===selectedParent && search===requestedSearch && pageNumber===requestedPage && JSON.stringify(bindings)===expectedBindings) {result={records:[],page:0,hasMore:false};failure=error.message;} }
  }
  function searchChanged(event){search=event.currentTarget.value;pageNumber=0;}
</script>

<section class="vas-data-view" aria-label={view?.name ?? 'Data view'}>
  <h3>{node.props.title}</h3>
  {#if view}
    {#if view.filters.some(f=>f.source==='search')}
      <label class="view-search">Search records<input aria-label={'Search ' + view.name} type="search" maxlength="80" value={search} on:input={searchChanged} placeholder="Search…" /></label>
    {/if}
    {#if parentMissing}<p>Select a parent record to display related rows.</p>{/if}
    {#if missingBindings}<p role="status">Set the required form or selected-record filter to display results.</p>{/if}
    {#if failure}<p role="status">{failure}</p>{/if}
    <div class="view-scroll"><table>
      <thead><tr><th>Select</th>{#each columns as column}<th>{column}</th>{/each}</tr></thead>
      <tbody>
        {#if !parentMissing && !missingBindings}
          {#each displayed.records as row (String(row[primary]))}
            <tr><td><button type="button" class="view-select" aria-label={'Select record ' + row[primary]} on:click={() => onSelect(row)}>Select</button></td>
              {#each columns as column}<td>{String(row[column] ?? '—')}</td>{/each}</tr>
          {:else}<tr><td colspan={columns.length + 1}>No matching records.</td></tr>{/each}
        {/if}
      </tbody>
    </table></div>
    <nav aria-label="Data view pages"><button type="button" disabled={pageNumber===0||parentMissing} on:click={() => pageNumber--}>Previous</button><span>Page {pageNumber+1}</span><button type="button" disabled={!displayed.hasMore||parentMissing} on:click={() => pageNumber++}>Next</button></nav>
  {:else}<p>This table has no published data view.</p>{/if}
</section>
<style>
  .vas-data-view{display:grid;gap:.7rem;min-width:0}
  h3{margin:0}.view-search{display:grid;gap:.3rem}.view-search input{padding:.6rem;border:1px solid #c6d2e6;border-radius:7px}
  .view-scroll{overflow-x:auto}.view-scroll table{border-collapse:collapse;width:100%}.view-scroll th,.view-scroll td{padding:.65rem;text-align:left;border-bottom:1px solid #dee5ee}
  nav{display:flex;align-items:center;justify-content:flex-end;gap:.65rem}button{border:0;border-radius:6px;cursor:pointer;padding:.5rem .75rem;background:#dce7f8;color:#173c6a}button:disabled{opacity:.5;cursor:default}
</style>
