# Anvizent RAG Loading Architecture

**Scope:** Defines how each class of knowledge enters, refreshes, and exits the Anvizent RAG layer. Five knowledge types across three loading regimes, plus shared infrastructure and index-hygiene rules.

**Locked platform choices:** Postgres + pgvector as the store · database-per-tenant isolation for tenant-scoped knowledge · hybrid (rules → LLM) telemetry distillation · global + tenant telemetry insight scope · combined failure-rate + disuse pattern decay · batch-proposed-diff glossary intake.

---

## Organizing principle: three loading regimes

| Regime | Latency | Write path | Failure cost | Types |
|---|---|---|---|---|
| **Hot / event-driven** | Real-time to seconds | Automatic on event | Self-correcting (decays out) | Patterns, Customizations |
| **Gated / curated** | Release cadence | Human-reviewed | High — poisons every downstream generation | Semantics, Structural-doc corpus |
| **Live retrieval (never indexed)** | Query-time | No write to vector store | Stale snapshot | Live source schema |

The recurring failure mode is conflating these. Hot loops optimize for latency and auto-write. Curated loads optimize for review and versioning. Live retrieval must never be embedded at all, or the index rots as schemas drift.

---

## Type 1 — Source-system structural knowledge

Split into two tracks because the live/static distinction is the thing that keeps the index from rotting.

### 1a. Document corpus (indexed)
- **Source:** Vendor data dictionaries, OpenAPI/API specs, published ERDs, internal connector docs.
- **Trigger:** SOR onboarding; vendor structural version release.
- **Transform:** Parse → section-aware chunk → embed → tag (`system`, `version`, `object_type`).
- **Namespace:** `kb:sor-docs:{system}:{version}`
- **Refresh:** On vendor version bump; periodic audit for drift between docs and observed reality.
- **Eviction:** Version-supersede. Prior version marked deprecated, retained while any pipeline is pinned to it, hard-deleted once no pins remain.

### 1b. Live source schema (NOT indexed)
- **Source:** Connector introspection via the metadata service.
- **Trigger:** Query-time assembly; schema-drift webhook.
- **Transform:** None into the vector store — held as structured, cached metadata.
- **Namespace:** Metadata-service cache, not the vector index.
- **Refresh:** Short TTL plus drift-triggered invalidation.
- **Eviction:** Cache expiry; drift event invalidates immediately.

---

## Type 2 — Integration & reconciliation patterns

The self-improving loop. Has to run hot.

