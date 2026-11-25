<script>
  import { onMount } from 'svelte';
  import project from '../../runtime/project.json' with { type: 'json' };
  import { projectRevision } from './studio/revision.js';
  import { walkNodes } from './studio/model.js';
  import { eventContextForTrigger } from './studio/workflow.js';
  import RenderNode from './RenderNode.svelte';

  const revision = projectRevision(project);
  const primaryNames = Object.fromEntries(project.models.map(model => [model.id, model.fields.find(field => field.primary)?.name]));
  const endpoint = '/api/runtime';
  let currentPage = project.pages[0];
  let fields = {};
  let selected = {};
  let records = {};
  let runtime = null;
  let username = '';
  let password = '';
  let notice = '';
  let busy = false;
  let pendingWorkflow = null;

  const headers = { 'x-studio-project-id': project.id, 'x-studio-project-revision': revision };
  function setPage(pageId, push = true) {
    const page = project.pages.find(p => p.id === pageId);
    if (!page) return;
    currentPage = page;
    fields = {};
    selected = {};
    notice = '';
    pendingWorkflow = null;
    if (push && typeof window !== 'undefined') window.history.pushState({}, '', page.path);
  }
  function change(field, value) { fields = { ...fields, [field]: value }; }
  function choose(modelId, item) {
    const model = project.models.find(m => m.id === modelId);
    if (!model) return;
    const pk = model.fields.find(f => f.primary)?.name;
    if (!pk) return;
    selected = { ...selected, [modelId]: String(item[pk]) };
    const values = {};
    walkNodes(currentPage.components, n => {
      if (n.props?.bindingModelId !== modelId || !n.props.bindingFieldId) return;
      const field = model.fields.find(f => f.id === n.props.bindingFieldId);
      if (field && n.props.field && field.name in item) values[n.props.field] = item[field.name];
    });
    fields = { ...fields, ...values };
  }
  async function request(path, options = {}) {
    const response = await fetch(endpoint + path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...headers, ...(options.headers ?? {}) } });
    const body = await response.json();
    if (!response.ok) { const error = Error(body?.error ?? `Request failed (${response.status})`); error.status = response.status; throw error; }
    return body;
  }
  async function refreshStatus() {
    runtime = await request('');
    if (runtime.authenticated) await refreshRecords();
  }
  async function refreshRecords() {
    if (!runtime?.authenticated) return;
    const ids = new Set();
    for (const page of project.pages) walkNodes(page.components, n => {
      if (n.type === 'table' && n.props.bindingModelId) ids.add(n.props.bindingModelId);
    });
    const updated = {};
    for (const modelId of ids) {
      try { updated[modelId] = (await request('/models/' + encodeURIComponent(modelId))).records; }
      catch (error) { notice = error.message; updated[modelId] = []; }
    }
    records = updated;
  }
  async function login() {
    busy = true; notice = '';
    try {
      await request('/auth/login', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id: username, password }) });
      password = '';
      await refreshStatus();
    } catch (error) { notice = error.message; }
    finally { busy = false; }
  }
  async function logout() {
    busy = true;
    try { await request('/auth/logout', { method:'POST' }); runtime = null; records = {}; selected = {}; fields = {}; pendingWorkflow = null; await refreshStatus(); }
    catch(error){notice=error.message;}finally{busy=false;}
  }
  function boundValues(modelId) {
    const model = project.models.find(m => m.id === modelId);
    if (!model) throw Error('Unknown model');
    const values = {};
    walkNodes(currentPage.components, n => {
      if (n.props?.bindingModelId !== modelId || !n.props.bindingFieldId) return;
      const field = model.fields.find(f => f.id === n.props.bindingFieldId);
      if (field && !field.primary && n.props.field && fields[n.props.field] !== undefined && fields[n.props.field] !== '') values[field.name] = fields[n.props.field];
    });
    return values;
  }
  function applyEffects(effects = []) {
    for (const effect of effects) {
      if (effect.type === 'navigate') setPage(effect.pageId);
      if (effect.type === 'message') notice = effect.text;
      if (effect.type === 'reset') { fields = {}; selected = {}; }
      if (effect.type === 'set_field') change(effect.field, effect.value);
    }
  }
  async function action(node, event = 'click') {
    const props = node.props;
    const workflow = project.workflows.find(w => w.trigger.pageId === currentPage.id && w.trigger.componentId === node.id && w.trigger.event === event);
    if (!workflow && event !== 'click') return;
    if (!workflow && props.action === 'navigate') { setPage(props.targetPageId); return; }
    if (!workflow && props.action === 'message') { notice = props.text || 'Action completed'; return; }
    if (!workflow && props.action === 'reset') { fields = {}; selected = {}; return; }
    if (!runtime?.authenticated) { notice = 'Sign in to use database actions'; return; }
    busy = true; notice = '';
    try {
      if (workflow) {
        const destructive = workflow.steps.some(s => s.type === 'delete');
        if (destructive && !window.confirm('Delete selected records?')) return;
        const payload = { pageId: currentPage.id, componentId: node.id, event, eventContext: eventContextForTrigger(workflow,node,fields), fields, selectedRecords: selected, confirmDelete: destructive };
        const fingerprint = JSON.stringify({workflowId: workflow.id, payload});
        const key = pendingWorkflow?.fingerprint === fingerprint ? pendingWorkflow.key : crypto.randomUUID();
        pendingWorkflow = {fingerprint, key};
        const result = await request('/workflows/' + encodeURIComponent(workflow.id), {
          method: 'POST', headers: { 'content-type':'application/json', 'idempotency-key': key },
          body: JSON.stringify(payload)
        });
        pendingWorkflow = null;
        applyEffects(result.effects);
        await refreshRecords();
        if (!result.effects.some(e => e.type === 'message')) notice = 'Workflow completed';
        return;
      }
      const modelId = props.bindingModelId;
      if (!modelId || !['create','update','delete'].includes(props.action)) { notice = 'This button has no database action'; return; }
      const base = '/models/' + encodeURIComponent(modelId);
      const id = selected[modelId];
      if (['update','delete'].includes(props.action) && !id) throw Error('Select a record first');
      if (props.action === 'delete' && !window.confirm('Permanently delete this record?')) return;
      const method = {create:'POST',update:'PATCH',delete:'DELETE'}[props.action];
      await request(base + (id && method !== 'POST' ? '/' + encodeURIComponent(id) : ''), {
        method, ...(method !== 'DELETE' ? {headers:{'content-type':'application/json'},body:JSON.stringify(boundValues(modelId))}: {})
      });
      notice = 'Record ' + (props.action === 'delete' ? 'deleted' : 'saved');
      await refreshRecords();
    } catch(error) { if (error.status === 409) pendingWorkflow = null; notice = error.message; }
    finally { busy = false; }
  }
  onMount(() => {
    const initial = project.pages.find(p => p.path === window.location.pathname);
    if (initial) setPage(initial.id, false);
    const pop = () => { const page = project.pages.find(p => p.path === window.location.pathname); if (page) setPage(page.id, false); };
    window.addEventListener('popstate', pop);
    refreshStatus().catch(error => notice = error.message);
    return () => window.removeEventListener('popstate', pop);
  });
