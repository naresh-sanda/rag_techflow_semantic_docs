-- =====================================================================
-- Anvizent RAG Tuning Add-On — Database Layer
-- Postgres + pgvector. Two roles:
--   (A) CONTROL DB      — config registry, audit, proposals, catalogs.
--   (B) KNOWLEDGE STORE — pgvector chunks. One GLOBAL db + one db PER TENANT
--                         (same schema, different physical database).
-- Vector dimension is a placeholder (1536); set it to your embedding model.
-- =====================================================================


-- #####################################################################
-- (A) CONTROL DB  —  single database, schema `control`
--     Owns ALL configuration (global + per-tenant overrides) centrally.
-- #####################################################################

CREATE SCHEMA IF NOT EXISTS control;
SET search_path = control;

-- ---- enums ----------------------------------------------------------
CREATE TYPE value_type      AS ENUM ('int','float','interval','bool','text','enum');
CREATE TYPE param_scope     AS ENUM ('global','tenant','both');   -- eligibility
CREATE TYPE value_scope     AS ENUM ('global','tenant');          -- a concrete value's scope
CREATE TYPE value_source    AS ENUM ('default','user','learned');
CREATE TYPE apply_behavior  AS ENUM ('auto','propose');
CREATE TYPE proposal_status AS ENUM ('pending','approved','rejected','applied','expired');
CREATE TYPE tenant_status   AS ENUM ('provisioning','active','suspended','offboarding','dropped');
CREATE TYPE model_status    AS ENUM ('candidate','active','deprecated');