- **Source:** Pipeline/datamart JSON produced by the agent and confirmed-and-used; spec-library commits.
- **Trigger:** **Usage-based, not deploy-based** (C5). "Deployment success means nothing" — capture is driven by **user confirmation + data validation + usage**: onetime usage → low reliance / narrow scope; scheduled usage → a purpose is being served (rely, but confirm the purpose's scope).
- **Transform:** Extract pattern signature (source pair, transform graph, reconciliation rules) → **scrub tenant-specific values** → generalize → embed → tag (`industry`, `source_systems`, `pattern_class`).
- **Namespace:** `kb:patterns:global` — tenant data must be redacted *before* promotion to global.
- **Refresh:** Continuous / usage-driven.
- **Canonical status:** **Earned, never seeded (C11).** No canonical patterns exist on day one; a pattern becomes canonical only once it recurs across tenant usage. (The concrete, runnable datamart it came from lives in Type 6.)
- **Eviction:** Combined decay — a pattern is deprecated when its failure rate crosses the cutoff **or** its selection count over the rolling window drops to disuse; explicit deprecate on breaking schema change. (Cutoffs are empirical tuning knobs, set once there's traffic.)

---

## Type 3 — Business semantics & metrics

Powers the metrics-suggestion agent. Must stay human-gated.

- **Source:** Curated industry glossaries authored by the team; seeded from industry docs; *suggestions* surfaced from observed customer metric definitions.
- **Trigger:** Gated curated version release; vertical onboarding.
- **Transform:** Author → review/approve → version → embed with definition, formula, `industry` tag, synonyms. Customer-surfaced definitions accumulate in a **batch-proposed-diff** queue the team reviews as a set, so cross-tenant convergence (a real industry standard) is distinguishable from one-off tenant quirks before anything is canonized.
- **Namespace:** `kb:semantics:{industry}:{version}`
- **Refresh:** Periodic, human-approved releases; suggestion queue reviewed in batches.
- **Eviction:** Version-supersede. Corrected definitions replace prior; prior retained read-only for lineage.

> Guardrail: observed customer definitions may *suggest* additions but never auto-write into the canonical glossary, or the agent starts manufacturing consensus from a handful of tenants.

---

## Type 4 — Customer customizations

Tenant-scoped. Isolation is non-negotiable.

- **Source:** Customer overrides to generated artifacts — renames, custom business rules, transform tweaks.
- **Trigger:** Save/commit on a customer artifact.
- **Transform:** Diff against generated baseline → capture delta → embed → tenant-tag.
- **Namespace:** Dedicated Postgres database per tenant; customizations live in a `custom` table within the tenant DB. **Physical database-level isolation**, not a query-time filter — retrieval cannot reach across tenants by construction.
- **Refresh:** Real-time on save.
- **Eviction:** Revert removes the entry; re-edit supersedes; tenant offboarding is a single `DROP DATABASE`. Requires a control-plane catalog mapping `tenant_id → database` plus connection-pool and migration fan-out management across tenant DBs.

---

## Type 5 — Operational telemetry feedback

The only type generated by the platform itself. Never load raw events.

- **Source:** Processing-engine run telemetry — success/failure, performance, data-quality outcomes, bias-detection results.
- **Trigger:** Micro-batch window close (rolling, hourly to daily).
- **Transform:** **Hybrid (rules → LLM).** Rules do the deterministic gate — aggregate, threshold, filter to actual signal — then an LLM phrases only the survivors into `condition → outcome` insight statements. Embed the distilled signal, never raw logs; the LLM never sees runs that didn't clear the rule gate.
- **Namespace:** Global insights in `kb:telemetry-insights:global`; tenant-specific failure modes in the tenant DB. A tenant insight must be scrubbed and generalized before promotion to global (same path as Type 2).
- **Refresh:** Micro-batch on a rolling window.
- **Eviction:** Confidence/time decay — insights age out as conditions change; superseded when contradicted by a newer aggregate.

---

## Type 6 — Resolved contextual semantics (DW + datamart catalog)

The data-warehouse / datamart layer the agent operates on. A datamart's **working JSON, its DW tables, and the columns it uses** are themselves semantic knowledge — the *resolved context* for a question — and are reusable across the company. (See the Reconciliation Decision Record.)

- **Source:** The agent's confirmed-and-used datamart / DW-table JSON (C1).
- **Trigger:** Same usage-based model as Type 2 (C5) — confirmation + validation + usage.
- **Transform:** Capture the working JSON → store the **discovery vector** in `kb_chunk` (`knowledge_type='resolved_semantics'`) **and** the **concrete, runnable JSON** in the relational `datamart_catalog` / `dw_table_catalog`.
- **Scope (required):** every record carries a `scope` — `company · department · purpose · role · user` — that the agent **elicits** (C2).
- **Composition:** records carry `composes_of` links; a requirement is decomposed into reusable **sub-datamarts** usable in this and other datamarts (C3).
- **Namespace:** tenant database (agents are tenant-specific, C10). `kb:resolved:{scope}:{ref}`.
- **Refresh:** On confirmed use; columns grow add-only on existing DW tables.
- **Eviction:** Supersede on re-confirmation; disuse decay; canonical (common) datamarts are **earned via usage, not seeded** (C11).

---

## Shared infrastructure

- **Embedding-model versioning.** Stamp the embedding model version into every namespace key or record. Changing the embedding model means a re-embed pass — mismatched-model vectors retrieved together degrade silently.
- **Common metadata schema.** Every record carries `type`, `source`, `tenant_scope`, `embed_model_version`, `created_at`, `supersedes`. Eviction and lineage depend on these being present everywhere.
- **Tenant isolation.** Database-per-tenant for Type 4 (and tenant telemetry insights); redaction-before-promotion for Type 2 and global telemetry insights; global-by-construction for Types 1a, 3.
- **Eviction as a first-class subsystem.** Every type names a supersede/decay rule. Without it the index fills with confidently-retrieved stale knowledge — the quiet way RAG quality dies.

---

## Locked decisions

1. **Store:** Postgres + pgvector — vectors sit next to relational metadata, no separate infra.
2. **Type 4 isolation:** Database-per-tenant — hardest wall, `DROP DATABASE` offboarding, needs a tenant→DB control-plane catalog.
3. **Type 5 distillation:** Hybrid — rules gate, LLM phrases survivors.
4. **Type 5 scope:** Both global and tenant insights; tenant→global requires scrub + generalize.
5. **Type 2 decay:** Combined failure-rate **and** disuse triggers.
6. **Type 3 intake:** Batch-proposed-diff review queue.
7. **Type 6:** Resolved contextual semantics — DW/datamart catalog (vector + relational), `scope`-tagged and composable (C1–C3).
8. **Capture is usage-based, not deploy-based (C5):** confirmation + validation + usage; onetime = narrow/low, scheduled = purpose-served (confirm scope).
9. **Canonicals are emergent, not seeded (C11):** common datamarts/patterns are earned through tenant usage.
10. **Agents are tenant-specific (C10):** global agents deferred.

## Configuration & adaptive tuning

The calibration knobs are not deferred decisions — they are first-class configuration with two control paths: **manual override** by advanced users and **telemetry-driven auto-tuning** by a controller that reuses the Type 5 distillation stream. Same loop that feeds RAG insights also feeds the tuner.

### Parameter registry

Every tunable is a config record: `key`, `default`, `bounds`, `scope`, `learning_enabled` (the user-facing check), `apply_behavior` (`auto | propose`), `current_value`, `source` (`default | user | learned`), `last_changed_by`, `last_changed_at`, `justifying_window`. Defaults below are placeholders to be set from real traffic.

| Parameter | Default* | Bounds | Scope | When learning on | Learning signal |
|---|---|---|---|---|---|
| Live-schema cache TTL (1b) | 15 min | 1 min–24 h | global + tenant | auto-apply | schema-drift event frequency |
| Pattern failure-rate cutoff (2) | fleet p90 | 5%–50% | global | auto-apply | rolling pattern failure distribution |
| Pattern disuse window (2) | 90 d / N selections | tunable | global | auto-apply | selection-count distribution |
| Telemetry batch window (5) | 6 h | 1 h–24 h | global | auto-apply | run volume per window |
| Retrieval top-k | 8 | 3–20 | global + tenant | auto-apply | retrieved-context-used-in-success rate |
| Similarity threshold | 0.75 | 0.5–0.95 | global + tenant | auto-apply | precision of retrieved chunks |
| Chunk size / overlap (1a, 2) | 800 / 100 tok | tunable | global | propose-for-approval | retrieval usefulness (triggers re-embed) |
| Embedding model | locked choice | allowed set | global | propose-for-approval | A/B retrieval quality (triggers re-embed) |
| Reranker on/off + model | on | model set | global + tenant | auto-apply | rerank lift on generation success |

\*Illustrative — set empirically.

### Control: one check per parameter

The user-facing control is a single toggle per parameter — **Locked (manual)** or **Learning-based** — not three modes to reason about.

- **Unchecked → Locked.** An advanced user pins the value. The controller is off for that parameter/scope; the manual value holds until the user clears the lock. Manual always wins.
- **Checked → Learning-based.** The controller is allowed to move the value within bounds using its telemetry signal.

Whether a learning-based change applies on its own or waits for sign-off is **not a third choice the user makes** — it's the parameter's own `apply_behavior`: low-risk numeric knobs auto-apply; anything that triggers a re-embed (chunk size, embedding model) is propose-for-approval, so the check still reads "Learning-based" but a human commits the actual swap. One mental model for the user, correct blast-radius behavior underneath.

### Precedence & scope

`user lock > learned value > default`. Locking a parameter (unchecking learning) pins it; checking learning hands control back to the controller within bounds. Scope is global by default; per-tenant overrides live in the tenant's own database (consistent with database-per-tenant), so a tenant with unusual data can be tuned — or locked — without touching the fleet.

### The tuning controller (reuses Type 5)

The hybrid distillation already produces aggregated signal. A slice of it routes to a controller that, per parameter:

1. Compares the live objective against target.
2. Proposes a bounded delta.
3. Shadow- or A/B-evaluates before fleet-wide apply.
4. Auto-rolls-back if the objective regresses.
5. Never touches locked parameters; never exceeds bounds; rate-limited per interval to prevent thrashing.

### Auditability

Every change — user or learned — is a versioned config event carrying who/what changed it and the `justifying_window` of telemetry behind a learned change. Tuning is reversible and evidence-backed, not silent drift; you can always answer "why is top-k 11 right now" and roll back to any prior config state.

