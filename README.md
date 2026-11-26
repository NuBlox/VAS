# Visual Application Studio · v1.8 — Searchable Relationship Pickers

VAS v1.8 adds declarative reference dropdowns for existing model foreign keys. Scaffolded Customer/Order forms now show a searchable customer picker, display customer names and submit canonical IDs. A picker is a normal `select` control with `referenceDisplayFieldId`; it must be bound to a published model field with a validated foreign-key relationship. The reference target and display column cannot be specified by the browser.

The read-only `/api/runtime/references/[componentId]?pageId=...&q=...` route requires the existing localhost runtime, authenticated actor, matching release revision, and read permission on the related model. It returns at most **20** `{id,label}` results and uses SQL identifier allowlists and escaped, parameterised LIKE search. Both direct CRUD and workflow transactions check referenced IDs and related-model read permission inside the write transaction; a missing or forbidden reference cannot create an Order.

**Try it:** generate Customer/Order data screens, publish the project locally, log in, switch Preview to MySQL, and open New Order. Search for a customer by name and choose a result; the bound `customer_id` field receives its canonical key. The same control works in an exported standalone app. Offline design preview intentionally does not query MySQL.

**Scope:** localhost development only; do not use real customer data. Existing v1.7 projects work unchanged, and v1.8 requires no schema migration. Foreign-key dropdowns require a referenced model containing a string/text display column; other reference fields keep ordinary ID entry until a display property is designed.

---

# Visual Application Studio · v1.7 — Visual CRUD Screen Generation

VAS 1.7 adds **Generate CRUD screens** to the entity inspector in **Data models**. Choose an entity and press the button to generate two fully editable pages: a record list with inline edit controls, plus a new-record form. VAS also creates three declarative workflows (create, update, delete), bound to the model and their respective buttons. You can inspect or modify every generated component and workflow in the normal visual designer. Generated pages use safe route suffixes when generation is repeated; existing pages are never overwritten.

The form maps existing model attributes to input/textarea/checkbox controls and preserves binding metadata. Required non-boolean fields receive a client-independent workflow check; **all values are still validated by the existing server model validation and MySQL constraints**. Foreign-key fields use an ID input, not yet a relationship-aware lookup; dates and numbers use text inputs, with server validation on save. On the record-list page, select a row to populate the same-page edit form before updating or deleting. Delete requires the existing admin role and confirmation. All database functions remain loopback-only and require a configured local MySQL runtime.

To exercise generation, export and validation without changing your existing project:

```bash
npm install
npm test
npm run scaffold:generate -- /tmp/vas-scaffold.project.json
npm run app:export -- --project /tmp/vas-scaffold.project.json --out /tmp/vas-scaffold-app
cd /tmp/vas-scaffold-app
npm install
npm run verify:release
npm test
npm run check
npm run build
```

**Scope:** This is metadata-driven CRUD scaffolding, not a new data migration tool or public hosting feature. Generation does not create or alter database tables, nor does it produce a dropdown for foreign keys. Review SQL schema changes before applying them to your local development database. No migration of the existing VAS project format is required.

---

# Visual Application Studio · v1.6 — Customer and Order End-to-End Acceptance

VAS v1.6 adds a **repeatable no-code acceptance scenario** built using the same project-model authoring APIs as the visual designer. The scenario includes two navigable pages (Customers and Orders), model relationships, linked reusable customer form/list components, typed properties and slots, create/update/delete workflows, a shared action, read-only deterministic debugging and a standalone SvelteKit export. The exporter never patches generated Svelte code. The sample is synthetic; do not use real customer information.

## Generate and validate the application (Mac, Node >=22.17)

From the VAS repository:

```bash
npm install
npm test
npm run check
npm run build
npm run acceptance:generate -- "$HOME/Developer/customer-orders.project.json"
npm run app:export -- --project "$HOME/Developer/customer-orders.project.json" --out "$HOME/Developer/CustomerOrders-v16"
cd "$HOME/Developer/CustomerOrders-v16"
npm install
npm run verify:release
npm test
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --open
```

The generator refuses to overwrite an existing project JSON, and the exporter refuses to overwrite an export directory. Choose fresh destinations for repeated runs. The sample uses newly generated component IDs, so a new export may receive a different release ID; export/verify of the **same project JSON** is integrity-stable.

The app has a Customers page for registering and editing customers, plus an Orders page with order entry, update, deletion (administrator-only), customer lookup and the same reusable customer form. The order form currently takes an explicit Customer ID obtained from the customer table; a visual relational picker is a future feature. Workflow decisions are explained by the existing visual debugger, and all data operations use the published, server-validated graph.

## Disposable MySQL acceptance test

