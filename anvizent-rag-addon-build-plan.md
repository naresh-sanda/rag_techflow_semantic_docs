# Anvizent RAG Tuning Add-On — Build Plan

**Sequenced by value delivery and dependency, not calendar.** Estimates are focused engineering hours at Claude Code velocity. Calendar time is set by the design gates and the one real infra item — not by the coding (see final section).

**Builds on:** `anvizent-rag-loading-spec.md`, `anvizent-rag-addon-architecture.md`, `anvizent-rag-addon-schema.sql`.

---

## Critical path, one line

Ship **Milestone 1 first and alone** — it delivers a manually tunable RAG (the advanced-user half of the check) and de-risks everything downstream. Each later milestone adds one capability on top without reworking the last.

---

## Milestone 1 — Manually tunable RAG
**Outcome:** Every parameter is live-configurable by hand through the Admin console. Nothing self-tunes yet. The "advanced users can tweak" half works end to end.

| # | Build | Depends on | Est |
|---|---|---|---|
| 1.1 | Apply control-DB migration (the schema SQL) | — | 1h |
| 1.2 | Config Store API — CRUD on parameters/values + `resolve` endpoint over the SQL function | 1.1 | 3–4h |
| 1.3 | Config Resolver SDK — in-process cache, fail-open to default, `resolve(key, tenant)` | 1.2 | 3h |
| 1.4 | Read-seam injection — swap hardcoded retrieval constants for resolver lookups behind one middleware | 1.3 | 2–3h |
| 1.5 | Admin console (minimal) — Locked/Learning check, set value, list params | 1.2 | 4–6h |

**Gate (decision):** the *parameter inventory* — which constants in the existing retrieval path become tunable. This is a 1-hour decision that unblocks the milestone; get it wrong and 1.4 churns.

---

## Milestone 2 — Signal flowing
**Outcome:** Telemetry is collected and distilled into Type 5 insights landing in the store. Nothing acts on it yet, but the loop has fuel.

| # | Build | Depends on | Est |
|---|---|---|---|
| 2.1 | Telemetry seam — emit outcome on generate (`outcome`, `retrieval_used`, `pattern_id`, `tenant`) | — | 2h |
| 2.2 | Telemetry Collector + queue/topic | 2.1 | 3h |
| 2.3 | Distillation — rules gate → LLM phrasing → `telemetry_insight` vectors | 2.2 | 4–6h |

**Gate (decision):** the rule-gate thresholds and the insight-statement schema — i.e. what counts as "signal." This is the intellectual core of Type 5; the code is trivial once it's defined.

---

## Milestone 3 — Self-tuning
**Outcome:** The Locked/Learning check now *does* something. Auto-apply parameters move within bounds; propose parameters queue for approval. The system tunes itself.

| # | Build | Depends on | Est |
|---|---|---|---|
| 3.1 | Tuning Controller — objective compare, bounded delta, rate-limit, write `current_value` (auto) / file proposal (propose) | 1.2, 2.3 | 6–8h |
| 3.2 | Shadow / A-B evaluation harness + auto-rollback on regression | 3.1 | 4–6h |
| 3.3 | Proposal approval flow in Admin console | 1.5, 3.1 | 3h |

**Gate (decision + validation):** per-parameter objective functions and bounds — the hard part. **Run the controller in shadow mode and watch it before enabling auto-apply.** That observation period is real calendar time and shouldn't be compressed.

---

## Milestone 4 — Loading discipline (write seam)
**Outcome:** The five knowledge types flow through the orchestrator with correct metadata stamping, regimes, and tenant scoping.

| # | Build | Depends on | Est |
|---|---|---|---|
| 4.1 | Loading Orchestrator core — metadata stamp, ingestion wrap | 1.1 | 4h |
| 4.2 | Adapter: connector-metadata doc corpus (1a) | 4.1 | 3h |
| 4.3 | Adapter: live-schema cache, store-bypass (1b) | 4.1 | 3h |
| 4.4 | Adapter: pattern-capture hook on deploy-success (2) | 4.1 | 3–4h |
| 4.5 | Adapter: semantics batch-diff intake (3) | 4.1 | 3h |
| 4.6 | Adapter: customization capture-on-save (4) | 4.1 | 3h |

**Gate (integration):** adapters 4.4 and 4.6 depend on hooks in the *existing platform* (a deploy-success event, an artifact-save event). Where those hooks don't exist yet, that integration is the time sink — not the adapter code.

---

## Milestone 5 — Hygiene + tenancy hardening
**Outcome:** The index can't rot, and database-per-tenant is operationally real.

| # | Build | Depends on | Est |
|---|---|---|---|
| 5.1 | Eviction / Hygiene worker — supersede/decay scans, deprecate → delete | 4.1 | 4–6h |
| 5.2 | `pattern_stats` update path from telemetry | 2.2, 4.4 | 2h |
| 5.3 | Tenant→DB catalog wiring, provisioning runbook, connection-pool/migration fan-out | 1.1 | 6–10h |

**Gate (infra):** 5.3 is the **one genuinely multi-hour-to-day item** — connection pooling across many DBs, migration fan-out, provisioning/offboarding automation. This is the only place the hours-not-days rule bends, because it's multi-system infra.

---

## Parallelization

Two independent tracks once Milestone 1 lands:

- **Track A (tuning):** M2 → M3. Touches the read and telemetry seams.
- **Track B (loading/hygiene):** M4 → M5. Touches the write seam and the store.

They share only the schema (M1.1) and the telemetry collector (M2.2 feeds M5.2). Run them in parallel worktrees; they don't block each other.

---

## Rough rollup

~80–90 focused engineering hours across all five milestones. But that number is not the schedule. The schedule is set by:

1. **Design gates** — parameter inventory (M1), signal/insight schema (M2), objective functions (M3). Hours of decision-making that gate days of confidence.
2. **The shadow-mode observation** before trusting auto-tune (M3) — deliberately not compressible.
3. **Tenant DB provisioning infra** (M5.3) — the only true multi-day engineering item.
4. **Existing-platform hook availability** (M4.4, M4.6) — calendar depends on the other team/codebase, not on this build.

Everything else is hours. If Milestone 1 ships on its own first, you have a manually tunable RAG in production while the design gates for self-tuning are still being settled — which is the right way to sequence it.
