# VAS — Commercial Product Development Plan

**Status:** Development planning proposal; **not** a declaration of production readiness  
**Baseline:** `NuBlox/VAS` v2.1.0, commit `b339915640126b025809577217f7e5a6e32afd72` (28 November 2026)  
**Owner:** NuBlox / product founder  
**Planning horizon:** approximately 9–15 months with a dedicated small team; a substantially longer horizon if developed largely by one person. All durations, prices and budgets below are *hypotheses/estimates*, not commitments.  
**Primary architecture:** SvelteKit + Svelte 5 + TypeScript/Node + MySQL; visual metadata and generated, independently runnable SvelteKit applications.

## 1. The commercial decision

**Build a commercially supported Visual Application Studio for internal operational applications, not a generic everything-builder.** Its first offer should be a **dedicated single-organisation deployment**, sold with an annual licence/subscription and implementation/support options. The first target buyer hypothesis is the operations/IT owner at a UK construction or built-environment SME with custom forms, registers, inspections, requests and approvals. Test this hypothesis before freezing vertical-specific product features.

Why this route:

- Existing VAS differentiators are metadata-defined models/workflows, visual CRUD and master-detail authoring, read-only query building, signed local releases and **portable SvelteKit application export**.
- Buyers pay for a supported business outcome: a reliable application, permissioned data, safe upgrades, support, recoverability and an exit path. Feature count alone is not commercial readiness.
- **Dedicated deployment first** eliminates a shared multi-tenant control plane from the first release's critical path. Dedicated instances **still need** production authentication, authorisation, HTTPS, patching, privacy safeguards and support. Shared multi-tenant SaaS is a later, separately secured product.
- Keep customer application source, project definitions and customer records exportable. Clearly specify ongoing runtime/licence entitlements and who owns each generated artefact.

**Out of scope for the first sale:** consumer-facing public app hosting, mobile app stores, arbitrary JavaScript/SQL supplied by builders, an open plugin marketplace, unvetted AI agents, unrestricted third-party integrations, regulated/high-sensitivity customer records and shared multi-tenant data hosting. Revisit only after buyer evidence and security gates.

## 2. Verified baseline and gaps

| Area | What exists at v2.1.0 | Blocking gap for commercial use |
| --- | --- | --- |
| Visual UI | Pages, reusable linked components, typed props/slots, event workflows, debugging, data views | Complete visual page state, accessible editing, usability, rich form validation, reliable project persistence |
| Data | Model/relationship design, generated CRUD, reference pickers, bound queries, MySQL runtime tests | Controlled schema evolution, backups, migrations, data export/deletion and recovery |
| Runtime | Authenticated localhost runtime, bounded parameterised queries, model RBAC/policies, standalone source export | Production identity, secure dedicated deployments, sessions, comprehensive object-level authorisation, operability |
| Deployment | Ed25519 signing, local staging, activation and code rollback | Deployment supervision, secure production profiles, TLS, upgrades, schema compatibility, backup-aware rollback |
| QA | Node tests, disposable MySQL 8 CI, Svelte check/build, generated-app smoke/acceptance | Browser E2E, dependency/SBOM controls, performance, accessibility, threat model, independent assessment |
| Business | Public source repository; no repository-level LICENSE observed; no customer billing/terms | Explicit IP/licensing position, terms/DPA as applicable, commercial packaging, onboarding and support |
| Governance | `main` green in CI but not protected; historical merged branches present | Required PR/check enforcement, protected release branches, code ownership, release policy |

**Hard constraint:** the existing runtime and exported applications explicitly prohibit public deployment and lack production identity/row-level tenancy. They must never be used with real customer data until their separate production trust boundary is implemented and verified.

## 3. Product proposition and positioning

### Primary job-to-be-done

> "We need a small, permission-controlled operational application that reflects our process, links our data, and can be changed without waiting for a bespoke software project."

### Initial reference apps (use these to find paying demand)