CI runs `npm run test:acceptance:mysql` separately after the standard suite, against its **disposable MySQL 8** service. It loads the exported application's workflow and store runtime directly and checks:

- Customer and order creation, selection-based editing and deletion; enforced Customer → Order foreign key.
- Typed event validation and reusable action behaviour in unit/debugger tests.
- Editor/viewer/admin permission boundaries and explicit deletion confirmation.
- Duplicate request idempotency and conflict rejection.
- Transaction rollback for duplicate inserts or invalid references, with durable audit outcomes and no committed failed-request ledger entry.
- Standalone export integrity and CI compilation, including signed local staging/activation.

The MySQL test **drops** only the synthetic `vas_acceptance_customers` and `vas_acceptance_orders` tables in the specified disposable database. It refuses to run unless `MYSQL_INTEGRATION=1`, `DB_HOST=127.0.0.1`, `DB_NAME=visual_studio_dev` and either GitHub Actions is active or `VAS_ACCEPTANCE_DISPOSABLE=yes` is explicitly set. **Never run it against a database containing valuable data.** No database installation or migration is performed by the generator or exporter.

**Not production-ready:** public hosting remains blocked, the identity/session model is local-development-only, there is no managed deployment, no automatic schema migration or relational picker, and CI is a synthetic technical acceptance test rather than an independent usability study of the designer.

---

# Visual Application Studio · v1.5 — Binding Inspector & Deterministic Debugging

VAS v1.5 improves the **visual authoring and troubleshooting experience** while preserving the schema-v3 project format and the localhost-only runtime boundary. No database migration is required. Both the VAS editor and exported SvelteKit apps use one pure resolver for typed component-property bindings.

## Inspect and debug a workflow

1. Open **Workflows**, select an event-triggered workflow, then enter trial values in **Step-through debugger**. Checkbox sources now retain their boolean type.
2. Select **Start / Reset**, **Step**, **Continue / Break** or **Run to end**. Each executed step records a separate immutable-in-use snapshot and an explanation of its condition, proposed action and next step.
3. Select **Step back** or click a trace entry to restore the simulated form, record selection, effects and execution pointer after that step. **Verify replay** reruns the trace from the saved initial inputs and refuses to silently accept changed logic.
4. In **Binding inspector**, inspect the event payload, trial form values, selected records, condition previews and every linked reusable input. Select a source to open that component in the page designer, or jump to a condition step from the inspector.
5. Missing, unselected or incorrectly typed bound values appear as diagnostics. The inspector explains the static fallback used by the renderer. No values are persisted into publication metadata.

**Safety:** Dry-run execution and binding inspection never call MySQL, remote APIs or user-authored scripts. Data create/update/delete steps produce simulated effects. The inspector may show already-loaded in-memory record snapshots, but it never queries the database itself.

### Verify locally

```bash
npm install
npm test
npm run check
npm run build
node scripts/generate-composition-fixture.mjs /tmp/vas-v15-compose.json
npm run app:export -- --project /tmp/vas-v15-compose.json --out /tmp/vas-v15-generated
cd /tmp/vas-v15-generated
npm install
npm run verify:release
npm test
npm run check
npm run build
```

The export destination must not already exist. The generated application uses the same typed binding resolver as the designer; no migration or automatic deployment is performed.

---

# Visual Application Studio · v1.4 — Composable Linked Components

VAS v1.4 adds **typed public inputs**, **instance-specific data bindings** and **named content slots** to the linked component system introduced in v1.2. Existing schema-v3 projects and previously published releases remain compatible. No MySQL schema migration is necessary.

## Build a reusable component

1. In **Pages & tree**, save an existing section or card as a reusable component, then insert a **linked** instance.
2. Select any node in the linked instance. In **EXPOSE MASTER INTERFACE**, name a property and expose it as a typed public input (string, number or boolean). The input points to an existing visual property in the master; it cannot change internal workflow IDs, SQL bindings or actions.
3. Use **PUBLIC INPUTS** to set a value for just this instance, or bind it to a same-page form field or a typed field on the currently selected model record.
4. Select a section or columns node and **Expose this layout as a slot**. The section's existing children are the fallback. Add text, heading or card content for each linked instance; content is independent and is reflected in both Studio preview and standalone SvelteKit exports.
5. Edit a master visual property to propagate changes to all linked instances. Explicit instance overrides and public input values are preserved. **Detach instance** to materialise current static values and slot fills into an independent tree.

### Design boundaries

