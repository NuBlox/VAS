# Visual Application Studio · Alpha 0.5 — Server Workflow Transactions

An independent, metadata-driven SvelteKit 3/Svelte 5 application builder with visual UI components, hierarchical layouts, a relational data modeller, a local-only MySQL runtime, a visual workflow graph editor, and **transactional server-side workflow execution**. Alpha 0.5 builds on the Alpha 0.4 workflow designer.

**Status:** functional prototype; **not production ready**. There is no authentication, RBAC, tenancy or hosted deployment. MySQL-mode workflows now execute server-side using **published** metadata and a single transaction, but this is still a localhost-only developer tool, **not an authenticated production backend**. Browser-memory preview continues to simulate workflows without a database. This is not a general-purpose scripting platform.

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

## Enable local MySQL CRUD preview

Run these SQL commands from an administrative MySQL session on a **development-only** instance (replace the password):

```sql
CREATE DATABASE IF NOT EXISTS visual_studio_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'visual_studio_dev'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_A_STRONG_LOCAL_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON visual_studio_dev.* TO 'visual_studio_dev'@'127.0.0.1';
```

For an **empty** development database only, apply the example generated schema:

```bash
mysql -u root -p visual_studio_dev < runtime/schema.mysql.sql
cp .env.example .env
nano .env
npm run dev -- --host 127.0.0.1 --open
```

Set `DB_PASSWORD` in `.env`. Sample values from `.env.example`: `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_USER=visual_studio_dev`, `DB_NAME=visual_studio_dev`, `ENABLE_LOCAL_RUNTIME=true`. Keep `.env` private; it is Git-ignored. The application MySQL user must **not** have schema-altering grants.

In the editor, choose **New customer**, switch to **Preview → MySQL (local)**, fill name/email and click the button bound to the sample workflow. Existing Update/Delete buttons retain their direct legacy behaviour. The published server metadata controls the allowlisted tables, fields, pages and workflows.

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
src/lib/server/runtime/        loopback gate, MySQL driver, CRUD store, transactional workflow engine
src/routes/+page.svelte         complete page/data/workflow builder and preview interactions
src/routes/api/runtime/        development-only published-project, CRUD and workflow endpoints
runtime/project.json           published customer workspace with sample visual workflow
runtime/schema.mysql.sql       example development schema, NOT a migration
scripts/publish-project.mjs    local snapshot publisher (validates but never runs SQL)
preview/workflows.html         self-contained dependency-free interactive workflow demo
scripts/build-workflow-preview.mjs  regenerates both standalone demo entrypoints
preview/legacy-page-editor.html previous offline page/data designer (no workflows)
tests/                         model, records, workflow and security-invariant tests
.github/workflows/ci.yml       PR and main test/check/build validation
```

Workflow steps are declarative JSON. The interpreter never evaluates user-authored JavaScript or accepts arbitrary SQL. Server CRUD checks origin for writes, published model and project revision consistency, validates field types and field names, and parameterises values. The revision header is **not authentication**. Flow changes and branch decisions are **client-side only**. Server-side MySQL workflow actions now share one transaction: failed steps roll back earlier writes. Direct one-step CRUD buttons remain available. The demo workflow that runs without MySQL is a browser-only simulation.

## Verification

- **35/35** dependency-free Node unit tests pass (plus one opt-in MySQL integration test): original designer/DDL, CRUD test doubles, v1/v2 migration, graph validation (including cycle/orphan prevention), conditions, sequential execution, failure propagation and revision integrity.
- Workflow demo has been exercised in Chromium using both true/false paths, memory record creation and connected step insertion. The demo does not perform live database requests.
- `node --check` passes for all standalone JavaScript modules and the extracted page `<script>`.
- Local `npm install` could not reach `registry.npmjs.org` (`EAI_AGAIN`). GitHub Actions validates dependency installation, the real MySQL transaction test, `npm run check` and the production build. Run the commands on your Mac to validate your own database instance.
- Source is maintained in NuBlox/VAS. The GitHub Actions workflow runs tests, type analysis and the production build on pull requests and main.

## Next engineering work

Production authentication, role/permission policies for workflow actions, persistent audit logging and idempotent submission safeguards; then versioned application publishing, richer expressions/variables, and hosted application packaging. **Do not expose the development runtime to the network.** This prototype must remain on loopback; never expose the dev runtime through a public tunnel, reverse proxy or LAN binding, and do not store actual customer data in it.