1. **Request/change register:** submissions, categories, status, approvals, assignees, audit trail, change history and reporting.
2. **Inspections / defects:** master-detail sites/assets/inspections, follow-up actions, dates and role-limited updates.
3. **Supplier/asset register:** suppliers/assets, related documents/records, lookup controls, workflows and searchable views.

The first two are **not promises of regulated/defence-grade handling**. Pilot with synthetic data until security and legal gates are signed off.

### Competitive perspective (market observation, not feature parity claim)

Retool sells internal-tool development with builder/internal-user billing; Appsmith publishes user-based cloud/self-hosted pricing; Budibase sells cloud/self-hosted low-code and automation capabilities. VAS needs an experimentally validated reason to win. Candidate advantages are **reviewable source export, customer-owned MySQL data, a metadata-first workflow model, and controlled private deployment**. Validate whether buyers value those more than the competing products' maturity and ecosystems.

### Minimum commercially useful application

A non-developer must be able to visually configure a two-entity request/approval app; add relationships and searchable lists; implement typed validations, permissions and conditional UI; publish to a supported dedicated environment; add users; update schema safely; export their data; and receive a supported upgrade without writing generated source code.

## 4. Architecture decision and non-negotiable boundaries

```
Studio / authoring (private, authenticated)
  -> versioned project metadata + schema diff + validation
  -> reviewed publication manifest + isolated signing pipeline
  -> reproducible generated app artefact / image
  -> dedicated organisation runtime (HTTPS / IdP / server RBAC)
       -> organisation-specific MySQL database and credentials
       -> managed backups, monitoring, support and export
```

- Separate **designer**, **publication/build pipeline** and **runtime** processes and secrets. A Studio builder is not automatically authorised to administer runtime data.
- Version each project definition, schema, workflow, generated runtime contract and API independently. Preserve import/export compatibility with v2.1 unless there is an explicit, tested migration.
- Treat visual project metadata as **untrusted declarative input**. No builder-provided executable SQL/JS/HTML on the server; compile validated allowlisted ASTs against published model definitions.
- For release one, one organisation per deployment with independent DB credentials, secrets, host/logical isolation, backups and audit. **Do not market shared multi-tenancy** until isolation is designed, implemented and penetration-tested.
- Create environment-specific production profiles. Never weaken the development runtime's loopback block globally: production code and configuration require a distinct, secured release path.
- Code rollback is **not** database rollback. Use forward-compatible migrations, preflight checks, restore procedures and a schema/runtime compatibility matrix.

## 5. Delivery plan and sequence

Assume one full-time product/engineering lead, two additional engineers and fractional design/QA/security/DevOps, with two-week milestones. Durations overlap once the architecture is stable. These are **illustrative relative windows**, not delivery promises.

