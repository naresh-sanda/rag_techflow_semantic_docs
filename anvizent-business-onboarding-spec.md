# Business Onboarding — Tenant Context Capture (Type 7)

**Scope:** How the platform captures a customer's **business context** — what the business is, what it sells, how it makes money, and how its data flows across the revenue lifecycle — and keeps it current. This context lands in the RAG as **Type 7 — Business onboarding context** so the agent can *suggest* instead of *ask*, reducing the questions on every new data-pipeline build.

**Companion to:** `anvizent-rag-loading-spec.md`, the RAG Population Strategy (this is **Source D**), `anvizent-agent-build-process-flow.md`, and `anvizent-rag-reconciliation-decisions.md`.

---

## Why it exists

Per the reconciliation, there are **no canonical patterns on day one** (C11) and the industry seed (Source B) is **generic** — so a brand-new tenant has no tenant-specific grounding. **Business onboarding is how a tenant gets that grounding immediately:** the customer tells us, once, what their business is and how their data flows, and the agent uses it from the first pipeline build.

The payoff is question reduction. The data-flow map is the spine: a question about "win rate" → context says *closing* runs in CRM X → the agent **suggests** the source and entities instead of asking cold.

---

## Two core principles

### 1. The data flow is canonical; the stages are not
**Capturing the data flow is required for every business.** The *steps* in that flow vary by business type, so they are **not hard-coded** — the agent **derives the stages with basic questions and confirms them with the user** (suggest & confirm, C6).

A common revenue lifecycle is offered as a **starting template**:

> `prospect → lead → closing → delivery → billing → support → reselling`

…but the agent proposes it, then adds/renames/removes stages per the business (e.g. a marketing/awareness stage upstream, renewal/expansion split out, a supply/COGS track so margin has its cost side). The **confirmed, business-specific stage list** is what gets stored — never the template by assumption.

### 2. Business context is a living record
Onboarding is the **initial seed, not a freeze.** Business context is **updatable throughout the customer lifecycle** — new product lines, new revenue streams, new systems, changed processes. Updates **supersede** prior versions (lineage retained). They are triggered by explicit re-onboarding **or** surfaced during pipeline builds ("you told us X served *billing* — has that changed?").

---

## Two onboarding tracks

### A. Business onboarding (foundational, once — then maintained)
Answered by the **business user** (owner of requirements, C12). Captures:

- **Identity** — what the business is · website · industry / vertical.
- **Offerings** — products / services / solutions delivered to customers.
- **Differentiation** — unique advantages; why customers choose them.
- **Economics** — how they make money (revenue model: subscription / transactional / project / reselling / …) and **where margin comes from** (margin drivers + the cost / COGS side — margin is revenue *minus* cost, so the cost side is captured too).
- **Data flow** — the derived-and-confirmed stage list (principle 1); for each stage: the **systems**, the **key entities**, and the **handoffs** between stages.

### B. System onboarding (progressive — at the moment a system is added)
Answered by the **engineer / analyst**. For each source system, captured when it's brought in (honoring progressive opt-in — not demanded upfront):

- Which value-chain **stage(s)** it serves and its role.
- Key **objects / identifiers** and how records flow in and out.
- **Connection method** — API · webhook · FTP file · DB. If structure isn't known, the agent asks the user to supply it or a doc link and loads it into RAG (C7).

---

## Intake modes — Q&A *and* document / link upload

The customer rarely wants to answer everything from scratch — they already have decks, brochures, contracts, and a website that describe the business. So context enters Type 7 two ways, and both feed the **same suggest-&-confirm** loop:

1. **Guided Q&A** — the agent asks; the user answers (the tracks above).
2. **Document & link upload** — the user supplies what they already have; the system **extracts candidate context** and **proposes it for confirmation**.

### Supported formats
| Format | Examples | Extraction |
|---|---|---|
| **PDF** | pitch decks, brochures, contracts, annual reports | text parse; **OCR** for scanned pages |
| **Word** (`.docx`) | company overviews, SOPs, process docs | text + structure parse |
| **Images** | logos, screenshots, org charts, scanned one-pagers | **OCR + vision** model |
| **Website links** | homepage, About, Products, Pricing, How-it-works | fetch + readability extraction |
| *(extensible)* | spreadsheets, slides, plain text | any format → extract → propose → confirm |

### The ingestion flow
**Upload / link → extract (parse · OCR · vision · fetch) → LLM proposes candidate fields and value-chain stages → user confirms / corrects → Type 7.**

- **Never auto-written.** Extracted business facts are *proposals*; the business user confirms them — same guardrail as everywhere else (suggest & confirm; no silent canonization, C6/C8).
- **Provenance.** Every uploaded artifact is recorded (format, file/URL, extraction status) and **linked to the facts it produced**, so each confirmed field is traceable to its source and the record stays auditable.
- **Living.** Re-uploading an updated deck or re-fetching the website **supersedes** the prior extraction (lineage retained) — onboarding stays current across the customer lifecycle.
- **Privacy.** The user uploads / links; the platform never reaches into systems on its own. Untrusted document content is treated as data to extract, not instructions to act on.

---

## How it lands in the RAG (Type 7)

- **Knowledge type:** `business_context` (Type 7) — tenant-scoped, gated, **`company` scope** (C2 taxonomy).
- **Storage:** a **discovery vector** in `kb_chunk` (`knowledge_type='business_context'`) **plus** the structured relational record (`business_context` + `value_chain_stage` + `system_inventory`) and the upload **provenance** (`onboarding_source`) in the **tenant database** (agents are tenant-specific, C10).
- **Population:** **Source D** — tenant-supplied business onboarding. Foundational load + lifecycle updates (distinct from the generic Source B seed and the earned Source C usage).
- **Refresh / eviction:** version-supersede on any lifecycle update; prior retained read-only for lineage.
- **Retrieval:** consulted **first** in the agent's suggest-&-confirm loop, scoped to the tenant and the active `embed_model_version` (C13).

---

## How it reduces agent questions

During the agent build process flow, before asking, the agent reads Type 7:

- **Source applications** (step 1) — the system inventory already names the systems and the stages they serve → suggest, don't ask.
- **Which stage a metric belongs to** — the data-flow map routes "revenue" → billing, "pipeline" → lead/closing → suggests the right system/entities.
- **Metric framing** — the economics (revenue model, margin drivers) seed candidate metrics and their business meaning.
- **New systems** — system onboarding pre-answers the structural questions for that system on every future build.

Each onboarded fact removes a class of repeated questions; the living updates keep it from going stale.

---

## Locked decisions

1. **New Type 7** — business onboarding context; tenant-scoped, gated, `company` scope.
2. **Data flow is canonical to capture; stages are derived per business and user-confirmed** — never hard-coded.
3. **Living record** — updatable across the customer lifecycle; updates supersede with lineage.
4. **Source D** in the population model — tenant-supplied, foundational + lifecycle-maintained.
5. **Hybrid delivery** — business context upfront (once), system detail progressively (progressive opt-in).
6. **Ownership** — business onboarding → business user; system onboarding → engineer / analyst.
7. **Two intake modes** — guided Q&A **and** document / link upload (PDF · Word · images · website links, extensible). Uploads are **extracted → proposed → confirmed** (never auto-written), with **provenance** recorded and superseded on re-upload.