</script>

<svelte:head>
  <title>{project.name}</title>
  <meta name="description" content="Independent application generated from Visual Application Studio" />
</svelte:head>
<div class="app-shell">
  <header><div><small>STANDALONE APPLICATION</small><h1>{project.name}</h1></div>
    {#if runtime?.authenticated}
      <div class="identity">{runtime.actor?.id} · {runtime.actor?.role} <button type="button" on:click={logout} disabled={busy}>Sign out</button></div>
    {:else}
      <form on:submit|preventDefault={login}>
        <input aria-label="Username" autocomplete="username" placeholder="Username" bind:value={username} required />
        <input aria-label="Password" type="password" autocomplete="current-password" placeholder="Password" bind:value={password} required />
        <button disabled={busy} type="submit">Sign in</button>
      </form>
    {/if}
  </header>
  <div class="layout"><nav aria-label="Application navigation">
    {#each project.pages as page (page.id)}
      <button type="button" class:active={currentPage.id === page.id} on:click={() => setPage(page.id)}>{page.name}</button>
    {/each}
    <small>Release {runtime?.releaseId?.slice(0,12) ?? 'offline'}</small>
  </nav>
  <main><h2>{currentPage.name}</h2>
    {#if notice}<div role="status" class="notice">{notice}</div>{/if}
    {#if runtime && !runtime.enabled}<p class="warning">Database runtime unavailable. This generated application remains usable for navigation and layout preview, but persistent records require configured localhost MySQL and a local account.</p>{/if}
    <div class="canvas">
      {#each currentPage.components as node (node.id)}
        <RenderNode {node} {fields} {records} {selected} {primaryNames} {busy} {action} {change} {choose} />
      {/each}
    </div>
  </main></div>
</div>
<style>
  :global(*){box-sizing:border-box}:global(body){margin:0;font:15px/1.45 system-ui,Arial,sans-serif;color:#21334a;background:#f2f6fb}
  header{display:flex;justify-content:space-between;gap:1rem;align-items:center;background:#182f54;color:#fff;padding:1.3rem 2rem;flex-wrap:wrap}
  header small{letter-spacing:.14em;opacity:.75;font-size:.65rem}header h1{margin:.2rem 0;font-size:1.3rem}
  form{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}form input{padding:.65rem;border-radius:6px;border:1px solid #9baecb;max-width:170px}
  button{cursor:pointer}header button{background:#417de1;border:0;color:white;padding:.7rem;border-radius:6px}
  .identity{display:flex;gap:.8rem;align-items:center}
  .layout{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:calc(100vh - 80px)}nav{background:white;border-right:1px solid #dce4ee;padding:1.5rem 1rem;display:flex;flex-direction:column;gap:.4rem}
  nav button{width:100%;border:0;border-radius:7px;padding:.85rem;text-align:left;background:transparent;color:#35455f}nav button.active{background:#dbe8fa;color:#1553ac;font-weight:700}nav small{margin-top:auto;color:#8291a8;font-size:.7rem}
  main{max-width:1000px;width:100%;padding:2rem;margin:0 auto}main h2{margin-top:0}.canvas{display:grid;gap:1.2rem;background:white;padding:1.5rem;border-radius:12px;border:1px solid #dae4f0;min-width:0}
  .notice{padding:.85rem;background:#e4f1ff;border-left:4px solid #2563eb;margin-bottom:1rem}.warning{background:#fff4dc;padding:1rem;border-radius:8px;color:#61450e}
  @media(max-width:700px){.layout{grid-template-columns:1fr}nav{border-bottom:1px solid #dce4ee;flex-direction:row;flex-wrap:wrap}nav button{width:auto}main{padding:1rem}.canvas{padding:1rem}}
</style>