| Gate | Indicative window | Outcome | Primary tracker | Exit condition |
| --- | --- | --- | --- | --- |
| G0 — Commercial thesis & repository discipline | Weeks 1–4 | Segment/buyer decision; IP review; enforced CI and branch protection | [#29](https://github.com/NuBlox/VAS/issues/29), [#14](https://github.com/NuBlox/VAS/issues/14) | 15 interviews, 3 design partners, 2 budget-backed commitments, reproducible CI |
| G1 — Product-complete authoring | Weeks 3–16 | Visually build useful apps without source edits | [#28](https://github.com/NuBlox/VAS/issues/28), [#30](https://github.com/NuBlox/VAS/issues/30) | >=4/5 external builders finish the 90-minute reference task |
| G2 — Production trust boundary | Weeks 5–24 | Secure single-org production identity, authz, isolated deployment | [#31](https://github.com/NuBlox/VAS/issues/31), [#32](https://github.com/NuBlox/VAS/issues/32) | Threat model, complete endpoint authorisation tests, independent security retest |
| G3 — Data and operational reliability | Weeks 10–30 | Migrations, backups/restore, monitoring, runbooks, upgrade/rollback | [#33](https://github.com/NuBlox/VAS/issues/33), [#32](https://github.com/NuBlox/VAS/issues/32) | Three verified restores, failure-injection, reproducible secure release |
| G4 — Commercial operating product | Weeks 18–36 | Licensing, provision/billing, contracts, docs, accessible UX, support | [#34](https://github.com/NuBlox/VAS/issues/34), [#35](https://github.com/NuBlox/VAS/issues/35) | Supported purchase → provision → renewal → export/cancellation path |
| G5 — Paid pilot & GA decision | Weeks 30–52 | Three real design-partner pilots, measured value and reliability | [#36](https://github.com/NuBlox/VAS/issues/36) | 3 completed pilots, 2 renewals or evidence-based pivot, explicit GA sign-off |

**Critical path:** market validation and production trust boundaries start now. Richer visual features can proceed in parallel, but no production customer launch should bypass security, data restoration, legal terms or support readiness. If the gates take longer, delay release rather than relax them.

### G0: Start in the next two weeks

1. Protect `main`, require PR and CI, stop manual direct pushes, implement merged-branch cleanup; add `CODEOWNERS`/review policy. See #14.
2. Add and commit a dependency lockfile; use `npm ci`, pin relevant CI actions and configure dependency/SAST/secret checks and build artefact provenance.
3. Resolve business IP ownership, repository licence strategy, third-party dependency notices and generated-code rights **before** distributing commercial binaries. A public repo without a licence does not automatically grant a permissive open-source licence.
4. Run buyer interviews and select a first vertical use case; log 3 comparable competitor workflows, setup time, buyer willingness to pay and support expectations.
5. Write the first production threat model and architecture decision records; identify endpoints and stores that cannot yet cross the public-network boundary.
6. Create a reference app built **using the visual UI**, measure time-to-first-app and capture missing interactions.

### G1: Authoring and workflow UX

Ship typed page/application state and bounded expression AST (#28), component visibility and derived bindings, accessible validation/errors, form controls for dates/numbers/references, reusable approval actions, role-dependent UI backed by **server enforcement**, bulk/list affordances, publish preview, undo/redo, project autosave and robust project history. UI functionality does not override backend access checks.

### G2/G3: Production kernel

Build supported hosting images/profiles, TLS/headers/CSRF, OIDC with IdP MFA, revocable sessions, enforced least-privilege model and record access, runtime/user administration, backup/migration lifecycle, audit and monitoring. Make customer data portable and deleteable. Exercise concurrency and crash/restart paths. Commission an independent security review, fix and retest findings.

### G4/G5: Packaging and distribution

Add subscription entitlement/provisioning, documentation, a customer support and incident process, commercial site/demo/onboarding, reliable billing and customer data exit. Run staged pilots on managed dedicated infrastructure only after G2/G3 controls pass. Collect before/after business value, setup time, churn risk and support costs before scaling marketing.

## 6. Product-release gates — all mandatory

### Engineering

- A builder can produce the reference request/approval application **entirely from Studio**; generated source and SQL need no manual edits after supported guided publish.
- Versioned project schema + migrations, import/export round trip, idempotent writes and transaction rollback proven against real MySQL, including concurrency and failure injection.
- CI passes Node/unit, MySQL integration, generated-app Svelte check/build, supported browser E2E, accessibility, static/dependency security analysis and signed-release verification.
- Deterministic and bounded runtime queries; no arbitrary user SQL or raw executable project code.

### Security and privacy

- OIDC-based production login, MFA policy, safe session lifecycle, object/row-level authorisation and resource permission checks on **every** data-changing or record-reading surface.
- OWASP ASVS 5.0 requirements mapped to tests; NIST SP 800-218 (SSDF) practices incorporated into engineering. Independent penetration test with zero unresolved **critical/high** externally reachable findings before paid production.
- Deployment-specific secrets and signing keys segregated; encrypted transport and backups; audited admin actions and incident response.
- Define controller/processor roles and privacy obligations for the chosen deployment. Where NuBlox processes personal data for a customer, use an appropriate UK GDPR Article 28 processing agreement and data subject/incident support procedures; obtain legal advice.
- No high-risk personal data or publicly accessible runtime until these gates are evidenced.

### Reliability and support

- Repeatable deployment and safe upgrade with documented runtime/schema compatibility, rollback and restoration procedure; backup restore rehearsed **three times** on synthetic data.
- Initial *engineering targets* for a limited pilot: proposed RPO <=24 hours and RTO <=8 hours, proven before inclusion in contracts; define tighter targets if buyers require them.
- Measured operational availability and alerting with documented incident ownership; **target** 99.9% availability before promising such an SLA.
- Known operating cost, documented supported browser/host matrix, release cadence, support response plan, vulnerability disclosure and customer data export/cancellation path.

### Buyer and financial evidence

- At least 3 design partners, validated purchaser and use case, 2 price-supported purchase intents before heavy expansion.
- At least 3 pilots and 2 paying renewals or a documented pivot; buyers achieve meaningful outcomes without constant developer intervention.
- Instrumented activation (first app completed), time-to-first-app, weekly active builders, retention, support hours per organisation, gross margin and deployment failure rate. Avoid collecting sensitive usage content unnecessarily.

**GA is a formal go/no-go meeting with recorded owners, findings and evidence; passing `npm test` is not a commercial release certificate.**

## 7. Commercial packaging and pricing hypotheses

These **GBP figures are test ranges, not confirmed market prices**. Validate value/hosting/support economics during #29/#36. Pricing must account for dedicated hosting, backups and human support.

| Hypothesis | Offer | Indicative price to test | Boundaries |
| --- | --- | --- | --- |
| Founding partner | Fixed-scope dedicated pilot with assisted authoring, onboarding and support | £750–£2,000/month | Short pilot, explicit supported workloads and support hours; no real data until safety gate |
| Business | Single-organisation VAS licence with source export and a defined builder/user allowance | ~£499/month **plus hosting/support where applicable** | Start with 2 builders / 25 internal users; enforce fair-use and documented SLA |
| Team | Larger builder/user allowance, support and deployment option | ~£1,250/month | Test 8 builders / 100 internal users, higher support tier, production IdP |
| Enterprise | Dedicated environment and contractual/security requirements | Custom annual contract | No implied SOC 2/ISO certificate; quote deployment, support and assurance separately |

**Pricing design:** compare per-organisation, builder-seat, end-user and action-based billing with each buyer. Do not expose unpredictable per-action charges by default unless customers understand and demand them. Make export rights and read-only access after cancellation explicit. Do not lock customers out of their own data on payment failure.

**Initial unit-economics targets (not current measurements):** recurring gross margin >=70% after direct hosting/support and third-party fees; sustainable contribution after acquisition cost; no plan should require unlimited bespoke support. Track hours per onboarding and per incident before finalising licence tiers.

## 8. Team, effort, budget and risk

### Staffing scenario (not a hiring recommendation without funding)

- 1 technical/product lead (architecture, platform strategy, acceptance).
- 2 full-stack engineers (SvelteKit, metadata, MySQL runtime/deployment).
- Fractional design/research, security, QA/browser-accessibility, DevOps/SRE and legal/commercial support.

**High-uncertainty planning estimate:** about **9–15 months** with this small focused team for a credible first commercial release, assuming the buyer problem is narrow and independent assurance is available; **18–30+ months** largely solo is plausible. Illustrative full-delivery labour/contractor/security/hosting budget might be **£250k–£800k**, depending on team rates, build/buy choices, pilot scope and regulatory/hosting requirements. This is **not a quote**, not a cash-flow forecast and not a claim that the work can be finished within a fixed timeframe. Re-estimate after G0 using story-level effort, actual rates and a contingency reserve.

### Highest risks and explicit mitigations

| Risk | Mitigation |
| --- | --- |
| Building features buyers will not pay for | 15 interviews, 3 design partners, paid conversion gate; narrow use case |
| Public exposure of the development runtime | Separate production architecture and enforced environment profiles; no pilot real data before security |
| Broken customer data during migrations/updates | Versioned, reviewable migration plan, backup/restore drills and compatibility testing |
| Feature parity pressure from mature incumbents | Sell portability, industry-specific outcome, controlled data ownership, support; do not chase every plugin |
| Unclear open-source/IP rights | Legal/IP inventory before distribution, explicit repository and generated-code licences |
| Support effort destroys margins | Documented supported configurations and usage limits; measure support hours and automate onboarding |
| Solo delivery becomes bottleneck | Prioritise critical path, use external security/UX reviews and defer SaaS tenancy/marketplace |

## 9. Work tracking and priority rules

The following epics contain acceptance criteria and should be used as the authoritative engineering backlog:

- **Commercial validation:** [#29](https://github.com/NuBlox/VAS/issues/29)
- **Usable complete authoring:** [#28](https://github.com/NuBlox/VAS/issues/28) and [#30](https://github.com/NuBlox/VAS/issues/30)
- **Security and production identity:** [#31](https://github.com/NuBlox/VAS/issues/31)
- **Dedicated production runtime:** [#32](https://github.com/NuBlox/VAS/issues/32)
- **MySQL data lifecycle and recovery:** [#33](https://github.com/NuBlox/VAS/issues/33)
- **Licensing, contracts, billing:** [#34](https://github.com/NuBlox/VAS/issues/34)
- **Accessibility, QA and release gates:** [#35](https://github.com/NuBlox/VAS/issues/35)
- **Paid pilots and launch:** [#36](https://github.com/NuBlox/VAS/issues/36)
- **Repository governance:** [#14](https://github.com/NuBlox/VAS/issues/14)

**Definition of done for each feature:** requirement and threat/permission impact understood; migration/compatibility considered; source committed by PR; unit/integration/appropriate browser tests pass; release and support documentation updated; no unrelated working tree changes; PR merged only after successful required checks; branch cleanup tracked. Release-gate evidence is attached to the relevant issue/PR.

### Product-management cadence

- Weekly: buyer findings, deployment/security risks, feature and defect prioritisation, integration CI and lead-time metrics.
- Every two weeks: demonstrable end-user workflow, published release candidate, support/operational review, updated risk register.
- Monthly: commercial stage-gate check, costs and pricing evidence, independent security/QA findings, pilot adoption and scope changes.

## 10. Current next actions

1. **Implement #14 governance** now: protected `main`, required checks, dependency lockfile/`npm ci`, automatic pruning of merged task branches. Current GitHub connection may not support settings/branch deletion; administrative changes require an authorised maintainer.
2. **Kick off #29 interviews** in parallel; do not substitute assumed buyer preferences for real evidence.
3. **Design #31/#32 production trust boundary** and review code/API endpoints before any public deployment.
4. **Implement #28 and #30 authoring completeness** behind existing local development safeguards while production architecture progresses.
5. **Prototype #33 migration/backup/restore** before supporting customer-record lifecycle.
6. Review the funding and scope decision at G0; create release branches only for coherent vertical slices and merge through CI.

## 11. Reference standards and external reading

- [OWASP Application Security Verification Standard 5.0](https://asvs.owasp.org/) — application security requirements and testing guidance.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) — secure engineering practices.
- [ICO: Controller–processor contracts under UK GDPR](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/) — processing-contract requirements where relevant.
- [GitHub: Licensing a repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) — effect of publishing a repository without a licence.
- [Retool pricing](https://retool.com/pricing), [Appsmith pricing](https://www.appsmith.com/pricing), [Budibase pricing](https://budibase.com/pricing/) — current competitor packaging references, not endorsements or proof that VAS meets equivalent capability.

**Decision principle:** sell a securely deployed, supportable solution to a validated operational problem. Do not equate generated code and passing CI with a production-ready, contractually supportable product.