- Slots support display-only content (text, heading, card, divider and nested layout nodes). Form controls and buttons inside slot fills are deliberately refused in this milestone; event wiring remains attached to regular page components.
- Values are resolved at render time using a pure function; runtime form data is **never written** into the published project JSON. Record bindings require a selected record and use the schema's declared value type. Missing values fall back to the instance's static property.
- Input and slot names are unique per master and checked on import, export and publication. Duplicate IDs, missing targets, incompatible bindings and malformed slot fills are rejected.
- Existing security constraints remain: **local development only**, no public hosting and no automatic database migrations.

### Verification

```bash
npm test
npm run check
npm run build
node scripts/generate-composition-fixture.mjs /tmp/vas-composed-project.json
npm run app:export -- --project /tmp/vas-composed-project.json --out /tmp/vas-composed-application
cd /tmp/vas-composed-application
npm install
npm run verify:release
npm test
npm run check
npm run build
```

---

# Visual Application Studio · v1.3 — Typed Events & Reusable Workflow Actions

VAS v1.3 extends the **localhost-only development designer** with declarative, typed event context and reusable project-level workflow actions. Existing v1.2 projects remain valid without any database migration: the optional `actions` collection is additive to the v3 project document.

## New visual authoring workflow

1. Open **Workflows** and choose a workflow triggered by a form field's **change** or **blur** event (or create one from the form component's inspector).
2. For a **Condition**, choose **Current event value** to branch on the event's typed value instead of an arbitrary form field.
3. In **Reusable Actions**, create a named action, choose its input type (`string`, `number`, `boolean`) and effect (**show message** or **set field**). A field-setting action's target must exist, with a compatible value type, on every page whose workflow uses it.
4. Add a **Reusable action** step to one or more workflows; bind its parameter to a validated literal, a same-page form field, or the triggering event value. Action references include an explicit version; editing a master increments the version and updates its references in the current project only.
5. Use **Preview** or the read-only workflow debugger to simulate an event, then export JSON, publish locally, and export a standalone SvelteKit application. Generated applications forward the same typed event context to the runtime.

### Runtime contract and limitations

