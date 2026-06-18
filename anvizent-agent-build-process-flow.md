# Agent Build Process Flow — Datamart / Pipeline JSON Generation

**Scope:** The ordered process the agent (Data Engineering Bot) follows to generate datamart / pipeline JSON from a user's business question, grounded in the RAG. This documents the agent's build *method*; the method is authoritative and fixed — this spec captures it, it does not redefine it.

**Companion to:** `anvizent-rag-loading-spec.md` and the RAG Population Strategy (the agent is Source C — it both consumes the RAG to ground its questions and produces Type 2/3/4/5 knowledge on deploy).

---

## Cross-cutting invariants

These two patterns are applied at **every** identification step below — they are not separate phases.

### 1. The "state & dispute" RAG-aware pattern
For every element the agent needs to identify:

- **If it is NOT in RAG → ask the user.**
- **If it IS in RAG → state what you are going to use** ("I'm going to use these systems / tables / fields to fetch …") and give the user a chance to **dispute** before proceeding.

The asking-and-stating loop — so the user always gets a chance to dispute what the agent intends to use — is followed throughout.

### 2. Role-adaptive questioning
Phrase questions to the user's role:

- **Business user →** keep it to the business implication.
- **Analyst / Engineer →** make it table- and column-level.

---

## Process flow

### Step 1 — Intake & source applications
- Get the business question.
- Identify the source applications. Ask if not in RAG; if present in RAG, state the systems you'll use to fetch and invite dispute.

### Step 2 — Scope all sources (clarify the metrics in the question)
To clarify the metrics needed in the question, identify across all source applications:
- tables / APIs from each application
- webhooks
- files present in any FTP locations, etc.

### Step 3 — Elements per source
Once the sources are identified, identify the elements (fields) needed for each of them. Same pattern — ask if not in RAG, confirm if it is.

### Step 4 — DW table classification & dimension resolution
- These are the DW tables. Identify which are **transaction tables** and which are **dimension tables**.
- Bring all related **dimension resolution** for all transaction tables.
- Identify what data you need to **filter based on how far back** in history you want to go. Same RAG approach (ask / confirm).

### Step 5 — Load strategy
Identify whether you need a **full load** or an **incremental load**.

### Step 6 — DW table JSON
- Create the JSON for DW tables that are **not already there**.
- If they already exist, **add only the columns** that are needed.

### Step 7 — Driving table
Identify the driving table (the primary fact / transaction table that anchors the analysis).

### Step 8 — Filter / group-by order
Identify **filter followed by group by** or **group by followed by filter**.

### Step 9 — Filter & group-by specifics
Identify:
- the columns / fields in the filter and in the group by
- the values and conditions in the filters
- the columns in the group by

### Step 10 — Transaction-table joins
Identify if you need to join with other transaction tables.

### Step 11 — Lookup tables
Identify the lookup tables and, for each, whether you need to:
- filter and group by, or
- group by and filter, or
- just group by, or
- just filter

…and the corresponding values.

### Step 12 — Join conditions (role-adaptive)
- Identify the join conditions based on RAG; confirm if not present.
- Depending on the user role — business user / analyst / engineer — ask the join questions appropriately: for a business user keep the business implication; for analyst and engineer make it table- and column-level.

### Step 13 — Field selection & renaming
- Keep the fields you need and drop the ones you do not.
- Rename fields to make business sense based on context.

### Step 14 — Calculated values / metrics
- Identify the calculated values / metrics needed.
- First build the metrics that are **common across more compound metrics**, to get the formulae consistent.
- Build all metrics by asking questions and using RAG.

### Step 15 — Final shaping
Filter and group by, or group by and filter, with the relevant elements if needed.

### Step 16 — Emit the datamart JSON
Create the datamart JSON.

---

## Datamart reuse evaluation

Use the method above to build a datamart, then **evaluate whether an existing datamart can be leveraged** — reducing the build to just **adding new data-warehouse tables and columns** rather than building from scratch.
