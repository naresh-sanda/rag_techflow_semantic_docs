# RAG Reconciliation — Decision Record

**Purpose:** Reconcile the three specs — **RAG Loading & Tuning**, **RAG Population Strategy**, and **Agent Build Process Flow** — and record the canonical resolution for every conflict found at their seams. These decisions are authoritative; the three specs are patched to match them.

**Reconciles:** `anvizent-rag-loading-spec.md` · RAG Population Strategy · `anvizent-agent-build-process-flow.md`

---

## New concepts introduced by this reconciliation

### Type 6 — Resolved contextual semantics (the DW + datamart catalog)
The agent operates on a **data-warehouse / datamart layer** the original five knowledge types did not model. A datamart's **working JSON, its DW tables, and the specific columns it uses** are themselves semantic knowledge — *resolved context for a question*, reusable across the company. This is captured as a new knowledge type:

- **Storage:** vector chunks (for discovery) **plus** a relational **datamart / DW catalog** (concrete, runnable, versioned) — so reuse has a real backing store.
- **Scope (required):** every Type 6 record carries a `scope` — `company · department · purpose · role · user`. The agent **asks** the scope; some resolved context spans the company, some is situation- or role-specific.
- **Composition:** records carry `composes_of` links. A requirement is decomposed into **sub-datamarts**; each is a reusable building block for the final datamart *and* for other questions.

### Scope taxonomy
`company → department → purpose → role → user`. Elicited by the agent and attached to Type 6 records (and to the confirmation of a purpose's scope, per C5).

### Role ownership
- **Business user → owner of requirements**
- **Analyst → owner of definitions**
- **Engineer → owner of deployments**

These drive both the role-adaptive questioning and who confirms what (requirements vs definitions vs deployment).

---

## Decision record

### C1 — Datamart JSON is semantic knowledge `[Type 6]`
The pipeline/datamart **working JSON + DWs + columns used** is stored as **resolved contextual semantics (Type 6)**, not merely a generalized Type 2 pattern. It holds the resolved context of the question and is shared across the company.

### C2 — DW/DM knowledge is scoped, and the agent elicits scope `[Type 6]`
Type 6 records carry a `scope` (`company/department/purpose/role/user`). The agent **asks** which scope applies and stores the record tagged accordingly. This is the home for the DW + datamart catalog.

### C3 — Reuse is compositional `[Type 6]`
A requirement is broken into **sub-datamarts**; each can be reused to assemble the current final datamart or to answer other questions. The catalog stores composable units linked by `composes_of`. The reuse step = decompose → match sub-components to existing datamarts → compose, adding only net-new DW tables/columns.

### C4 — Reconciliation discipline lives in the build + JSON validation
The reconciliation/extraction rules — **flag unmatched dimension values as "Unknown"** (never drop), **row-level uniqueness before any join**, **date/time-range-only extraction**, **never pre-join during extraction**, **extract datasets individually** — are explicit datamart-build steps **and** enforced at **JSON validation**.

### C5 — Capture is usage-based, not deploy-based
**"Deployment success means nothing."** Capture/confidence is driven by **user confirmation + data validation + usage**:
- **Onetime usage** → confirm narrowly; low reliance (store low-confidence, tight scope).
- **Scheduled usage** → strong signal (a purpose is being served); rely on it — but still **confirm the scope of the purpose** (`company/department/role/...`).

### C6 — "Suggest & confirm" (RAG-aware, role-phrased)
When something **is in RAG**, the agent asks a question that **includes the RAG-derived suggestion**, phrased to the role; when **not in RAG**, it asks openly (then C7). Replaces the earlier "state & dispute" wording.

### C7 — User-supplied ingestion for unknowns
For anything the agent doesn't know / isn't in RAG (incl. **webhooks** and **FTP files**): ask the user to **supply the information or a link to the documents**, then **load it into RAG** (Type 1a). User-driven ingestion path.

### C8 — Metric divergence is explained and recorded
When a new metric definition is **not congruent** with an existing one, ask the user **why**, then **record the reason/explanation in RAG** alongside the divergence (not a silent batch-diff entry).

### C9 — Two population phases
**Initial load = generic** (vendor standardized metadata + industry seed). **Ongoing population = Q&A** from users **+ telemetry** as the agents work. Records start generic and are enriched by Q&A and telemetry.

### C10 — Agents are tenant-specific
All agents in this spec are **tenant-scoped**; the tenant is the boundary. **Global agents are deferred** to a later spec — no cross-tenant routing now.

### C11 — No canonicals on day one
**Canonical (common) datamarts and patterns emerge from tenant usage** — none exist on day one. The industry seed (Source B) provides **generic semantics only**; canonical status is *earned* through repeated usage, not seeded.

### C12 — Role ownership (see above)
Business = requirements · Analyst = definitions · Engineer = deployments. No additional owner roles in the current spec.

### C13 — Retrieval respects the embedding model version
Retrieval only mixes vectors of the **same `embed_model_version`**; a model change implies a re-embed pass before those vectors are co-retrieved.

---

## Net effect on the three specs

- **Loading & Tuning** — adds **Type 6** (knowledge type + `scope`/`composes_of` + relational datamart/DW catalog); capture trigger becomes **usage-based** (C5); Type 2 canonicals are **emergent, not seeded** (C11); retrieval honors `embed_model_version` (C13).
- **Population Strategy** — Source B seeds **generic semantics only** (C11); usage-based trigger (C5); **user-supplied ingestion** path for unknowns (C7); Source C also produces **Type 6** scoped/composable datamart semantics (C1–C3); tenant-scoped (C10).
- **Agent Build Process Flow** — adds **reconciliation + extraction-hygiene steps and JSON validation** (C4); **scope-elicitation** (C2) and **sub-datamart decomposition/reuse** (C3); **suggest-&-confirm** invariant (C6); **user-supplied ingestion** for unknowns (C7); **metric-divergence rationale** capture (C8); **usage-based confirmation** (C5); **role ownership** (C12); tenant-scoped (C10).