- Supported event types are **click** on buttons, **change**/**blur** on text inputs and textareas, and **change** on dropdowns/checkboxes. Button click has no event value; form text values are strings and checkbox values are booleans. Number inputs currently surface DOM string values.
- The accepted event snapshot contains the published `pageId`, `componentId`, `event`, and for value-bearing controls the `field` and `value`. The server checks exact allowed keys, source control type and equality to the submitted allowlisted form field. This **is not proof of a physical UI interaction or user identity**; authentication, roles and published workflow permissions still apply.
- Reusable actions have strictly allowlisted effects, typed inputs, numeric versions and immutable release snapshots. No arbitrary JavaScript, scripts, SQL or network calls execute from project metadata.
- The built-in debugger simulates effects without database writes; MySQL-mode workflows run inside the existing server transaction. Generated standalone applications retain the same local-only restrictions.
- **No SQL migrations are required** for this milestone. A modified project must be re-published and the runtime restarted before MySQL preview can use its latest revision.

### Validation

`npm test` checks the original builder and v1.3 event/action semantics. GitHub Actions additionally performs a MySQL 8 integration test, Svelte static analysis, the production build, and the independently generated application's tests/check/build. The test fixtures deliberately retain a v1.2 project without an `actions` collection.

---

# Visual Application Studio · Alpha 1.2 — Linked Components & Event Debugging

VAS v1.2 introduces **linked reusable component instances** with explicit per-instance property overrides, safe master edits that update all linked instances, detachable instances, **component change/blur workflow triggers** and **dry-run workflow breakpoints**. The old reusable snapshot insertion remains available as an independent Copy. Existing v1.1 projects and click-triggered workflows remain compatible with the v3 metadata format.

### Key behaviours

- Save a reusable component from the inspector; use **Link** to insert a live instance or **Copy** for an independent snapshot. Linked nested components get stable instance IDs. Master property edits update linked instances while explicit local overrides survive. Reset overrides or detach to edit the structure independently.
- Visual workflows can now start on button `click`, input/textarea `change` or `blur`, and select/checkbox `change`. The published workflow API validates the exact component *and event*, rejects spoofed triggers and never trusts client-supplied workflow graphs.
- Toggle a breakpoint on any workflow step; **Continue / Break** stops before that step and can resume through it. **Step** executes exactly one simulated step and **Run to end** ignores breakpoints. The debugger never contacts MySQL.
- The same event bindings are exported with standalone SvelteKit apps and operate only behind the existing localhost-only, signed release and local-auth protections.

**Status:** development-only. No production identity, public deployment or automatic schema migration. Linked master structure changes are intentionally unsupported; detach an instance before changing its children. When reusing data-bound form controls on one page, field names must remain unique for server-backed workflows.

**Validation:** `npm test` (72 passing Node tests, one optional MySQL integration test skipped without a database). GitHub CI additionally checks Svelte and generated application builds using MySQL 8.

No MySQL migration is required for v1.2.

---

# Visual Application Studio · v1.1 — Reusable Components & Visual Debugger

Version 1.1 builds on the verified v1.0 signed-release foundation and improves the actual visual authoring experience.

- **Reusable component library:** Select any component, section or nested columns layout in Pages & tree, give it a library name in Properties and choose **Save selected component / layout**. Insert an independent copy from the sidebar or drag the saved item onto a section. Instances get new IDs; edits do not change the saved snapshot. The library travels in project JSON, with no database migration.
- **Safe import/export:** Saved components are optional `templates` metadata within schema v3 (the existing schema version). Older projects need no migration. Imported template trees are structurally validated, size-limited, and checked against existing model bindings; no scripts are accepted. Copied buttons deliberately **do not inherit click-workflow connections**. Bind a workflow to the new button explicitly.
- **Step-through workflow debugger:** Open Workflows, select a flow, provide trial form values, optionally tick an example selected record, and choose **Start / Reset**, **Step**, or **Run to end**. The current node and visited path are marked on the graph. Inspect branch outcomes, simulated effects and trial field state. This is a pure read-only simulation: no SQL, API calls, real records, navigation, or user-authored code runs.
- **Existing click bindings stay intact:** The Properties panel still connects buttons to visual click workflows. v1.1 does not claim arbitrary event types or breakpoint-driven live server debugging.

## macOS development

```bash
git clone https://github.com/NuBlox/VAS.git ~/Developer/VAS
cd ~/Developer/VAS
npm install
npm test
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --open
```

For an existing clone, inspect `git status` and run `git switch main && git pull --ff-only origin main` before the commands above. MySQL is **not required** to author pages, create templates or run the debugger. No SQL migration is introduced in this version; existing v1.0 MySQL configuration can be retained. The runtime remains intentionally localhost-only and not production-approved.

Unit tests cover nested template independence, fresh IDs and binding constraints, true/false execution paths, simulated data actions, mutable field snapshots and cycle prevention. GitHub Actions separately runs Svelte static checks, a production build, MySQL integration and independent generated-application checks.

---

# Visual Application Studio · Alpha 1.0 — Signed Local Release Activation

VAS 1.0 extends the generated application's deployment manager with Ed25519 publisher-signature provenance, independently provisioned trust keys, authenticated promotion and rollback, and explicit on-disk activation of a previously promoted release. Runtime activation prepares a release directory, verifies its integrity, and atomically switches a loopback-only `current` symlink. A separate command launches the activated version on 127.0.0.1. Full instructions are in `templates/standalone/deployment/README.md` and in each generated application's `deployment/README.md`.

**Still not production-ready:** no hosted identity, public deployment, service supervision, live process replacement, automatic migrations or database rollback. Version 1.0 refuses production and public bind profiles. A signature proves possession of an explicitly trusted private signing key; it does not independently establish a publisher's real-world identity. The v0.9 release ledger is preserved, but unsigned legacy artifacts must be re-staged and signed before trusted promotion.

---

# Visual Application Studio · Alpha 0.9 — Local Release Candidate Management

Version 0.9 adds a verified **local-only release candidate store** for generated SvelteKit applications. After export and installation, `deploy:stage` verifies release identity, tests, Svelte analysis and build, then copies a source snapshot without secrets or dependencies. `deploy:promote` and `deploy:rollback` update a local activation manifest with integrity checks, immutable history and expected-current-release safeguards. See the generated application's `deployment/README.md` for exact commands. CI exercises the generated app's stage/promote/status lifecycle.

**Scope:** These commands do not deploy software to a running host, update proxies, launch processes, manage production identity, or roll back database changes. Environments are `local` and `staging` on loopback only; production/public profiles are rejected. VAS and generated applications remain local development prototypes. SHA-256 validates content integrity but is not a cryptographic signature of publisher identity.

---

# Visual Application Studio · Alpha 0.8 — Standalone Application Export

VAS now includes a **standalone SvelteKit application exporter**. The command `npm run app:export -- --out ~/Developer/CustomerWorkspace` generates an independent app without the Studio editor, including its page renderer, local authenticated MySQL CRUD and workflow APIs, release verification, database DDL, and a migration review plan. Existing v0.7 capabilities remain unchanged.

**Scope and safety:** the generated application is independently runnable and buildable but is **not approved for public hosting**. Its copied runtime intentionally blocks production and non-loopback access. Local accounts are not a replacement for federated production identity. No automatic database migrations or production deployment occur.

## Standalone export quick start

```bash
# From NuBlox/VAS; Node 22.17+ required
npm install
npm run app:export -- --out ~/Developer/CustomerWorkspace
cd ~/Developer/CustomerWorkspace
npm install
npm run verify:release
npm test
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --open
```

To export an imported project JSON: `npm run app:export -- --project ./my.project.json --out ~/Developer/MyApp`. To export a known immutable Studio release: `npm run app:export -- --release <64-character-SHA256> --out ~/Developer/MyOldApp`. The exporter refuses existing target directories, invalid or duplicate URLs and mismatched release hashes. It does not execute arbitrary expressions, migrations or supplied JavaScript.

The generated project has its own `package.json`, `src/` application shell, private local MySQL runtime, `runtime/project.json`, `release.json`, immutable `runtime/releases/` snapshot, `db/initial.mysql.sql`, audit and idempotency DDL, a `db/MIGRATION_PLAN.md` review checklist, and automated release tests. Navigate and preview layout without a database; sign in after configuring MySQL to use CRUD, table selection and workflows. The exporter validates and copies the published metadata, rather than creating an unverified deployment. CI builds the exported app separately.

**Limitations:** the standalone UI uses metadata-based layout rendering; it is not yet a specialised Svelte source compiler for every component and custom code. It currently includes only loopback-local identity and MySQL; remote publishing, hosted authentication, secrets management, automated schema migrations and production deployment/rollback infrastructure remain future work.

---

# Visual Application Studio · Alpha 0.7 — Idempotent Workflows, Resource Policy & Versioned Publishing

An independent, metadata-driven SvelteKit 3/Svelte 5 application builder with visual UI components, hierarchical layouts, a relational data modeller, a local-only MySQL runtime, a visual workflow graph editor, and **transactional server-side workflow execution**. Alpha 0.6 builds on the transactional server-side workflow runtime introduced in v0.5.

**Status:** functional LOCAL prototype, **not production ready**. Version 0.6 adds local sign-in, basic role-based access control and MySQL audit records, but does **not** provide multi-tenant identity management, hosted deployment, secure TLS termination, account recovery, cross-process session storage, enterprise policy management or production hardening. All MySQL routes remain disabled outside loopback development. Browser-memory preview works without sign-in or a database. Do not expose this tool publicly or use real personal/customer records.

## New in Alpha 0.7 — safely replayable workflow submissions

**Scope:** This release adds three complementary **local-development** safeguards; it does not enable internet hosting or production identity management.

1. **Transactional idempotency:** every authenticated workflow POST requires a UUIDv4 `Idempotency-Key` header. The server saves the request fingerprint and successful response in `visual_studio_audit.vas_workflow_requests`. The reservation, database mutations, audit record and saved result are committed together on the same MySQL connection. Concurrent duplicate requests are serialised by MySQL's unique key and replay the original result without executing the workflow again. Reusing the key for a changed payload, revision or workflow returns HTTP 409. Failed transactions remove their reservation automatically. **Apply the additive `runtime/idempotency.mysql.sql` schema before enabling v0.7 MySQL workflows.**
2. **Deny-only resource policy:** optional `.vas/policy.local.json` restricts model `read`/`create`/`update`/`delete` and named workflow access for specific roles. The policy can only remove rights, never extend the built-in role hierarchy. A malformed policy blocks resource requests rather than becoming permissive. Example: `runtime/policy.example.json`; to enable it, run `cp runtime/policy.example.json .vas/policy.local.json` after creating `.vas/` and edit for your users.
3. **Immutable publication snapshots:** each publish creates a SHA-256-addressed file in `runtime/releases/`, updates the active project and generated SQL, and writes `runtime/publication.json` **last**. The server refuses to start if the manifest no longer matches the published application. The `--dry-run` flag remains supported; changing the data model requires explicit `--allow-schema-change` after reviewing migrations. The publisher **never executes DDL** and still requires restarting the server.

### Upgrade the MySQL development database from v0.6

Run from `~/Developer/VAS` as an **administrative** MySQL user; this is an additive table creation, not a change to business data:

```bash
mysql -u root -p < runtime/idempotency.mysql.sql
```

The VAS app user needs `SELECT`, `INSERT` and `UPDATE` on the new ledger table (only), with no DELETE or schema privileges. For an existing user named `visual_studio_dev`:

```sql
GRANT SELECT, INSERT, UPDATE ON `visual_studio_audit`.`vas_workflow_requests` TO 'visual_studio_dev'@'127.0.0.1';
```

Run that grant through your MySQL administrative account. Keep the audit-events table restricted to `SELECT`/`INSERT`. On a brand-new installation, create the `visual_studio_audit` database first, then apply **both** `runtime/audit.mysql.sql` and `runtime/idempotency.mysql.sql`. Do not apply the example business schema to an existing database. CI provisions an ephemeral MySQL server and verifies commit, rollback, retry, collision and concurrent replay behaviour.

**Retry behaviour:** the integrated editor reuses a request key when the same browser session retries an identical workflow input after an uncertain network result. A changed form state creates a new key. The retry key is transient, not persisted across page reloads; callers writing their own clients must durably retain a key until they know the outcome. Direct CRUD endpoints are **not** idempotent yet. Old clients must be upgraded to send the header.

**Publishing a revised model:**

```bash
npm run runtime:publish -- ~/Downloads/application.project.json --dry-run
npm run runtime:publish -- ~/Downloads/application.project.json --allow-schema-change
```

Only supply `--allow-schema-change` after making a backup and preparing/reviewing the actual SQL migration. The publisher writes suggested DDL, **not a migration**. Check in the active manifest and release snapshot along with the published project. The original eight-character editor revision is retained for UI compatibility; the 64-character SHA-256 release ID provides the immutable snapshot identity.

## Previous release: Alpha 0.6

- **Opt-in local accounts** with Node scrypt-derived password hashes in Git-ignored `.vas/users.local.json` (never plaintext passwords in Git).
- **Opaque HTTP-only, SameSite=Strict session cookies**, four-hour expiry, server-memory revocation on sign-out; identities and roles are checked against the local user file on each request. Sessions do **not** survive a server restart.
- **Three local roles:** viewer (read records), editor (viewer plus create/update and non-deleting workflows), admin (editor plus delete and audit history). A workflow containing **any** delete step requires admin, even if a condition would skip it.
- **Transaction-coupled audit metadata:** successful direct CRUD and workflows write an audit event before committing the same MySQL transaction. If that insert fails, the business transaction rolls back. Rejected operations attempt a separate post-rollback audit entry; audit outages cannot be guaranteed to record failed operations.
- **Separate `visual_studio_audit` database:** limits the application user to INSERT/SELECT on audit rows, without letting the business schema's UPDATE/DELETE grants modify them. Apply `runtime/audit.mysql.sql` once as an administrator.
- **Administrator audit viewer**, new `/api/runtime/audit` endpoint, local sign-in/out controls and user-bootstrap script.
- No change to application metadata schema v3; only the separate audit table must be provisioned. This is a **local security layer**, not production authentication or permission governance.

### Local role and permission matrix

| Capability | Viewer | Editor | Admin |
|---|---|---|---|
| Read published records | Yes | Yes | Yes |
| Create/update records | No | Yes | Yes |
| Execute workflow without mutations | Yes | Yes | Yes |
| Execute create/update workflow | No | Yes | Yes |
| Execute any workflow containing deletion | No | No | Yes |
| Delete records and inspect audit history | No | No | Yes |

The **visual editor and memory preview** remain usable offline regardless of role; these permissions govern only the loopback MySQL API. The application definition is still published by a trusted local administrator using the CLI; editor roles do not mean that project publication is remotely authorised.

## New in Alpha 0.5

- New `POST /api/runtime/workflows/:workflowId` endpoint executes only server-published workflow definitions, checking the original page and button trigger, published revision, loopback peer address and same-origin request.
- **Single-connection MySQL transactions:** the entire selected workflow branch commits atomically; a failed later step rolls back all earlier CRUD steps.
- Strict runtime form binding: incoming field names must exist on the workflow's page; selected IDs must belong to tables shown on that page; all SQL remains parameterised from allowlisted models.
- `set_field`, conditions, CRUD, navigation, messages and form reset are executed in workflow order on the server; navigation/messages are returned as UI effects **only after commit**.
- A delete step requires the user's confirmation, enforced by the server; neither a revision header nor a confirmation flag is authentication.
- Browser MySQL preview uses the server workflow route; the offline-memory preview remains browser-interpreted, for demonstration only.
- Transaction-aware unit tests cover commit, rollback, negative cases and forged input; CI provisions an ephemeral MySQL 8 service to verify an actual commit and a duplicate-key rollback.
- The schema remains version 3; no database migration is required for workflow execution. Existing published projects need no republishing unless their metadata changes.

## New in Alpha 0.4

- A **Workflows** tab alongside Pages & tree and Data models.
- Click-triggered workflow definitions associated with existing page buttons (one workflow per button); legacy button actions still work when no workflow is assigned.
- Editable flow diagrams with connected, selectable nodes and distinct true/false condition branches.
- Declarative steps for `condition`, `create`, `update`, `delete`, `navigate`, `message`, `reset`, `set_field` and `stop`.
- Conditions: filled, empty, equals, not-equals, numeric greater/less than, or a selected model record.
- Insert a node into an existing path, reconnect targets, delete a single-route node, and configure actions from the inspector. Unreachable steps, broken references and cycles are rejected.
- Browser preview executes workflows sequentially, reports an execution trace, and supports in-memory record creation. With the published local MySQL runtime enabled, workflows execute server-side in one transaction, while the memory-only demo remains browser-interpreted.
- **Schema v3**: v1 and v2 project JSON automatically migrate in memory, retaining their pages, components and models; migrated projects start without inferred workflows. Browser-autosaved projects also migrate.
- The published-project revision now includes workflow definitions; changes require re-publishing and restarting the runtime before MySQL preview resumes.
- Sample customer workflow: `name is filled?` → `Create Customer` → success message; otherwise show a missing-name message.
- A self-contained, **single-file workflow demo** (`preview/workflows.html`, also `preview/index.html`; regenerate both with `npm run preview:generate`) runs in a browser without SvelteKit or MySQL. Its simulation is memory-only and uses the same workflow/model/record modules embedded at build time.

Previous capabilities remain: 12 component types; nested sections and columns; drag-and-drop canvas and component tree; properties, undo/redo, multi-page preview; typed relational models and foreign keys; MySQL DDL export; bound forms/tables; local-only SvelteKit CRUD routes; JSON project import/export; UI-only Svelte page export; optimistic revision consistency checks.

## Quick try — no installation

Open `preview/workflows.html` in a browser (or use `preview/index.html`). Click **Run workflow** with the prefilled name and email to exercise the true branch; clear the name and run again to exercise the false branch. Select a node, insert another step, edit its properties, and export the resulting schema v3 JSON. Data is simulated and is not sent to MySQL.

`preview/legacy-page-editor.html` preserves the earlier offline **v0.3-era** page/data modeller. It is a legacy standalone demo, does not implement workflow editing or live MySQL, and must not be used to edit schema v3 project JSON.

## macOS: install, test and launch the integrated SvelteKit editor

Requirements: Node.js **22.17+**, npm, MySQL 8+ (only when using MySQL preview). Clone the GitHub repository (or use the downloadable ZIP):

```bash
brew install node mysql
brew services start mysql
mkdir -p ~/Developer
git clone https://github.com/NuBlox/VAS.git ~/Developer/VAS
cd ~/Developer/VAS
npm install
npm test
npm run check
npm run build
npm run dev -- --host 127.0.0.1 --open
```

To use only the page builder and memory-only workflows, **MySQL is not required**; omit the MySQL Homebrew commands. The development URL is `http://127.0.0.1:5173` or the printed port.

## Enable authenticated local MySQL CRUD preview

Run these SQL commands from an administrative MySQL session on a **development-only** instance (replace the password):

```sql
CREATE DATABASE IF NOT EXISTS visual_studio_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS visual_studio_audit CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'visual_studio_dev'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_LOCAL_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON visual_studio_dev.* TO 'visual_studio_dev'@'127.0.0.1';
GRANT SELECT, INSERT ON visual_studio_audit.* TO 'visual_studio_dev'@'127.0.0.1';
```

For an **empty** development database only, apply the example generated schema:

```bash
mysql -u root -p visual_studio_dev < runtime/schema.mysql.sql
mysql -u root -p < runtime/audit.mysql.sql
cp .env.example .env
nano .env

# Create the first local admin without echoing or persisting the plaintext password.
printf 'New VAS local password: '
read -rs VAS_BOOTSTRAP_PASSWORD
printf '\n'
export VAS_BOOTSTRAP_PASSWORD
npm run auth:user -- operator admin
unset VAS_BOOTSTRAP_PASSWORD

npm run dev -- --host 127.0.0.1 --open
```

Set `DB_PASSWORD` in `.env`. Sample values from `.env.example`: `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_USER=visual_studio_dev`, `DB_NAME=visual_studio_dev`, `ENABLE_LOCAL_RUNTIME=true`. Keep `.env` private; it is Git-ignored. The application MySQL user must **not** have CREATE/ALTER/DROP grants. Keep the audit table in **a separate database** so the user cannot update or delete audit events even with UPDATE/DELETE granted on business tables. For an existing development installation, apply only `runtime/audit.mysql.sql` after creating the audit database and granting INSERT/SELECT; do not reapply the sample business schema. Audit events capture metadata, not submitted form values.

Sign in with your local account in the blue strip at the top of the editor. Then choose **New customer**, switch to **Preview → MySQL (local)**, fill name/email and click the button bound to the sample workflow. Existing Update/Delete buttons retain their direct legacy behaviour. The published server metadata controls the allowlisted tables, fields, pages and workflows.

**Existing v0.3 installations:** workflow metadata itself requires **no SQL table migration**. However, the editor's schema changed from v2 to v3, so republish your project after exporting the migrated JSON, then restart the server. Do **not** apply the example `CREATE TABLE`/foreign key SQL over an existing database without a reviewed migration and backup.

### Publish editor metadata after changes

```bash
npm run runtime:publish -- ~/Downloads/application.project.json --dry-run
npm run runtime:publish -- ~/Downloads/application.project.json
npm run dev -- --host 127.0.0.1 --open
```

The publisher reads and validates schema v1/v2/v3 project JSON, writes `runtime/project.json` and reviewable `runtime/schema.mysql.sql`, **does not execute SQL**, and requires a server restart to load the new published snapshot. Export the editor project with **Save JSON** first. The local preview refuses MySQL operations when project ID/revision differs from the server snapshot. The workflow endpoint also checks the published trigger and executes the published graph, not a client-supplied graph.

## Architecture

```text
src/lib/studio/model.js         schema v3, migrations, page/model/node validation
src/lib/studio/workflow.js      workflow definitions, graph integrity, interpreter, graph layout
src/lib/studio/records.js       shared field validation and parameterised CRUD SQL
src/lib/studio/compiler.js      UI-only Svelte markup and reviewable MySQL DDL exporters
src/lib/studio/revision.js      published metadata consistency fingerprint
src/lib/server/runtime/        loopback gate, local auth/session/RBAC, append-only audit, transactional workflows
src/routes/+page.svelte         complete page/data/workflow builder and preview interactions
src/routes/api/runtime/        authenticated local project, CRUD, workflow, sign-in and audit endpoints
runtime/project.json           published customer workspace with sample visual workflow
runtime/schema.mysql.sql       example business schema, NOT a migration
runtime/audit.mysql.sql        separate append-only audit table migration
runtime/idempotency.mysql.sql   additive transactional replay ledger DDL
runtime/policy.example.json     example server-owned resource restrictions
runtime/publication.json       active immutable release manifest
runtime/releases/              SHA-256-addressed published project snapshots
scripts/local-user.mjs        creates/updates a local user using a scrypt password hash
scripts/publish-project.mjs    local snapshot publisher (validates but never runs SQL)
preview/workflows.html         self-contained dependency-free interactive workflow demo
scripts/build-workflow-preview.mjs  regenerates both standalone demo entrypoints
preview/legacy-page-editor.html previous offline page/data designer (no workflows)
tests/                         model, records, workflow and security-invariant tests
.github/workflows/ci.yml       PR and main test/check/build validation
```

Workflow steps are declarative JSON. The interpreter never evaluates user-authored JavaScript or accepts arbitrary SQL. Server CRUD checks same-origin writes, published models and project revisions, validates types and field names, parameterises values and requires a local account with appropriate role. The revision header is **not authentication**. In MySQL mode, flow changes and branch decisions execute **on the server** against published metadata; the memory demo remains browser-interpreted. Server-side MySQL workflow actions now share one transaction: failed steps roll back earlier writes. Direct one-step CRUD buttons remain available. The demo workflow that runs without MySQL is a browser-only simulation.

## Verification

- **44/44** dependency-free Node unit tests pass (plus one opt-in MySQL integration test): original designer/DDL, CRUD test doubles, v1/v2 migration, graph validation (including cycle/orphan prevention), conditions, sequential execution, failure propagation and revision integrity.
- Workflow demo has been exercised in Chromium using both true/false paths, memory record creation and connected step insertion. The demo does not perform live database requests.
- `node --check` passes for all standalone JavaScript modules and the extracted page `<script>`.
- Local `npm install` could not reach `registry.npmjs.org` (`EAI_AGAIN`). GitHub Actions validates dependency installation, the real MySQL transaction test, `npm run check` and the production build. Run the commands on your Mac to validate your own database instance.
- Source is maintained in NuBlox/VAS. The GitHub Actions workflow runs tests, type analysis and the production build on pull requests and main.

## Next engineering work

Production-grade identity federation, multi-user/team project administration, role and permission policies per resource, durable cross-process sessions, audit retention/tamper detection, distributed session storage, administrative authentication, idempotent direct CRUD endpoints, audit retention, deployment rollback, and service-level observability; then richer expressions/variables, and hosted packaging. **Do not expose the development runtime to the network.** This prototype must remain on loopback; never expose the dev runtime through a public tunnel, reverse proxy or LAN binding, and do not store actual customer data in it.
