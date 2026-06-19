# Agent Build Process Flow — Datamart / Pipeline JSON Generation

**Scope:** The ordered process the agent (Data Engineering Bot) follows to generate datamart / pipeline JSON from a user's business question, grounded in the RAG. This documents the agent's build *method*; the method is authoritative and fixed — this spec captures it, it does not redefine it.

**Companion to:** `anvizent-rag-loading-spec.md`, the RAG Population Strategy, and `anvizent-rag-reconciliation-decisions.md`. The agent is **Source C** — it consumes the RAG to ground its questions and produces Type 2 / 3 / 4 / 5 **and Type 6 (resolved contextual semantics)** knowledge. The agent is **tenant-specific** (C10); global agents are deferred.

---

## Cross-cutting invariants

These patterns are applied at **every** identification step below — they are not separate phases.

### 1. "Suggest & confirm" — the RAG-aware pattern (C6)
For every element the agent needs to identify:

- **If it IS in RAG → ask a question that includes the RAG-derived suggestion** ("I plan to use … — confirm or correct?"), phrased to the role. The user always gets to dispute.
- **If it is NOT in RAG → ask openly.** If the user doesn't have it either, ask them to **supply it or a link to the documents**, then **load it into RAG** (C7).

Both are questions; the only difference is whether a suggestion is offered.

### 2. Role-adaptive questioning & ownership (C12)
Phrase the question — and route the confirmation — to the role's ownership:

- **Business user → owner of requirements.** Keep it to the business implication.
- **Analyst → owner of definitions.** Table- and column-level.
- **Engineer → owner of deployments.** Table- and column-level.

### 3. Tenant scope (C10)
The agent is **tenant-specific**; all retrieval and production stay within the tenant. Global agents are deferred.

### Reconciliation & extraction hygiene — applied throughout, enforced at JSON validation (C4)
- **Extract by date/time range only** — never by business attributes (so nothing needed later is excluded).
- **Extract each dataset individually; never pre-join during extraction.**
- **Before any join, ensure row-level uniqueness on the join keys** — dedup, apply defaults for nulls, cleanse.
- **Cross-reference every dimension; flag unmatched values as "Unknown"** — never drop records.

---

## Process flow

### Step 1 — Intake & source applications
Get the business question. Identify the source applications (suggest & confirm).

### Step 2 — Scope all sources (clarify the metrics in the question)
Across all source applications, identify: tables / APIs, **webhooks**, and **files in FTP locations**, etc. For anything unknown / not in RAG, ask the user to supply it or a doc link and load it into RAG (C7).

### Step 3 — Elements per source
Identify the elements (fields) needed for each source (suggest & confirm).

### Step 4 — DW classification, dimension resolution & history depth
Identify which DW tables are **transaction** vs **dimension**. Bring all related **dimension resolution** for every transaction table. Identify the **date/time range** (how far back) that drives what to extract.

### Step 5 — Load strategy
Identify **full load** or **incremental load** per DW table.

### Step 6 — DW table JSON
Create JSON for DW tables **not already there**; for existing ones, **add only the needed columns**. Registers/extends `dw_table_catalog` (Type 6).

### Step 7 — Decompose & reuse check (sub-datamarts) (C3)
Break the requirement into **sub-datamarts**. Check the datamart catalog for existing datamarts/sub-datamarts that already answer a sub-component; **reuse and compose** them, adding only net-new DW tables/columns rather than rebuilding.

### Step 8 — Driving table
Identify the driving table (the primary fact / transaction table that anchors the analysis).

### Step 9 — Filter / group-by order
Identify **filter → group by** or **group by → filter**.

### Step 10 — Filter & group-by specifics
Identify the columns/fields in the filter and group by, the values and conditions in the filters, and the columns in the group by.

### Step 11 — Transaction-table joins
Identify if you need to join with other transaction tables.

### Step 12 — Lookup tables
For each lookup table, identify whether you need: filter & group by · group by & filter · just group by · just filter — and the corresponding values.

### Step 13 — Join conditions (role-adaptive)
Identify the join conditions from RAG (suggest & confirm). Ask per role: business user → business implication; analyst & engineer → table/column level.

### Step 14 — Field selection & renaming
Keep the fields you need; drop the rest. Rename fields to make business sense based on context.

### Step 15 — Calculated values / metrics
Identify the metrics needed. Build the **base metrics common across compound metrics first** (formula consistency), then the rest, asking questions and using RAG. **On a metric definition incongruent with an existing one, ask the user *why* and record the reason/explanation in RAG** (C8) — do not silently diverge.

### Step 16 — Final shaping
Filter & group by, or group by & filter, with the relevant elements if needed.

### Step 17 — Scope, usage & ownership confirmation (C2 / C5 / C12)
- **Elicit the scope** of the result — `company / department / purpose / role / user` — and tag the datamart with it.
- **Confirm the usage:** onetime (low reliance, narrow scope) or **scheduled** (a purpose is being served — rely, but confirm the purpose's scope).
- Route confirmations to owners: requirements → business user, definitions → analyst, deployment → engineer.

### Step 18 — JSON validation
Validate the JSON, enforcing the reconciliation & extraction-hygiene rules above (Unknown-flagging, row-level uniqueness before joins, date-range extraction, no pre-join).

### Step 19 — Emit & record
Emit the **datamart JSON**. On confirmation + validation + usage (C5), record it as **Type 6 resolved contextual semantics** (vector + `datamart_catalog`), scope-tagged and linked to its sub-datamarts; the generalized pattern feeds **Type 2** and earns canonical status only through repeated usage (C11).

---

## Datamart reuse evaluation (compositional)

Reuse is **compositional** (C3): decompose the requirement into sub-components, where **each sub-component can be a datamart**. Each sub-datamart can be:

- **composed into the current final datamart** to answer this question, and
- **reused in other datamarts** to answer other questions.

So building a datamart is: decompose → match sub-components against the datamart catalog → reuse what exists, **adding only new data-warehouse tables and columns** → compose the final mart. Canonical (common) datamarts are **earned through tenant usage, not seeded** (C11).
