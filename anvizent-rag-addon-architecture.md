# Anvizent RAG Tuning Add-On — Implementation Architecture

**Goal:** Add the loading-regime orchestration, eviction, and config + adaptive-tuning capability to an *existing* RAG without rebuilding it. The substrate stays almost untouched; the add-on attaches through three seams and otherwise runs out of band.

**Companion to:** `anvizent-rag-loading-spec.md` (defines the five knowledge types, regimes, and the parameter registry this architecture operationalizes).

---

## Design principle: minimal-touch, fail-open

The existing RAG is treated as a substrate. The add-on requires exactly **two code changes** inside it; everything else wraps the write path or runs as out-of-band workers. If the control plane is unavailable, the resolver returns last-known/default values and retrieval keeps working — the add-on can never take the core RAG down.

---

## Layer map

```
        ┌──────────────────────── CONTROL PLANE (new) ────────────────────────┐
        │  Admin Console / API     Config Store (parameter registry)          │
        │  Tuning Controller       Eviction / Hygiene worker                  │
        │  Tenant → DB catalog                                                │
        └───────────▲───────────────────────▲─────────────────────▲──────────┘
                    │ resolve config         │ apply / propose      │ distilled signal
        READ SEAM   │            STORE access│            TELEMETRY │
   ┌────────────────┼────────────────────────┼──────────────────────┼─────────────┐
   │ WRITE SEAM     │      EXISTING RAG (substrate, reused)          │  OBSERVE     │
   │                │                                               │              │
   │ Loading        │   Ingestion ─► Embedding ─► pgvector           │  Telemetry   │
   │ Orchestrator ──┼─►                          ▲                   │  Collector   │
   │ + type adapters│   Retriever ◄──────────────┘                   │  + distill   │
   │                │      │                                         │  (rules→LLM) │
   │                │      ▼                                         │      ▲       │
   │                │   Generator ───────── emits outcome ───────────┼──────┘       │
   └────────────────┴───────────────────────────────────────────────┴─────────────┘
```

---

## Components

### Reused (existing RAG — no internal change)
- Embedding service, pgvector store, retriever, generator, ingestion API.

### Write-path add-on
- **Loading Orchestrator.** Producer that sits in front of the existing ingestion API. Routes each knowledge type through its regime, applies the transform, stamps the common metadata schema (`type`, `scope`, `embed_model_version`, `supersedes`, …), then calls the unchanged ingestion API.
- **Type adapters** (one per knowledge type): connector-metadata adapter (1a) · live-schema cache (1b, bypasses the store) · pattern-capture hook on deploy-success (2) · batch-diff semantics intake (3) · capture-on-save customization (4) · telemetry distillation (5).

### Observability add-on
- **Telemetry Collector.** Subscribes to the generator's outcome events. Feeds two consumers: the Type 5 distillation path (rules → LLM → insight vectors back into the store) and the Tuning Controller.

### Control plane (the brain)
- **Config Store.** Parameter registry from the loading spec, backed by a control Postgres DB: `key, default, bounds, scope, learning_enabled, apply_behavior, current_value, source, audit, justifying_window`.
- **Config Resolver.** Thin read-through (SDK + in-process cache) the retrieval path calls to get live parameter values. Hot-path safe; fail-open to default.
- **Tuning Controller.** Consumes distilled telemetry, computes bounded deltas per parameter, honors `learning_enabled`, rate-limits, shadow/A-B evaluates, then either writes `current_value` (`auto`) or files a pending proposal (`propose`). Auto-rollback on objective regression.
- **Eviction / Hygiene worker.** Out-of-band; reads metadata (`supersedes`, decay signals) and issues deprecations/deletes against pgvector.
- **Tenant → DB catalog.** Maps `tenant_id → database` for database-per-tenant routing (read, write, and `DROP DATABASE` offboarding).
- **Admin Console / API.** Where advanced users flip the Locked/Learning check, set values, approve `propose` changes, and read the audit trail.

---

## Integration seams

| Seam | Where | Invasiveness | Contract |
|---|---|---|---|
| **Write** | Wraps ingestion API | None to RAG internals | `orchestrator.ingest(records[], metadata)` → existing `ingest()` |
| **Read** | Inside retrieval path | **Only invasive change** — replace hardcoded constants (top-k, similarity threshold, …) with a resolver lookup | `resolver.resolve(key, scope) → value` (cached, fail-open) |
| **Telemetry** | On generate / run completion | One emit call | `collector.emit({outcome, retrieval_used, pattern_id, tenant, …})` |
| **Store** | pgvector + tenant DBs | Out of band | Eviction predicates; tenant-DB connection routing |

The read seam is the only place existing code changes, and it's mechanical: swap constants for `resolve(...)`. Wrap it in a small middleware so it's one edit, not many.

---

## Runtime flows

**Ingest.** Source event → Loading Orchestrator → type adapter transform (scrub / distill / chunk) → metadata stamp → existing ingestion API → pgvector. Live schema (1b) skips the store entirely.

**Retrieve.** Query → retriever calls `resolver.resolve(top_k|threshold|reranker, scope)` → executes against pgvector (tenant DB if tenant-scoped) → generator.

**Tune.** Generator emits outcome → Collector → distillation → Controller compares objective to target → bounded proposal → (auto) write `current_value` + audit, or (propose) queue for Admin approval → Resolver cache invalidated.

**Evict.** Hygiene worker scans metadata → applies supersede/decay rules → deprecates or deletes vectors.

---

## Deployment shape

- Control plane: stateless API service + control Postgres DB.
- Tuning Controller and Eviction worker: scheduled/streaming workers, separate from the request path.
- Config Resolver: embedded SDK + short-TTL cache so the hot path never blocks on the control plane.
- Loading Orchestrator: service or library on the write path.
- Per-tenant pgvector databases for tenant-scoped knowledge (Types 4 and tenant telemetry insights).

---

## Build order (logical dependency, not calendar)

1. **Config Store + registry schema + Admin API/console.** Foundation — everything reads it.
2. **Config Resolver + retrieval-path injection (read seam).** Parameters become live, manually configurable. Ships value on its own.
3. **Telemetry Collector + outcome emit (telemetry seam).** Signal starts flowing.
4. **Tuning Controller.** Closes the learning loop; the Locked/Learning check now does something.
5. **Loading Orchestrator + type adapters (write seam).** Formalizes the five regimes.
6. **Eviction / Hygiene worker.** Index-rot protection.
7. **Tenant → DB catalog + per-tenant routing** (if not already present).

Each component is hours-scale at Claude Code velocity; the calendar time is design decisions and validation, not engineering hours. Steps 1–2 alone deliver a manually tunable RAG; 3–4 make it self-tuning; the rest is loading discipline and hygiene.

---

## Net-new vs. reused

**Reused:** embedding, pgvector, retriever, generator, ingestion API.
**Net-new:** Loading Orchestrator + type adapters, Telemetry Collector + distillation, Config Store, Config Resolver, Tuning Controller, Eviction worker, Tenant→DB catalog, Admin console.

The only net-new component with no precedent in a standard RAG is the **Tuning Controller** — and it's deliberately the last thing built, so the system is useful (manually configurable) well before it's autonomous.