-- ---- 1. parameter definitions (the registry) -----------------------
-- One row per tunable. Holds the immutable-ish definition + the default.
CREATE TABLE tunable_parameter (
    key             text PRIMARY KEY,                 -- e.g. 'retrieval.top_k'
    description     text NOT NULL,
    value_type      value_type NOT NULL,
    default_value   jsonb NOT NULL,                   -- typed value as jsonb
    bounds          jsonb NOT NULL,                   -- {"min":3,"max":20} | {"allowed":[...]}
    scope_eligible  param_scope NOT NULL,             -- can it be set per-tenant?
    apply_behavior  apply_behavior NOT NULL,          -- auto | propose (parameter attribute)
    triggers_reembed boolean NOT NULL DEFAULT false,  -- forces propose, full re-embed
    learning_signal text,                             -- doc: which telemetry drives it
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---- 2. effective values per scope ---------------------------------
-- A row exists only where a value OVERRIDES the default.
-- learning_enabled is the user-facing check: false = Locked (manual).
CREATE TABLE parameter_value (
    id                bigserial PRIMARY KEY,
    param_key         text NOT NULL REFERENCES tunable_parameter(key) ON DELETE CASCADE,
    scope_type        value_scope NOT NULL,
    tenant_id         text,                            -- NULL when scope_type='global'
    current_value     jsonb NOT NULL,
    source            value_source NOT NULL,
    learning_enabled  boolean NOT NULL DEFAULT false,  -- the Locked / Learning check
    justifying_window jsonb,                            -- set when source='learned'
    last_changed_by   text NOT NULL,                    -- user id or 'controller'
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_id_matches_scope CHECK (
        (scope_type = 'global' AND tenant_id IS NULL) OR
        (scope_type = 'tenant' AND tenant_id IS NOT NULL)
    ),
    UNIQUE (param_key, scope_type, tenant_id)
);
CREATE INDEX ix_paramvalue_lookup ON parameter_value (param_key, scope_type, tenant_id);

-- ---- 3. append-only change log (evidence substrate / rollback) -----
CREATE TABLE parameter_change_log (
    id                bigserial PRIMARY KEY,
    param_key         text NOT NULL,
    scope_type        value_scope NOT NULL,
    tenant_id         text,
    old_value         jsonb,
    new_value         jsonb NOT NULL,
    change_source     value_source NOT NULL,
    actor             text NOT NULL,                    -- user id or 'controller'
    justifying_window jsonb,                            -- telemetry window + metric deltas
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_changelog_param ON parameter_change_log (param_key, created_at DESC);

-- ---- 4. pending proposals (for apply_behavior='propose') -----------
CREATE TABLE tuning_proposal (
    id                bigserial PRIMARY KEY,
    param_key         text NOT NULL REFERENCES tunable_parameter(key),
    scope_type        value_scope NOT NULL,
    tenant_id         text,
    current_value     jsonb NOT NULL,                   -- snapshot at proposal time
    proposed_value    jsonb NOT NULL,
    justifying_window jsonb NOT NULL,
    evaluation        jsonb,                            -- shadow / A-B result
    status            proposal_status NOT NULL DEFAULT 'pending',
    created_at        timestamptz NOT NULL DEFAULT now(),
    decided_at        timestamptz,
    decided_by        text
);
CREATE INDEX ix_proposal_open ON tuning_proposal (status) WHERE status = 'pending';

-- ---- 5. controller execution audit ---------------------------------
CREATE TABLE tuning_run (
    id                bigserial PRIMARY KEY,
    window_start      timestamptz NOT NULL,
    window_end        timestamptz NOT NULL,
    params_evaluated  int NOT NULL DEFAULT 0,
    params_changed    int NOT NULL DEFAULT 0,
    proposals_filed   int NOT NULL DEFAULT 0,
    rolled_back       int NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---- 6. tenant -> database catalog ---------------------------------
-- Drives db-per-tenant routing. Secret is referenced, not stored (BYOV).
CREATE TABLE tenant_catalog (
    tenant_id           text PRIMARY KEY,
    database_name       text NOT NULL UNIQUE,
    connection_ref      text NOT NULL,                  -- vault reference, NOT the secret
    status              tenant_status NOT NULL DEFAULT 'provisioning',
    embed_model_version text NOT NULL,                  -- coordinates re-embed
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_tenant_active ON tenant_catalog (status) WHERE status = 'active';

-- ---- 7. embedding model registry (advisory swap + versioning) ------
CREATE TABLE embedding_model_version (
    version       text PRIMARY KEY,                     -- stamped into every vector row
    model_name    text NOT NULL,
    provider      text NOT NULL,
    dimensions    int  NOT NULL,
    status        model_status NOT NULL DEFAULT 'candidate',
    activated_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- resolver function: effective value with precedence ------------
-- Precedence:  user lock > learned/global value > default.
-- Resolution order: tenant override  ->  global override  ->  default.
CREATE OR REPLACE FUNCTION resolve_parameter(p_key text, p_tenant text DEFAULT NULL)
RETURNS TABLE (effective_value jsonb, source value_source, learning_enabled boolean, locked boolean)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    -- tenant-scoped override
    IF p_tenant IS NOT NULL THEN
        RETURN QUERY
        SELECT pv.current_value, pv.source, pv.learning_enabled, (pv.learning_enabled = false)
        FROM parameter_value pv
        WHERE pv.param_key = p_key AND pv.scope_type = 'tenant' AND pv.tenant_id = p_tenant;
        IF FOUND THEN RETURN; END IF;
    END IF;

    -- global override
    RETURN QUERY
    SELECT pv.current_value, pv.source, pv.learning_enabled, (pv.learning_enabled = false)
    FROM parameter_value pv
    WHERE pv.param_key = p_key AND pv.scope_type = 'global';
    IF FOUND THEN RETURN; END IF;

    -- definition default
    RETURN QUERY
    SELECT tp.default_value, 'default'::value_source, false, false
    FROM tunable_parameter tp
    WHERE tp.key = p_key;
END;
$$;

-- ---- seed example ---------------------------------------------------
INSERT INTO tunable_parameter
    (key, description, value_type, default_value, bounds, scope_eligible, apply_behavior, triggers_reembed, learning_signal)
VALUES
    ('retrieval.top_k', 'Number of chunks retrieved per query', 'int',
     '8'::jsonb, '{"min":3,"max":20}'::jsonb, 'both', 'auto', false,
     'retrieved-context-used-in-success rate'),
    ('embedding.model', 'Active embedding model version', 'enum',
     '"v1"'::jsonb, '{"allowed":["v1","v2-candidate"]}'::jsonb, 'global', 'propose', true,
     'A/B retrieval quality');


-- #####################################################################
-- (B) KNOWLEDGE STORE  —  schema `kb`
--     Deployed in the GLOBAL database AND in EACH tenant database.
--     Global db holds: sor_doc, pattern, semantics, telemetry_insight(global).
--     Tenant db  holds: customization, telemetry_insight(tenant).
-- #####################################################################

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS kb;
SET search_path = kb;

CREATE TYPE knowledge_type AS ENUM
    ('sor_doc','pattern','semantics','telemetry_insight','customization',
     'resolved_semantics');                              -- Type 6: DW/datamart catalog
CREATE TYPE chunk_status   AS ENUM ('active','deprecated');

-- Type 6 scope: resolved context spans the company down to a single user.
CREATE TYPE semantic_scope AS ENUM ('company','department','purpose','role','user');

-- ---- the vector table (write-mostly-once) --------------------------
CREATE TABLE kb_chunk (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_type      knowledge_type NOT NULL,
    namespace           text NOT NULL,                  -- e.g. 'kb:patterns:global'
    content             text NOT NULL,
    embedding           vector(1536) NOT NULL,          -- match embed_model_version dims
    embed_model_version text NOT NULL,
    source              text,
    status              chunk_status NOT NULL DEFAULT 'active',
    supersedes          uuid REFERENCES kb_chunk(id),   -- version chain
    superseded_by       uuid REFERENCES kb_chunk(id),
    confidence          real,                           -- telemetry_insight decay
    last_reinforced_at  timestamptz,                    -- telemetry_insight decay
    scope               semantic_scope,                 -- Type 6: required for resolved_semantics
    scope_ref           text,                           -- dept id / purpose key / role / user id
    composes_of         uuid[],                         -- Type 6: sub-datamart chunk ids (composition)
    metadata            jsonb NOT NULL DEFAULT '{}',     -- type-specific fields
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    -- resolved_semantics must carry a scope; other types must not.
    CONSTRAINT scope_only_for_resolved CHECK (
        (knowledge_type = 'resolved_semantics' AND scope IS NOT NULL) OR
        (knowledge_type <> 'resolved_semantics' AND scope IS NULL)
    )
);

-- ANN index (cosine). Partial per-type indexes keep retrieval scoped.
CREATE INDEX ix_chunk_ann
    ON kb_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ix_chunk_type_status ON kb_chunk (knowledge_type, status);
CREATE INDEX ix_chunk_namespace   ON kb_chunk (namespace);
CREATE INDEX ix_chunk_supersedes  ON kb_chunk (supersedes);
CREATE INDEX ix_chunk_meta_gin    ON kb_chunk USING gin (metadata);
-- Type 6 retrieval is scoped: company-wide first, then narrower scopes.
CREATE INDEX ix_chunk_scope ON kb_chunk (knowledge_type, scope, scope_ref)
    WHERE knowledge_type = 'resolved_semantics';

-- ---- pattern stats (hot-updating; split off the big vector row) ----
-- 1:1 with kb_chunk rows where knowledge_type='pattern'.
-- Updated by telemetry; read by the eviction worker for decay.
CREATE TABLE pattern_stats (
    chunk_id         uuid PRIMARY KEY REFERENCES kb_chunk(id) ON DELETE CASCADE,
    selection_count  bigint NOT NULL DEFAULT 0,
    success_count    bigint NOT NULL DEFAULT 0,
    failure_count    bigint NOT NULL DEFAULT 0,
    failure_rate     real GENERATED ALWAYS AS (
        CASE WHEN (success_count + failure_count) = 0 THEN 0
             ELSE failure_count::real / (success_count + failure_count) END
    ) STORED,
    last_selected_at timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
-- eviction reads: high failure_rate OR stale last_selected_at
CREATE INDEX ix_pattern_failrate ON pattern_stats (failure_rate DESC);
CREATE INDEX ix_pattern_disuse   ON pattern_stats (last_selected_at);

-- ---- Type 6 relational catalog (concrete, runnable, reusable) -------
-- The vector kb_chunk row (knowledge_type='resolved_semantics') is for
-- discovery; these tables hold the concrete, runnable, composable JSON the
-- datamart-reuse step queries. Tenant-scoped (live in the tenant database).
CREATE TYPE load_mode      AS ENUM ('full','incremental');
CREATE TYPE usage_mode     AS ENUM ('onetime','scheduled');   -- C5: drives confidence
CREATE TYPE dw_table_role  AS ENUM ('transaction','dimension');

-- DW tables registered/extended while building datamarts (C1/C6 of reuse).
CREATE TABLE dw_table_catalog (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    table_role    dw_table_role NOT NULL,                 -- transaction | dimension
    source_system text,                                   -- origin SOR
    load_mode     load_mode NOT NULL,                     -- full | incremental
    columns       jsonb NOT NULL DEFAULT '[]',            -- registered columns (add-only growth)
    dw_table_json jsonb NOT NULL,                         -- the working DW-table JSON
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, source_system)
);

-- Datamarts (incl. reusable sub-datamarts). composes_of = sub-datamart ids.
CREATE TABLE datamart_catalog (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    scope           semantic_scope NOT NULL,              -- company..user (C2)
    scope_ref       text,                                 -- dept/purpose/role/user key
    purpose         text,                                 -- the question/requirement it serves
    usage_mode      usage_mode,                           -- onetime | scheduled (C5)
    confirmed_by    text,                                 -- role owner who confirmed (C12)
    validated       boolean NOT NULL DEFAULT false,       -- data validation passed (C5)
    is_canonical    boolean NOT NULL DEFAULT false,       -- earned via usage, never seeded (C11)
    driving_table   text,                                 -- anchor (build step 7)
    datamart_json   jsonb NOT NULL,                       -- the working datamart JSON (C1)
    composes_of     uuid[],                               -- reusable sub-datamarts (C3)
    chunk_id        uuid REFERENCES kb_chunk(id),         -- discovery vector (Type 6)
    embed_model_version text,                             -- coordinates re-embed (C13)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_datamart_scope     ON datamart_catalog (scope, scope_ref);
CREATE INDEX ix_datamart_canonical ON datamart_catalog (is_canonical) WHERE is_canonical;
CREATE INDEX ix_datamart_composes  ON datamart_catalog USING gin (composes_of);

-- =====================================================================
-- NOTES
--  • Live source schema (Type 1b) is NOT stored here — metadata-service
--    cache only. No table by design.
--  • Customizations (Type 4) and tenant telemetry insights live ONLY in
--    tenant databases, using this same kb_chunk shape.
--  • supersedes / superseded_by form the version chain that the eviction
--    worker walks; status flips to 'deprecated' before hard delete.
--  • Re-embedding (advisory swap of embedding.model) writes new rows with
--    the new embed_model_version; never mix model versions in one ANN scan.
--  • Tenant offboarding = DROP DATABASE <tenant db>, then mark
--    tenant_catalog.status='dropped'. No cross-tenant cleanup needed.
--  • Type 6 (resolved_semantics): the kb_chunk row is the discovery vector;
--    dw_table_catalog + datamart_catalog hold the concrete runnable JSON the
--    reuse step composes. Tenant-scoped — agents are tenant-specific (C10).
--  • Capture is usage-based, not deploy-based (C5): onetime usage = low
--    reliance/narrow scope; scheduled usage = a purpose served (rely, but
--    confirm scope). datamart_catalog.usage_mode/validated/confirmed_by record it.
--  • Canonical status is EARNED via tenant usage, never seeded (C11):
--    is_canonical flips on once a datamart/pattern recurs across usage.
--  • Retrieval co-mixes only same embed_model_version vectors (C13).
-- =====================================================================
