--
-- PostgreSQL database dump
--

\restrict 2gq2Q7RpwSX5iPIb3zF0HeCc3bWBzosUeFogNP0gRnLHzSWgdnkbt0YvWPHCecO

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA auth;


ALTER SCHEMA auth OWNER TO postgres;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA extensions;


ALTER SCHEMA extensions OWNER TO postgres;

--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA graphql;


ALTER SCHEMA graphql OWNER TO postgres;

--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA graphql_public;


ALTER SCHEMA graphql_public OWNER TO postgres;

--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA pgbouncer;


ALTER SCHEMA pgbouncer OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS '';


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA realtime;


ALTER SCHEMA realtime OWNER TO postgres;

--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA storage;


ALTER SCHEMA storage OWNER TO postgres;

--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA vault;


ALTER SCHEMA vault OWNER TO postgres;

--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


ALTER TYPE auth.aal_level OWNER TO postgres;

--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


ALTER TYPE auth.code_challenge_method OWNER TO postgres;

--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


ALTER TYPE auth.factor_status OWNER TO postgres;

--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


ALTER TYPE auth.factor_type OWNER TO postgres;

--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


ALTER TYPE auth.oauth_authorization_status OWNER TO postgres;

--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


ALTER TYPE auth.oauth_client_type OWNER TO postgres;

--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


ALTER TYPE auth.oauth_registration_type OWNER TO postgres;

--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


ALTER TYPE auth.oauth_response_type OWNER TO postgres;

--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: postgres
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


ALTER TYPE auth.one_time_token_type OWNER TO postgres;

--
-- Name: action; Type: TYPE; Schema: realtime; Owner: postgres
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


ALTER TYPE realtime.action OWNER TO postgres;

--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: postgres
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


ALTER TYPE realtime.equality_op OWNER TO postgres;

--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: postgres
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text
);


ALTER TYPE realtime.user_defined_filter OWNER TO postgres;

--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: postgres
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


ALTER TYPE realtime.wal_column OWNER TO postgres;

--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: postgres
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


ALTER TYPE realtime.wal_rls OWNER TO postgres;

--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: postgres
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE storage.buckettype OWNER TO postgres;

--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: postgres
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


ALTER FUNCTION auth.email() OWNER TO postgres;

--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: postgres
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


ALTER FUNCTION auth.jwt() OWNER TO postgres;

--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: postgres
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


ALTER FUNCTION auth.role() OWNER TO postgres;

--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: postgres
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


ALTER FUNCTION auth.uid() OWNER TO postgres;

--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: postgres
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_cron_access() OWNER TO postgres;

--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: postgres
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: postgres
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


ALTER FUNCTION extensions.grant_pg_graphql_access() OWNER TO postgres;

--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: postgres
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: postgres
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_net_access() OWNER TO postgres;

--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: postgres
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: postgres
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_ddl_watch() OWNER TO postgres;

--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: postgres
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_drop_watch() OWNER TO postgres;

--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: postgres
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


ALTER FUNCTION extensions.set_graphql_placeholder() OWNER TO postgres;

--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: postgres
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: postgres
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


ALTER FUNCTION pgbouncer.get_auth(p_usename text) OWNER TO postgres;

--
-- Name: sync_customer_from_lead(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_customer_from_lead(p_lead_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_lead RECORD;
  v_customer_id INT;
  v_head_office TEXT;
  v_has_orders BOOLEAN := false;
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    l.lead_id,
    l.name,
    l.company_name,
    l.email,
    l.phone,
    l.status,
    r.gst,
    r.address AS research_address,
    r.city AS research_city,
    r.state AS research_state,
    r.pincode AS research_pincode
  INTO v_lead
  FROM leads l
  LEFT JOIN lead_company_research r ON r.lead_id = l.lead_id
  WHERE l.lead_id = p_lead_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_lead.status NOT IN ('Deal', 'Repeat') THEN
    SELECT c.customer_id INTO v_customer_id
    FROM customers c
    WHERE c.source_lead_id = p_lead_id
    LIMIT 1;

    IF v_customer_id IS NULL THEN
      RETURN;
    END IF;

    SELECT EXISTS(SELECT 1 FROM orders o WHERE o.customer_id = v_customer_id) INTO v_has_orders;

    IF v_has_orders THEN
      UPDATE customers
      SET source_lead_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE customer_id = v_customer_id;
    ELSE
      DELETE FROM customers WHERE customer_id = v_customer_id;
    END IF;

    RETURN;
  END IF;

  v_head_office := concat_ws(', ',
    NULLIF(trim(coalesce(v_lead.research_address, '')), ''),
    NULLIF(trim(coalesce(v_lead.research_city, '')), ''),
    NULLIF(trim(coalesce(v_lead.research_state, '')), '')
  );
  v_head_office := NULLIF(v_head_office, '');

  INSERT INTO customers (name, company_name, source_lead_id, email, phone, gst_no, address, type, created_at, updated_at)
  VALUES (
    COALESCE(NULLIF(trim(coalesce(v_lead.name, '')), ''), NULLIF(trim(coalesce(v_lead.company_name, '')), ''), 'Lead Customer'),
    NULLIF(trim(coalesce(v_lead.company_name, '')), ''),
    p_lead_id,
    NULLIF(trim(coalesce(v_lead.email, '')), ''),
    NULLIF(trim(coalesce(v_lead.phone, '')), ''),
    NULLIF(trim(coalesce(v_lead.gst, '')), ''),
    v_head_office,
    'Lead',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (source_lead_id)
  DO UPDATE SET
    name = EXCLUDED.name,
    company_name = EXCLUDED.company_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    gst_no = EXCLUDED.gst_no,
    address = EXCLUDED.address,
    updated_at = CURRENT_TIMESTAMP
  RETURNING customer_id INTO v_customer_id;

  IF v_head_office IS NOT NULL THEN
    UPDATE customer_addresses
    SET concern_person = NULLIF(trim(coalesce(v_lead.name, '')), ''),
        mobile_no = NULLIF(trim(coalesce(v_lead.phone, '')), ''),
        address = v_head_office,
        pincode = NULLIF(trim(coalesce(v_lead.research_pincode, '')), ''),
        updated_at = CURRENT_TIMESTAMP
    WHERE customer_id = v_customer_id
      AND is_head_office = TRUE;

    IF NOT FOUND THEN
      INSERT INTO customer_addresses (
        customer_id,
        concern_person,
        mobile_no,
        address,
        pincode,
        is_head_office,
        created_at,
        updated_at
      ) VALUES (
        v_customer_id,
        NULLIF(trim(coalesce(v_lead.name, '')), ''),
        NULLIF(trim(coalesce(v_lead.phone, '')), ''),
        v_head_office,
        NULLIF(trim(coalesce(v_lead.research_pincode, '')), ''),
        TRUE,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );
    END IF;
  END IF;

  INSERT INTO customer_addresses (
    customer_id,
    concern_person,
    mobile_no,
    address,
    pincode,
    is_head_office,
    source_lead_address_id,
    created_at,
    updated_at
  )
  SELECT
    v_customer_id,
    la.concern_person,
    la.mobile_no,
    la.address,
    la.pincode,
    FALSE,
    la.address_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM lead_addresses la
  WHERE la.lead_id = p_lead_id
  ON CONFLICT (source_lead_address_id)
  DO UPDATE SET
    concern_person = EXCLUDED.concern_person,
    mobile_no = EXCLUDED.mobile_no,
    address = EXCLUDED.address,
    pincode = EXCLUDED.pincode,
    updated_at = CURRENT_TIMESTAMP;

  DELETE FROM customer_addresses ca
  WHERE ca.customer_id = v_customer_id
    AND ca.source_lead_address_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM lead_addresses la
      WHERE la.address_id = ca.source_lead_address_id
        AND la.lead_id = p_lead_id
    );
END;
$$;


ALTER FUNCTION public.sync_customer_from_lead(p_lead_id integer) OWNER TO postgres;

--
-- Name: trigger_sync_customer_from_lead(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trigger_sync_customer_from_lead() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_lead_id INT;
BEGIN
  v_lead_id := COALESCE(NEW.lead_id, OLD.lead_id);
  PERFORM sync_customer_from_lead(v_lead_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.trigger_sync_customer_from_lead() OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


ALTER FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) OWNER TO postgres;

--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


ALTER FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) OWNER TO postgres;

--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


ALTER FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) OWNER TO postgres;

--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
    declare
      res jsonb;
    begin
      execute format('select to_jsonb(%L::'|| type_::text || ')', val)  into res;
      return res;
    end
    $$;


ALTER FUNCTION realtime."cast"(val text, type_ regtype) OWNER TO postgres;

--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


ALTER FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) OWNER TO postgres;

--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


ALTER FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) OWNER TO postgres;

--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS SETOF realtime.wal_rls
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
      with pub as (
        select
          concat_ws(
            ',',
            case when bool_or(pubinsert) then 'insert' else null end,
            case when bool_or(pubupdate) then 'update' else null end,
            case when bool_or(pubdelete) then 'delete' else null end
          ) as w2j_actions,
          coalesce(
            string_agg(
              realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
              ','
            ) filter (where ppt.tablename is not null and ppt.tablename not like '% %'),
            ''
          ) w2j_add_tables
        from
          pg_publication pp
          left join pg_publication_tables ppt
            on pp.pubname = ppt.pubname
        where
          pp.pubname = publication
        group by
          pp.pubname
        limit 1
      ),
      w2j as (
        select
          x.*, pub.w2j_add_tables
        from
          pub,
          pg_logical_slot_get_changes(
            slot_name, null, max_changes,
            'include-pk', 'true',
            'include-transaction', 'false',
            'include-timestamp', 'true',
            'include-type-oids', 'true',
            'format-version', '2',
            'actions', pub.w2j_actions,
            'add-tables', pub.w2j_add_tables
          ) x
      )
      select
        xyz.wal,
        xyz.is_rls_enabled,
        xyz.subscription_ids,
        xyz.errors
      from
        w2j,
        realtime.apply_rls(
          wal := w2j.data::jsonb,
          max_record_bytes := max_record_bytes
        ) xyz(wal, is_rls_enabled, subscription_ids, errors)
      where
        w2j.w2j_add_tables <> ''
        and xyz.subscription_ids[1] is not null
    $$;


ALTER FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) OWNER TO postgres;

--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


ALTER FUNCTION realtime.quote_wal2json(entity regclass) OWNER TO postgres;

--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) OWNER TO postgres;

--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


ALTER FUNCTION realtime.subscription_check_filters() OWNER TO postgres;

--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


ALTER FUNCTION realtime.to_regrole(role_name text) OWNER TO postgres;

--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: postgres
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


ALTER FUNCTION realtime.topic() OWNER TO postgres;

--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) OWNER TO postgres;

--
-- Name: delete_leaf_prefixes(text[], text[]); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_rows_deleted integer;
BEGIN
    LOOP
        WITH candidates AS (
            SELECT DISTINCT
                t.bucket_id,
                unnest(storage.get_prefixes(t.name)) AS name
            FROM unnest(bucket_ids, names) AS t(bucket_id, name)
        ),
        uniq AS (
             SELECT
                 bucket_id,
                 name,
                 storage.get_level(name) AS level
             FROM candidates
             WHERE name <> ''
             GROUP BY bucket_id, name
        ),
        leaf AS (
             SELECT
                 p.bucket_id,
                 p.name,
                 p.level
             FROM storage.prefixes AS p
                  JOIN uniq AS u
                       ON u.bucket_id = p.bucket_id
                           AND u.name = p.name
                           AND u.level = p.level
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM storage.objects AS o
                 WHERE o.bucket_id = p.bucket_id
                   AND o.level = p.level + 1
                   AND o.name COLLATE "C" LIKE p.name || '/%'
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM storage.prefixes AS c
                 WHERE c.bucket_id = p.bucket_id
                   AND c.level = p.level + 1
                   AND c.name COLLATE "C" LIKE p.name || '/%'
             )
        )
        DELETE
        FROM storage.prefixes AS p
            USING leaf AS l
        WHERE p.bucket_id = l.bucket_id
          AND p.name = l.name
          AND p.level = l.level;

        GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
        EXIT WHEN v_rows_deleted = 0;
    END LOOP;
END;
$$;


ALTER FUNCTION storage.delete_leaf_prefixes(bucket_ids text[], names text[]) OWNER TO postgres;

--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION storage.enforce_bucket_name_length() OWNER TO postgres;

--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    SELECT _parts[array_length(_parts,1)] INTO _filename;
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION storage.extension(name text) OWNER TO postgres;

--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


ALTER FUNCTION storage.filename(name text) OWNER TO postgres;

--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION storage.foldername(name text) OWNER TO postgres;

--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


ALTER FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) OWNER TO postgres;

--
-- Name: get_level(text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.get_level(name text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
SELECT array_length(string_to_array("name", '/'), 1);
$$;


ALTER FUNCTION storage.get_level(name text) OWNER TO postgres;

--
-- Name: get_prefix(text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.get_prefix(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $_$
SELECT
    CASE WHEN strpos("name", '/') > 0 THEN
             regexp_replace("name", '[\/]{1}[^\/]+\/?$', '')
         ELSE
             ''
        END;
$_$;


ALTER FUNCTION storage.get_prefix(name text) OWNER TO postgres;

--
-- Name: get_prefixes(text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.get_prefixes(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
DECLARE
    parts text[];
    prefixes text[];
    prefix text;
BEGIN
    -- Split the name into parts by '/'
    parts := string_to_array("name", '/');
    prefixes := '{}';

    -- Construct the prefixes, stopping one level below the last part
    FOR i IN 1..array_length(parts, 1) - 1 LOOP
            prefix := array_to_string(parts[1:i], '/');
            prefixes := array_append(prefixes, prefix);
    END LOOP;

    RETURN prefixes;
END;
$$;


ALTER FUNCTION storage.get_prefixes(name text) OWNER TO postgres;

--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION storage.get_size_by_bucket() OWNER TO postgres;

--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


ALTER FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text) OWNER TO postgres;

--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer, start_after text, next_token text, sort_order text) OWNER TO postgres;

--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION storage.operation() OWNER TO postgres;

--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION storage.protect_delete() OWNER TO postgres;

--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.search(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) OWNER TO postgres;

--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


ALTER FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) OWNER TO postgres;

--
-- Name: search_legacy_v1(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
declare
    v_order_by text;
    v_sort_order text;
begin
    case
        when sortcolumn = 'name' then
            v_order_by = 'name';
        when sortcolumn = 'updated_at' then
            v_order_by = 'updated_at';
        when sortcolumn = 'created_at' then
            v_order_by = 'created_at';
        when sortcolumn = 'last_accessed_at' then
            v_order_by = 'last_accessed_at';
        else
            v_order_by = 'name';
        end case;

    case
        when sortorder = 'asc' then
            v_sort_order = 'asc';
        when sortorder = 'desc' then
            v_sort_order = 'desc';
        else
            v_sort_order = 'asc';
        end case;

    v_order_by = v_order_by || ' ' || v_sort_order;

    return query execute
        'with folders as (
           select path_tokens[$1] as folder
           from storage.objects
             where objects.name ilike $2 || $3 || ''%''
               and bucket_id = $4
               and array_length(objects.path_tokens, 1) <> $1
           group by folder
           order by folder ' || v_sort_order || '
     )
     (select folder as "name",
            null as id,
            null as updated_at,
            null as created_at,
            null as last_accessed_at,
            null as metadata from folders)
     union all
     (select path_tokens[$1] as "name",
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
     from storage.objects
     where objects.name ilike $2 || $3 || ''%''
       and bucket_id = $4
       and array_length(objects.path_tokens, 1) = $1
     order by ' || v_order_by || ')
     limit $5
     offset $6' using levels, prefix, search, bucketname, limits, offsets;
end;
$_$;


ALTER FUNCTION storage.search_legacy_v1(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) OWNER TO postgres;

--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


ALTER FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer, levels integer, start_after text, sort_order text, sort_column text, sort_column_after text) OWNER TO postgres;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: postgres
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION storage.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE auth.audit_log_entries OWNER TO postgres;

--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


ALTER TABLE auth.custom_oauth_providers OWNER TO postgres;

--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


ALTER TABLE auth.flow_state OWNER TO postgres;

--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE auth.identities OWNER TO postgres;

--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


ALTER TABLE auth.instances OWNER TO postgres;

--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


ALTER TABLE auth.mfa_amr_claims OWNER TO postgres;

--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


ALTER TABLE auth.mfa_challenges OWNER TO postgres;

--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


ALTER TABLE auth.mfa_factors OWNER TO postgres;

--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


ALTER TABLE auth.oauth_authorizations OWNER TO postgres;

--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE auth.oauth_client_states OWNER TO postgres;

--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


ALTER TABLE auth.oauth_clients OWNER TO postgres;

--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


ALTER TABLE auth.oauth_consents OWNER TO postgres;

--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


ALTER TABLE auth.one_time_tokens OWNER TO postgres;

--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


ALTER TABLE auth.refresh_tokens OWNER TO postgres;

--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: postgres
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE auth.refresh_tokens_id_seq OWNER TO postgres;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: postgres
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


ALTER TABLE auth.saml_providers OWNER TO postgres;

--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


ALTER TABLE auth.saml_relay_states OWNER TO postgres;

--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


ALTER TABLE auth.schema_migrations OWNER TO postgres;

--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


ALTER TABLE auth.sessions OWNER TO postgres;

--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


ALTER TABLE auth.sso_domains OWNER TO postgres;

--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


ALTER TABLE auth.sso_providers OWNER TO postgres;

--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: postgres
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


ALTER TABLE auth.users OWNER TO postgres;

--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activities (
    activity_id integer NOT NULL,
    ticket_id integer,
    stage_id integer,
    user_id integer,
    action character varying(50) NOT NULL,
    notes text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.activities OWNER TO postgres;

--
-- Name: activities_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.activities_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.activities_activity_id_seq OWNER TO postgres;

--
-- Name: activities_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.activities_activity_id_seq OWNED BY public.activities.activity_id;


--
-- Name: allocation_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.allocation_logs (
    id integer NOT NULL,
    vendor_id integer,
    vendor_name character varying(255),
    serial_number character varying(255) NOT NULL,
    unique_id character varying(255),
    action_taken character varying(128),
    remarks text,
    qc_status character varying(64),
    in_ward character varying(32),
    out_ward character varying(32),
    extra jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id integer,
    customer_id integer,
    customer_name character varying(255),
    challan_id integer,
    product_id integer,
    model_name character varying(255),
    old_serial_number character varying(255),
    po_type character varying(64),
    purchase_type character varying(64),
    locking_period integer,
    added_date timestamp with time zone,
    failure_reason text,
    checked_by integer,
    assigned_to integer,
    warranty_status character varying(128),
    rental_status character varying(128),
    extra_details jsonb DEFAULT '{}'::jsonb,
    require_parts text,
    file_path text,
    log_type character varying(64),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.allocation_logs OWNER TO postgres;

--
-- Name: allocation_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.allocation_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.allocation_logs_id_seq OWNER TO postgres;

--
-- Name: allocation_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.allocation_logs_id_seq OWNED BY public.allocation_logs.id;


--
-- Name: chip_level_repairs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chip_level_repairs (
    repair_id integer NOT NULL,
    ticket_id integer,
    created_by integer,
    updated_by integer,
    status character varying(50) DEFAULT 'in_progress'::character varying,
    issues text[] DEFAULT '{}'::text[],
    issue_notes text,
    parts_required boolean DEFAULT false,
    parts_notes text,
    resolved_checks text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.chip_level_repairs OWNER TO postgres;

--
-- Name: chip_level_repairs_repair_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chip_level_repairs_repair_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chip_level_repairs_repair_id_seq OWNER TO postgres;

--
-- Name: chip_level_repairs_repair_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chip_level_repairs_repair_id_seq OWNED BY public.chip_level_repairs.repair_id;


--
-- Name: customer_addresses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_addresses (
    customer_address_id integer NOT NULL,
    customer_id integer NOT NULL,
    concern_person character varying(255),
    mobile_no character varying(50),
    address text NOT NULL,
    pincode character varying(20),
    is_head_office boolean DEFAULT false,
    source_lead_address_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    address_type character varying(30)
);


ALTER TABLE public.customer_addresses OWNER TO postgres;

--
-- Name: customer_addresses_customer_address_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_addresses_customer_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_addresses_customer_address_id_seq OWNER TO postgres;

--
-- Name: customer_addresses_customer_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_addresses_customer_address_id_seq OWNED BY public.customer_addresses.customer_address_id;


--
-- Name: customer_inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_inventory (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    asset_kind character varying(20) NOT NULL,
    asset_bucket character varying(20) DEFAULT 'live'::character varying NOT NULL,
    delivery_challan_id bigint,
    dc_number character varying(80),
    delivery_date timestamp with time zone,
    erp_serial_id character varying(80),
    serial_number character varying(120),
    unique_serial_number character varying(120),
    model_name character varying(300),
    generation character varying(80),
    screen_size character varying(80),
    ram character varying(120),
    storage character varying(200),
    gpu character varying(200),
    processor character varying(120),
    quotation_type character varying(40),
    rate character varying(80),
    locking_period integer,
    delivery_status character varying(80),
    delivery_type character varying(120),
    courier_name character varying(120),
    awb_number character varying(120),
    sales_status character varying(80),
    documents jsonb,
    erp_raw jsonb,
    synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    passivated_at timestamp with time zone,
    passivated_reason character varying(500)
);


ALTER TABLE public.customer_inventory OWNER TO postgres;

--
-- Name: customer_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_inventory_id_seq OWNER TO postgres;

--
-- Name: customer_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_inventory_id_seq OWNED BY public.customer_inventory.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customers (
    customer_id integer NOT NULL,
    name character varying(255) NOT NULL,
    email character varying(255),
    phone character varying(50),
    gst_no character varying(50),
    type character varying(50) DEFAULT 'New'::character varying,
    details jsonb,
    address text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    company_name character varying(255),
    source_lead_id integer,
    status smallint DEFAULT 1 NOT NULL
);


ALTER TABLE public.customers OWNER TO postgres;

--
-- Name: customers_customer_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customers_customer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_customer_id_seq OWNER TO postgres;

--
-- Name: customers_customer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customers_customer_id_seq OWNED BY public.customers.customer_id;


--
-- Name: delivery_challan_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.delivery_challan_lines (
    id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    sales_order_number character varying(50),
    quotation_number character varying(50),
    customer_id integer,
    customer_name character varying(255),
    email character varying(255),
    gst_number character varying(50),
    supply_state character varying(100),
    security_amount numeric(12,2) DEFAULT 0,
    shiping_charges numeric(12,2) DEFAULT 0,
    branch character varying(50),
    customer_billing_address jsonb,
    customer_shipping_address jsonb,
    brand character varying(100),
    model_name character varying(255),
    quantity integer DEFAULT 1 NOT NULL,
    main_qty integer,
    serial_number jsonb,
    ship_by character varying(20),
    courier_name character varying(255),
    awb_number character varying(100),
    delivery_person_id integer,
    remarks text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    pdf_path text,
    file_path text,
    delivered_serial_numbers jsonb,
    rejected_serial_numbers jsonb,
    pickuped_serial_numbers jsonb,
    submitted_remark text,
    submitted_name character varying(255),
    submitted_person_id integer,
    submitted_person_type character varying(50),
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    d_otp character varying(10),
    d_otp_verified_at timestamp with time zone,
    d_customer_name character varying(255),
    d_customer_email character varying(255),
    d_customer_mobile character varying(50),
    delivery_completed_at timestamp with time zone,
    date_and_time timestamp with time zone,
    latitude character varying(64),
    longitude character varying(64),
    old_rejected_serial_numbers jsonb,
    returned_serial_numbers jsonb,
    CONSTRAINT delivery_challan_lines_ship_by_check CHECK (((ship_by IS NULL) OR ((ship_by)::text = ANY ((ARRAY['by_hand'::character varying, 'by_courier'::character varying])::text[])))),
    CONSTRAINT delivery_challan_lines_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'shipped'::character varying, 'processing'::character varying, 'delivered'::character varying, 'rejected'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.delivery_challan_lines OWNER TO postgres;

--
-- Name: delivery_challan_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.delivery_challan_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.delivery_challan_lines_id_seq OWNER TO postgres;

--
-- Name: delivery_challan_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.delivery_challan_lines_id_seq OWNED BY public.delivery_challan_lines.id;


--
-- Name: delivery_technicians; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.delivery_technicians (
    technician_id integer NOT NULL,
    user_id integer,
    first_name character varying(100) NOT NULL,
    last_name character varying(100),
    phone character varying(50),
    email character varying(255),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    country_code character varying(10) DEFAULT '91'::character varying NOT NULL,
    address text,
    identity_type character varying(50),
    identity_number character varying(100),
    identity_image jsonb DEFAULT '[]'::jsonb NOT NULL,
    image character varying(255),
    password_hash text
);


ALTER TABLE public.delivery_technicians OWNER TO postgres;

--
-- Name: delivery_technicians_technician_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.delivery_technicians_technician_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.delivery_technicians_technician_id_seq OWNER TO postgres;

--
-- Name: delivery_technicians_technician_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.delivery_technicians_technician_id_seq OWNED BY public.delivery_technicians.technician_id;


--
-- Name: diagnosis_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.diagnosis_images (
    image_id integer NOT NULL,
    diagnosis_id integer,
    section_name character varying(100),
    image_path text,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.diagnosis_images OWNER TO postgres;

--
-- Name: diagnosis_images_image_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.diagnosis_images_image_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.diagnosis_images_image_id_seq OWNER TO postgres;

--
-- Name: diagnosis_images_image_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.diagnosis_images_image_id_seq OWNED BY public.diagnosis_images.image_id;


--
-- Name: diagnosis_parts_required; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.diagnosis_parts_required (
    id integer NOT NULL,
    diagnosis_id integer,
    ticket_id integer,
    part_name character varying(255) NOT NULL,
    part_category character varying(100),
    quantity integer DEFAULT 1,
    is_available boolean DEFAULT false,
    inventory_part_id integer,
    status character varying(50) DEFAULT 'Required'::character varying,
    attached_by integer,
    attached_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.diagnosis_parts_required OWNER TO postgres;

--
-- Name: TABLE diagnosis_parts_required; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.diagnosis_parts_required IS 'Tracks parts required after diagnosis, links to inventory/procurement';


--
-- Name: diagnosis_parts_required_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.diagnosis_parts_required_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.diagnosis_parts_required_id_seq OWNER TO postgres;

--
-- Name: diagnosis_parts_required_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.diagnosis_parts_required_id_seq OWNED BY public.diagnosis_parts_required.id;


--
-- Name: diagnosis_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.diagnosis_results (
    diagnosis_id integer NOT NULL,
    ticket_id integer,
    diagnosed_by integer,
    diagnosed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    power_on boolean,
    power_button_working boolean,
    boots_successfully boolean,
    bios_accessible boolean,
    bios_password_lock boolean,
    display_on boolean,
    brightness_control boolean,
    no_flickering boolean,
    no_lines_spots boolean,
    webcam_working boolean,
    all_keys_working boolean,
    touchpad_working boolean,
    left_click_working boolean,
    right_click_working boolean,
    battery_detected boolean,
    battery_charging boolean,
    charging_port_tight boolean,
    battery_swollen boolean,
    storage_detected boolean,
    smart_status_ok boolean,
    no_bad_sectors boolean,
    ram_detected boolean,
    correct_capacity boolean,
    slot_1_working boolean,
    slot_2_working boolean,
    wifi_detected boolean,
    wifi_connecting boolean,
    bluetooth_working boolean,
    usb_ports boolean,
    type_c boolean,
    hdmi boolean,
    audio_jack boolean,
    power_port boolean,
    fan_spinning boolean,
    no_abnormal_noise boolean,
    heating_normal boolean,
    no_short boolean,
    no_rust_liquid boolean,
    no_ic_heating boolean,
    bios_unlocked boolean,
    hdd_unlocked boolean,
    no_mdm_computrace boolean,
    power_issue_flag boolean DEFAULT false,
    display_replacement_required boolean DEFAULT false,
    keyboard_replacement_required boolean DEFAULT false,
    battery_replacement_required boolean DEFAULT false,
    storage_replacement_required boolean DEFAULT false,
    ram_slot_fault boolean DEFAULT false,
    network_card_check boolean DEFAULT false,
    port_repair_required boolean DEFAULT false,
    cleaning_paste_required boolean DEFAULT false,
    chip_level_repair_required boolean DEFAULT false,
    security_hold boolean DEFAULT false,
    total_failures integer DEFAULT 0,
    next_team text,
    remarks text,
    status character varying(50) DEFAULT 'In Progress'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.diagnosis_results OWNER TO postgres;

--
-- Name: TABLE diagnosis_results; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.diagnosis_results IS 'Stores diagnosis checklist results for each ticket';


--
-- Name: diagnosis_results_diagnosis_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.diagnosis_results_diagnosis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.diagnosis_results_diagnosis_id_seq OWNER TO postgres;

--
-- Name: diagnosis_results_diagnosis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.diagnosis_results_diagnosis_id_seq OWNED BY public.diagnosis_results.diagnosis_id;


--
-- Name: email_lead_ingestion_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.email_lead_ingestion_log (
    ingestion_id integer NOT NULL,
    message_id text NOT NULL,
    mailbox character varying(255),
    subject text,
    lead_id integer,
    processed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.email_lead_ingestion_log OWNER TO postgres;

--
-- Name: email_lead_ingestion_log_ingestion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.email_lead_ingestion_log_ingestion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_lead_ingestion_log_ingestion_id_seq OWNER TO postgres;

--
-- Name: email_lead_ingestion_log_ingestion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.email_lead_ingestion_log_ingestion_id_seq OWNED BY public.email_lead_ingestion_log.ingestion_id;


--
-- Name: email_queue; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.email_queue (
    email_id integer NOT NULL,
    to_email character varying(255) NOT NULL,
    subject text NOT NULL,
    body_text text,
    body_html text,
    dedupe_key character varying(255),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    scheduled_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sent_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT email_queue_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('sent'::character varying)::text, ('failed'::character varying)::text])))
);


ALTER TABLE public.email_queue OWNER TO postgres;

--
-- Name: email_queue_email_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.email_queue_email_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_queue_email_id_seq OWNER TO postgres;

--
-- Name: email_queue_email_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.email_queue_email_id_seq OWNED BY public.email_queue.email_id;


--
-- Name: existing_customer; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.existing_customer (
    customer_id integer NOT NULL,
    customer_name character varying(500),
    contact_person_name character varying(300),
    contact_person_number character varying(80),
    customer_number character varying(80),
    email character varying(320),
    billing_address jsonb,
    shipping_address jsonb,
    erp_raw jsonb,
    synced_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.existing_customer OWNER TO postgres;

--
-- Name: inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory (
    inventory_id integer NOT NULL,
    stock_type character varying(50) NOT NULL,
    device_type character varying(50) NOT NULL,
    machine_number character varying(100) NOT NULL,
    serial_number character varying(100) NOT NULL,
    brand character varying(100) NOT NULL,
    model character varying(100) NOT NULL,
    processor character varying(100),
    ram character varying(50),
    storage character varying(50),
    grade character varying(10),
    status character varying(50) DEFAULT 'In Stock'::character varying,
    stage character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    generation character varying(80),
    gpu character varying(120),
    screen_size character varying(40),
    is_dummy boolean DEFAULT false NOT NULL,
    CONSTRAINT inventory_device_type_check CHECK (((device_type)::text = ANY (ARRAY[('Laptop'::character varying)::text, ('Desktop'::character varying)::text]))),
    CONSTRAINT inventory_stock_type_check CHECK (((stock_type)::text = ANY (ARRAY[('Cooling Period'::character varying)::text, ('Ready'::character varying)::text])))
);


ALTER TABLE public.inventory OWNER TO postgres;

--
-- Name: inventory_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventory_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventory_inventory_id_seq OWNER TO postgres;

--
-- Name: inventory_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventory_inventory_id_seq OWNED BY public.inventory.inventory_id;


--
-- Name: inward_outward; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inward_outward (
    id integer NOT NULL,
    serial_number character varying(255),
    unique_number character varying(255),
    product_type character varying(64),
    transaction_type character varying(64),
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.inward_outward OWNER TO postgres;

--
-- Name: inward_outward_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inward_outward_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inward_outward_id_seq OWNER TO postgres;

--
-- Name: inward_outward_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inward_outward_id_seq OWNED BY public.inward_outward.id;


--
-- Name: laptop_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.laptop_catalog (
    catalog_id integer NOT NULL,
    brand character varying(100) NOT NULL,
    model character varying(120),
    processor character varying(120),
    generation character varying(80),
    ram character varying(50),
    storage character varying(50),
    device_type character varying(50) DEFAULT 'Laptop'::character varying,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.laptop_catalog OWNER TO postgres;

--
-- Name: laptop_catalog_catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.laptop_catalog_catalog_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.laptop_catalog_catalog_id_seq OWNER TO postgres;

--
-- Name: laptop_catalog_catalog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.laptop_catalog_catalog_id_seq OWNED BY public.laptop_catalog.catalog_id;


--
-- Name: lead_activities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_activities (
    activity_id integer NOT NULL,
    lead_id integer,
    user_id integer,
    action character varying(50),
    status_from character varying(50),
    status_to character varying(50),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    stage_from character varying(200),
    stage_to character varying(200)
);


ALTER TABLE public.lead_activities OWNER TO postgres;

--
-- Name: lead_activities_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_activities_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_activities_activity_id_seq OWNER TO postgres;

--
-- Name: lead_activities_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_activities_activity_id_seq OWNED BY public.lead_activities.activity_id;


--
-- Name: lead_addresses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_addresses (
    address_id integer NOT NULL,
    lead_id integer NOT NULL,
    concern_person character varying(255),
    mobile_no character varying(50),
    address text NOT NULL,
    pincode character varying(20),
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    address_type character varying(30)
);


ALTER TABLE public.lead_addresses OWNER TO postgres;

--
-- Name: lead_addresses_address_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_addresses_address_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_addresses_address_id_seq OWNER TO postgres;

--
-- Name: lead_addresses_address_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_addresses_address_id_seq OWNED BY public.lead_addresses.address_id;


--
-- Name: lead_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_assignments (
    assignment_id integer NOT NULL,
    lead_id integer,
    assigned_to integer,
    assigned_by integer,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    batch_id uuid
);


ALTER TABLE public.lead_assignments OWNER TO postgres;

--
-- Name: lead_assignments_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_assignments_assignment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_assignments_assignment_id_seq OWNER TO postgres;

--
-- Name: lead_assignments_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_assignments_assignment_id_seq OWNED BY public.lead_assignments.assignment_id;


--
-- Name: lead_auto_assign_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_auto_assign_config (
    id integer NOT NULL,
    user_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    round_robin_index integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by integer
);


ALTER TABLE public.lead_auto_assign_config OWNER TO postgres;

--
-- Name: lead_auto_assign_config_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_auto_assign_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_auto_assign_config_id_seq OWNER TO postgres;

--
-- Name: lead_auto_assign_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_auto_assign_config_id_seq OWNED BY public.lead_auto_assign_config.id;


--
-- Name: lead_company_research; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_company_research (
    research_id integer NOT NULL,
    lead_id integer,
    cin character varying(100),
    entity_type character varying(100),
    roc character varying(100),
    revenue character varying(100),
    employees character varying(100),
    gst character varying(100),
    address text,
    city character varying(100),
    state character varying(100),
    raw_response jsonb,
    researched_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    industry character varying(255),
    pincode character varying(20)
);


ALTER TABLE public.lead_company_research OWNER TO postgres;

--
-- Name: lead_company_research_research_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_company_research_research_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_company_research_research_id_seq OWNER TO postgres;

--
-- Name: lead_company_research_research_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_company_research_research_id_seq OWNED BY public.lead_company_research.research_id;


--
-- Name: lead_followup_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_followup_notifications (
    notification_id integer NOT NULL,
    lead_id integer,
    follow_up_at timestamp with time zone NOT NULL,
    recipient_email character varying(255) NOT NULL,
    channel character varying(20) DEFAULT 'email'::character varying NOT NULL,
    notified_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.lead_followup_notifications OWNER TO postgres;

--
-- Name: lead_followup_notifications_notification_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_followup_notifications_notification_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_followup_notifications_notification_id_seq OWNER TO postgres;

--
-- Name: lead_followup_notifications_notification_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_followup_notifications_notification_id_seq OWNED BY public.lead_followup_notifications.notification_id;


--
-- Name: lead_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_orders (
    lead_order_id integer NOT NULL,
    lead_id integer,
    order_status character varying(50) DEFAULT 'New'::character varying,
    amount numeric(10,2) DEFAULT 0,
    details jsonb,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.lead_orders OWNER TO postgres;

--
-- Name: lead_orders_lead_order_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_orders_lead_order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_orders_lead_order_id_seq OWNER TO postgres;

--
-- Name: lead_orders_lead_order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_orders_lead_order_id_seq OWNED BY public.lead_orders.lead_order_id;


--
-- Name: lead_remarks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_remarks (
    remark_id integer NOT NULL,
    lead_id integer NOT NULL,
    user_id integer,
    note text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.lead_remarks OWNER TO postgres;

--
-- Name: lead_remarks_remark_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_remarks_remark_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_remarks_remark_id_seq OWNER TO postgres;

--
-- Name: lead_remarks_remark_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_remarks_remark_id_seq OWNED BY public.lead_remarks.remark_id;


--
-- Name: leads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leads (
    lead_id integer NOT NULL,
    name character varying(255) NOT NULL,
    company_name character varying(255),
    email character varying(255),
    phone character varying(50),
    source character varying(100),
    status character varying(50) DEFAULT 'Pending'::character varying NOT NULL,
    assigned_user_id integer,
    assigned_by integer,
    assigned_at timestamp with time zone,
    follow_up_date timestamp with time zone,
    is_duplicate boolean DEFAULT false,
    duplicate_of integer,
    rejection_reason text,
    research_status character varying(50) DEFAULT 'pending'::character varying,
    research_requested_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    city character varying(100),
    brand character varying(120),
    processor character varying(100),
    generation character varying(50),
    ram character varying(50),
    storage character varying(100),
    personal_remarks text,
    company_brand character varying(255),
    lead_stage character varying(200),
    quotation_accept_token character varying(64),
    quotation_accepted_at timestamp with time zone,
    quotation_last_sent_at timestamp with time zone,
    quotation_last_estimate_no character varying(50),
    quotation_last_to_email character varying(255),
    CONSTRAINT leads_research_status_check CHECK (((research_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text]))),
    CONSTRAINT leads_status_check CHECK (((status)::text = ANY (ARRAY[('Pending'::character varying)::text, ('Cold'::character varying)::text, ('Warm'::character varying)::text, ('Hot'::character varying)::text, ('Gone'::character varying)::text, ('Hold'::character varying)::text, ('Rejected'::character varying)::text, ('Call Back'::character varying)::text, ('Deal'::character varying)::text, ('Demo'::character varying)::text])))
);


ALTER TABLE public.leads OWNER TO postgres;

--
-- Name: leads_lead_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.leads_lead_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.leads_lead_id_seq OWNER TO postgres;

--
-- Name: leads_lead_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.leads_lead_id_seq OWNED BY public.leads.lead_id;


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_items (
    item_id integer NOT NULL,
    order_id integer,
    brand character varying(100),
    processor character varying(100),
    ram character varying(50),
    storage character varying(50),
    quantity integer DEFAULT 1,
    preferred_model character varying(100),
    status character varying(50) DEFAULT 'New'::character varying,
    inventory_id integer,
    unit_price numeric(14,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    gst_percent numeric(10,2) DEFAULT 18,
    gst_amount numeric(14,2) DEFAULT 0,
    total_with_gst numeric(14,2) DEFAULT 0,
    is_wfh boolean DEFAULT false,
    shipping_charge numeric(14,2) DEFAULT 0,
    estimate_id character varying(120),
    destination_pincode character varying(20),
    tracking_status character varying(30) DEFAULT 'Not Dispatched'::character varying,
    item_tracker_id character varying(120),
    item_courier_partner character varying(120),
    item_dispatch_date date,
    item_estimated_delivery date,
    delivered_at timestamp with time zone,
    delivery_mode character varying(20) DEFAULT 'Office'::character varying,
    customer_address_id integer,
    delivery_contact_name character varying(255),
    delivery_contact_phone character varying(50),
    delivery_address text,
    delivery_pincode character varying(20),
    proposed_delivery_date date,
    generation character varying(80),
    qc_passed boolean DEFAULT false,
    qc_sales_checklist jsonb,
    qc_sales_passed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.order_items OWNER TO postgres;

--
-- Name: order_items_item_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.order_items_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_items_item_id_seq OWNER TO postgres;

--
-- Name: order_items_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.order_items_item_id_seq OWNED BY public.order_items.item_id;


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_status_history (
    history_id integer NOT NULL,
    order_id integer,
    from_status character varying(50),
    to_status character varying(50) NOT NULL,
    changed_by integer,
    notes text,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.order_status_history OWNER TO postgres;

--
-- Name: order_status_history_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.order_status_history_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_status_history_history_id_seq OWNER TO postgres;

--
-- Name: order_status_history_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.order_status_history_history_id_seq OWNED BY public.order_status_history.history_id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    order_id integer NOT NULL,
    customer_id integer,
    lead_type character varying(50),
    status character varying(50) DEFAULT 'New Lead'::character varying,
    owner_user_id integer,
    delivery_date date,
    shipping_address text,
    dispatch_date date,
    tracker_id character varying(100),
    courier_partner character varying(100),
    dispatched_at timestamp with time zone,
    estimated_delivery date,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    order_type character varying(20) DEFAULT 'Sales'::character varying,
    lockin_period_days integer DEFAULT 0,
    security_amount numeric(14,2) DEFAULT 0,
    is_wfh boolean DEFAULT false,
    shipping_charge numeric(14,2) DEFAULT 0,
    shipping_gst_amount numeric(14,2) DEFAULT 0,
    subtotal_amount numeric(14,2) DEFAULT 0,
    items_gst_amount numeric(14,2) DEFAULT 0,
    grand_total_amount numeric(14,2) DEFAULT 0,
    invoice_number character varying(100),
    invoice_generated_at timestamp with time zone,
    eway_bill_number character varying(100),
    eway_bill_generated_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancelled_by integer,
    estimate_id character varying(120),
    customer_type character varying(20) DEFAULT 'New'::character varying,
    qc_received_at timestamp with time zone,
    qc_completed_at timestamp with time zone
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: orders_order_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.orders_order_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.orders_order_id_seq OWNER TO postgres;

--
-- Name: orders_order_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.orders_order_id_seq OWNED BY public.orders.order_id;


--
-- Name: part_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_requests (
    request_id integer NOT NULL,
    ticket_id integer,
    requested_by integer,
    part_name character varying(255) NOT NULL,
    description text,
    status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.part_requests OWNER TO postgres;

--
-- Name: part_requests_request_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.part_requests_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.part_requests_request_id_seq OWNER TO postgres;

--
-- Name: part_requests_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.part_requests_request_id_seq OWNED BY public.part_requests.request_id;


--
-- Name: parts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.parts (
    part_id integer NOT NULL,
    part_name character varying(100) NOT NULL,
    part_type character varying(50),
    quantity integer DEFAULT 0,
    vendor character varying(100),
    cost numeric(10,2),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    location_code character varying(100)
);


ALTER TABLE public.parts OWNER TO postgres;

--
-- Name: parts_part_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.parts_part_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.parts_part_id_seq OWNER TO postgres;

--
-- Name: parts_part_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.parts_part_id_seq OWNED BY public.parts.part_id;


--
-- Name: permission_audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_audit_logs (
    id integer NOT NULL,
    actor_user_id integer,
    target_type character varying(32) NOT NULL,
    target_id character varying(100),
    action character varying(64) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.permission_audit_logs OWNER TO postgres;

--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permission_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permission_audit_logs_id_seq OWNER TO postgres;

--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permission_audit_logs_id_seq OWNED BY public.permission_audit_logs.id;


--
-- Name: permission_sections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_sections (
    id integer NOT NULL,
    section character varying(100) NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.permission_sections OWNER TO postgres;

--
-- Name: permission_sections_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permission_sections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permission_sections_id_seq OWNER TO postgres;

--
-- Name: permission_sections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permission_sections_id_seq OWNED BY public.permission_sections.id;


--
-- Name: photos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.photos (
    photo_id integer NOT NULL,
    ticket_id integer,
    stage_id integer,
    photo_url text NOT NULL,
    photo_type character varying(20),
    uploaded_by integer,
    uploaded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT photos_photo_type_check CHECK (((photo_type)::text = ANY (ARRAY[('before'::character varying)::text, ('after'::character varying)::text, ('issue'::character varying)::text, ('repair'::character varying)::text])))
);


ALTER TABLE public.photos OWNER TO postgres;

--
-- Name: photos_photo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.photos_photo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.photos_photo_id_seq OWNER TO postgres;

--
-- Name: photos_photo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.photos_photo_id_seq OWNED BY public.photos.photo_id;


--
-- Name: procurement_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.procurement_requests (
    request_id integer NOT NULL,
    order_item_id integer,
    status character varying(50) DEFAULT 'New'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.procurement_requests OWNER TO postgres;

--
-- Name: procurement_requests_request_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.procurement_requests_request_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.procurement_requests_request_id_seq OWNER TO postgres;

--
-- Name: procurement_requests_request_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.procurement_requests_request_id_seq OWNED BY public.procurement_requests.request_id;


--
-- Name: vendor_product_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_product_details (
    product_detail_id integer NOT NULL,
    po_id integer,
    category character varying(128),
    brand character varying(255),
    model character varying(255),
    processor character varying(255),
    generation character varying(128),
    ram character varying(64),
    storage character varying(128),
    gpu character varying(128),
    screen_size character varying(64),
    quantity integer DEFAULT 1 NOT NULL,
    rate numeric(18,2) DEFAULT 0 NOT NULL,
    remarks text,
    total_amount numeric(18,2),
    vendor_locking_period integer,
    warranty integer,
    parts integer,
    status character varying(64),
    random_id character varying(64),
    old_product_id integer,
    old_product_details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendor_product_details OWNER TO postgres;

--
-- Name: product_details; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.product_details AS
 SELECT product_detail_id AS id,
    po_id,
    category,
    brand,
    model,
    processor,
    generation,
    ram,
    storage,
    gpu,
    screen_size,
    quantity,
    rate,
    remarks,
    total_amount,
    vendor_locking_period,
    warranty,
    parts,
    status,
    random_id,
    old_product_id,
    old_product_details,
    created_at,
    updated_at
   FROM public.vendor_product_details;


ALTER VIEW public.product_details OWNER TO postgres;

--
-- Name: VIEW product_details; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.product_details IS 'Laravel product_details parity — backed by vendor_product_details';


--
-- Name: qc_photos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qc_photos (
    photo_id integer NOT NULL,
    qc_id integer,
    photo_path text NOT NULL,
    uploaded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.qc_photos OWNER TO postgres;

--
-- Name: TABLE qc_photos; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.qc_photos IS 'Optional photos for QC failures or issues';


--
-- Name: qc_photos_photo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.qc_photos_photo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.qc_photos_photo_id_seq OWNER TO postgres;

--
-- Name: qc_photos_photo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.qc_photos_photo_id_seq OWNED BY public.qc_photos.photo_id;


--
-- Name: qc_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qc_results (
    qc_id integer NOT NULL,
    ticket_id integer,
    qc_stage character varying(10) NOT NULL,
    processor character varying(20),
    generation character varying(20),
    storage_type character varying(50),
    ram_size character varying(20),
    checklist_data jsonb NOT NULL,
    parts_replaced boolean DEFAULT false,
    replaced_parts jsonb,
    qc_result character varying(20),
    failure_reasons text[],
    remarks text,
    final_grade character varying(50),
    grade_notes text,
    tested_by integer,
    checked_by integer,
    qc_date date,
    dispatch_date date,
    is_locked boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    submitted_at timestamp without time zone,
    CONSTRAINT qc_results_qc_stage_check CHECK (((qc_stage)::text = ANY (ARRAY[('QC1'::character varying)::text, ('QC2'::character varying)::text])))
);


ALTER TABLE public.qc_results OWNER TO postgres;

--
-- Name: TABLE qc_results; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.qc_results IS 'QC-1 and QC-2 quality check results with grading';


--
-- Name: qc_results_qc_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.qc_results_qc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.qc_results_qc_id_seq OWNER TO postgres;

--
-- Name: qc_results_qc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.qc_results_qc_id_seq OWNED BY public.qc_results.qc_id;


--
-- Name: qc_round_robin_state; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.qc_round_robin_state (
    team_id integer NOT NULL,
    last_assigned_user_id integer,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.qc_round_robin_state OWNER TO postgres;

--
-- Name: rent_devices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rent_devices (
    id integer NOT NULL,
    serial_id integer NOT NULL,
    po_id integer,
    dc_number character varying(64),
    serial_number character varying(255),
    unique_number character varying(255),
    product_id integer,
    rent_start_date date,
    rent_end_date date,
    rent_amount numeric(12,2),
    month_rent numeric(12,2),
    rent_with_gst numeric(12,2),
    total_amount numeric(12,2),
    vendor_id integer,
    type character varying(64),
    status character varying(64),
    customer_id integer,
    rent_stop_date date,
    rent_start_date_again date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.rent_devices OWNER TO postgres;

--
-- Name: rent_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rent_devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rent_devices_id_seq OWNER TO postgres;

--
-- Name: rent_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rent_devices_id_seq OWNED BY public.rent_devices.id;


--
-- Name: repair_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.repair_logs (
    id integer NOT NULL,
    serial_number_id integer NOT NULL,
    serial_number character varying(255),
    unique_number character varying(255),
    new_serial_number character varying(255),
    new_unique_number character varying(255),
    repair_start_date date,
    repair_end_date date,
    type character varying(64),
    remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.repair_logs OWNER TO postgres;

--
-- Name: repair_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.repair_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.repair_logs_id_seq OWNER TO postgres;

--
-- Name: repair_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.repair_logs_id_seq OWNED BY public.repair_logs.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role character varying(50) NOT NULL,
    section character varying(100) NOT NULL,
    can_view boolean DEFAULT false,
    can_create boolean DEFAULT false,
    can_edit boolean DEFAULT false,
    can_delete boolean DEFAULT false
);


ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_permissions_id_seq OWNER TO postgres;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    description text,
    is_system_role boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: sales_order_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_order_lines (
    id integer NOT NULL,
    sales_order_number character varying(50) NOT NULL,
    quotation_number character varying(50) DEFAULT 'N/A'::character varying NOT NULL,
    customer_id integer,
    customer_name character varying(255),
    customer_email character varying(255),
    customer_mobile character varying(50),
    customer_shipping_address jsonb,
    customer_billing_address jsonb,
    gst_number character varying(50),
    supply_state character varying(100),
    security_amount numeric(12,2) DEFAULT 0,
    shiping_charges numeric(12,2) DEFAULT 0,
    quotation_type character varying(20) DEFAULT 'rental'::character varying,
    branch character varying(50),
    brand character varying(100),
    model_name character varying(255),
    processor character varying(100),
    generation character varying(50),
    ram character varying(50),
    storage character varying(50),
    gpu character varying(100),
    screen_size character varying(50),
    quantity integer DEFAULT 1 NOT NULL,
    main_qty integer DEFAULT 1 NOT NULL,
    rate numeric(12,2) DEFAULT 0 NOT NULL,
    locking_period integer,
    battery_charger_warranty integer,
    technical_warranty integer,
    remark text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    token character varying(64),
    pdf_path text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sales_order_lines OWNER TO postgres;

--
-- Name: sales_order_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sales_order_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_order_lines_id_seq OWNER TO postgres;

--
-- Name: sales_order_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sales_order_lines_id_seq OWNED BY public.sales_order_lines.id;


--
-- Name: sales_quotations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_quotations (
    id integer NOT NULL,
    quotation_number character varying(50) NOT NULL,
    customer_id integer,
    customer_name character varying(255),
    customer_email character varying(255),
    customer_mobile character varying(50),
    customer_shipping_address jsonb,
    customer_billing_address jsonb,
    contact_person_name character varying(255),
    contact_person_mobile character varying(50),
    gst_number character varying(50),
    supply_state character varying(100),
    security_amount numeric(12,2) DEFAULT 0,
    shiping_charges numeric(12,2) DEFAULT 0,
    quotation_type character varying(20) DEFAULT 'rental'::character varying,
    brand character varying(100),
    model_name character varying(255),
    processor character varying(100),
    generation character varying(50),
    ram character varying(50),
    storage character varying(50),
    gpu character varying(100),
    screen_size character varying(50),
    quantity integer DEFAULT 1 NOT NULL,
    main_quantity integer DEFAULT 1 NOT NULL,
    rate numeric(12,2) DEFAULT 0 NOT NULL,
    locking_period integer,
    battery_charger_warranty integer,
    technical_warranty integer,
    remark text,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    token character varying(64),
    pdf_path text,
    status_updated_by_id integer,
    status_updated_by_name character varying(50),
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_quotations_quotation_type_check CHECK (((quotation_type)::text = ANY ((ARRAY['sale'::character varying, 'rental'::character varying, 'demo'::character varying])::text[]))),
    CONSTRAINT sales_quotations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


ALTER TABLE public.sales_quotations OWNER TO postgres;

--
-- Name: sales_quotations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sales_quotations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_quotations_id_seq OWNER TO postgres;

--
-- Name: sales_quotations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sales_quotations_id_seq OWNED BY public.sales_quotations.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_migrations (
    name character varying(255) NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.schema_migrations OWNER TO postgres;

--
-- Name: vendor_serial_numbers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_serial_numbers (
    serial_id integer NOT NULL,
    po_id integer,
    grn_id integer NOT NULL,
    serial_number character varying(255) NOT NULL,
    extra jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    spo_id integer,
    inventory_asset_code character varying(32),
    rental_start_date date,
    qc_status character varying(64),
    inventory_status character varying(64),
    remark text,
    CONSTRAINT vendor_serial_po_or_spo_chk CHECK ((((po_id IS NOT NULL) AND (spo_id IS NULL)) OR ((po_id IS NULL) AND (spo_id IS NOT NULL))))
);


ALTER TABLE public.vendor_serial_numbers OWNER TO postgres;

--
-- Name: serial_number_parts; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.serial_number_parts AS
 SELECT serial_id AS id,
    spo_id AS po_id,
    grn_id AS goods_receipts_id,
    serial_number,
    COALESCE(inventory_asset_code, ((extra ->> 'unique_product_serial'::text))::character varying) AS unique_product_serial,
    COALESCE(NULLIF(TRIM(BOTH FROM qc_status), ''::text), NULLIF(TRIM(BOTH FROM (extra ->> 'status'::text)), ''::text), 'pending'::text) AS status,
    (extra ->> 'main_serial_number'::text) AS main_serial_number,
    (extra ->> 'main_unique_number'::text) AS main_unique_number,
    remark,
    extra,
    created_at,
    updated_at
   FROM public.vendor_serial_numbers s
  WHERE ((deleted_at IS NULL) AND (spo_id IS NOT NULL));


ALTER VIEW public.serial_number_parts OWNER TO postgres;

--
-- Name: VIEW serial_number_parts; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.serial_number_parts IS 'Laravel serial_number_parts parity — vendor_serial_numbers with spo_id';


--
-- Name: serial_numbers; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.serial_numbers AS
 SELECT serial_id AS id,
    po_id,
    grn_id AS goods_receipts_id,
    serial_number,
    COALESCE(inventory_asset_code, ((extra ->> 'unique_product_serial'::text))::character varying) AS unique_product_serial,
    COALESCE(NULLIF(TRIM(BOTH FROM qc_status), ''::text), NULLIF(TRIM(BOTH FROM (extra ->> 'status'::text)), ''::text), 'pending'::text) AS status,
    COALESCE(inventory_status, ((extra ->> 'status2'::text))::character varying) AS status2,
    remark,
    (extra ->> 'product_id'::text) AS product_id,
    (extra ->> 'product_warranty'::text) AS product_warranty,
    rental_start_date AS rental_period,
    (extra ->> 'require_parts'::text) AS require_parts,
    (extra ->> 'file_path'::text) AS file_path,
    (extra ->> 'came_from'::text) AS came_from,
    (extra ->> 'action_status'::text) AS action_status,
    (extra ->> 'action_remark'::text) AS action_remark,
    (extra ->> 'vendor_name'::text) AS vendor_name,
    extra AS extra_json,
    created_at,
    updated_at
   FROM public.vendor_serial_numbers s
  WHERE ((deleted_at IS NULL) AND (po_id IS NOT NULL));


ALTER VIEW public.serial_numbers OWNER TO postgres;

--
-- Name: VIEW serial_numbers; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.serial_numbers IS 'Laravel serial_numbers parity — backed by vendor_serial_numbers';


--
-- Name: sm_courier_details; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sm_courier_details (
    id integer NOT NULL,
    courier_name character varying(255) NOT NULL,
    awb_number character varying(100) NOT NULL,
    dc_number character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sm_courier_details OWNER TO postgres;

--
-- Name: sm_courier_details_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sm_courier_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sm_courier_details_id_seq OWNER TO postgres;

--
-- Name: sm_courier_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sm_courier_details_id_seq OWNED BY public.sm_courier_details.id;


--
-- Name: sm_document_sequences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sm_document_sequences (
    doc_type character varying(20) NOT NULL,
    last_value integer DEFAULT 0 NOT NULL,
    prefix character varying(20) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sm_document_sequences OWNER TO postgres;

--
-- Name: spare_parts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.spare_parts (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    status smallint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.spare_parts OWNER TO postgres;

--
-- Name: spare_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.spare_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.spare_parts_id_seq OWNER TO postgres;

--
-- Name: spare_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.spare_parts_id_seq OWNED BY public.spare_parts.id;


--
-- Name: stage_checklists; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stage_checklists (
    checklist_id integer NOT NULL,
    stage_id integer,
    checklist_items jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.stage_checklists OWNER TO postgres;

--
-- Name: stage_checklists_checklist_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stage_checklists_checklist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stage_checklists_checklist_id_seq OWNER TO postgres;

--
-- Name: stage_checklists_checklist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stage_checklists_checklist_id_seq OWNED BY public.stage_checklists.checklist_id;


--
-- Name: stages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stages (
    stage_id integer NOT NULL,
    stage_name character varying(100) NOT NULL,
    stage_order integer NOT NULL,
    team_id integer,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    stage_category character varying(100)
);


ALTER TABLE public.stages OWNER TO postgres;

--
-- Name: stages_stage_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stages_stage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stages_stage_id_seq OWNER TO postgres;

--
-- Name: stages_stage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stages_stage_id_seq OWNED BY public.stages.stage_id;


--
-- Name: support_issue_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_issue_categories (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.support_issue_categories OWNER TO postgres;

--
-- Name: support_issue_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_issue_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_issue_categories_id_seq OWNER TO postgres;

--
-- Name: support_issue_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_issue_categories_id_seq OWNED BY public.support_issue_categories.id;


--
-- Name: support_replacement_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_replacement_orders (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    item_id integer NOT NULL,
    source_item_id integer,
    old_customer_inventory_id integer,
    new_customer_inventory_id integer,
    old_machine_serial character varying(120),
    new_machine_serial character varying(120),
    status character varying(40) DEFAULT 'placed'::character varying NOT NULL,
    created_by integer,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    dispatched_at timestamp with time zone,
    delivered_at timestamp with time zone,
    inventory_updated_at timestamp with time zone,
    complaint_item_id integer,
    pickup_item_id integer,
    dispatch_method character varying(20),
    courier_name character varying(200),
    awb_number character varying(120),
    delivery_otp_code character varying(6),
    delivery_otp_verified_at timestamp with time zone,
    warehouse_otp_code character varying(6),
    warehouse_otp_verified_at timestamp with time zone,
    flagged_at timestamp with time zone,
    approved_at timestamp with time zone,
    out_for_delivery_at timestamp with time zone,
    pickup_completed_at timestamp with time zone
);


ALTER TABLE public.support_replacement_orders OWNER TO postgres;

--
-- Name: support_replacement_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_replacement_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_replacement_orders_id_seq OWNER TO postgres;

--
-- Name: support_replacement_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_replacement_orders_id_seq OWNED BY public.support_replacement_orders.id;


--
-- Name: support_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_settings (
    key character varying(80) NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.support_settings OWNER TO postgres;

--
-- Name: support_ticket_item_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_ticket_item_audit (
    id integer NOT NULL,
    item_id integer,
    ticket_id integer NOT NULL,
    user_id integer,
    action character varying(80) NOT NULL,
    detail jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.support_ticket_item_audit OWNER TO postgres;

--
-- Name: support_ticket_item_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_ticket_item_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_ticket_item_audit_id_seq OWNER TO postgres;

--
-- Name: support_ticket_item_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_ticket_item_audit_id_seq OWNED BY public.support_ticket_item_audit.id;


--
-- Name: support_ticket_item_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_ticket_item_comments (
    id integer NOT NULL,
    item_id integer NOT NULL,
    user_id integer NOT NULL,
    author_role character varying(40),
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.support_ticket_item_comments OWNER TO postgres;

--
-- Name: support_ticket_item_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_ticket_item_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_ticket_item_comments_id_seq OWNER TO postgres;

--
-- Name: support_ticket_item_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_ticket_item_comments_id_seq OWNED BY public.support_ticket_item_comments.id;


--
-- Name: support_ticket_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_ticket_items (
    id integer NOT NULL,
    ticket_id integer NOT NULL,
    customer_inventory_id integer,
    serial_number character varying(120),
    unique_serial_number character varying(120),
    brand character varying(120),
    model character varying(300),
    ram character varying(120),
    storage character varying(200),
    generation character varying(80),
    item_type character varying(20) NOT NULL,
    issue_category_id integer,
    issue_category_label character varying(120),
    remarks text,
    assigned_to integer,
    status character varying(40) DEFAULT 'open'::character varying NOT NULL,
    otp_code character varying(6),
    otp_verified_at timestamp with time zone,
    pod_image_path text,
    work_done_at timestamp with time zone,
    loan_machine_serial character varying(120),
    loan_delivered_at timestamp with time zone,
    pickup_scheduled_at timestamp with time zone,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    visited_at timestamp with time zone,
    picked_up_at timestamp with time zone,
    replacement_flagged_by integer,
    replacement_flag_reason text,
    replacement_approved_by integer,
    replacement_approved_at timestamp with time zone,
    source_item_id integer,
    current_step character varying(50),
    outcome character varying(30),
    outcome_set_by integer,
    outcome_set_at timestamp with time zone,
    pod_uploaded_at timestamp with time zone,
    warehouse_otp_code character varying(6),
    warehouse_otp_verified_at timestamp with time zone,
    pickup_method character varying(20),
    pickup_assigned_to integer,
    pickup_courier_name character varying(200),
    pickup_awb character varying(120),
    pickup_completed_at timestamp with time zone
);


ALTER TABLE public.support_ticket_items OWNER TO postgres;

--
-- Name: support_ticket_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_ticket_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_ticket_items_id_seq OWNER TO postgres;

--
-- Name: support_ticket_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_ticket_items_id_seq OWNED BY public.support_ticket_items.id;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_tickets (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    customer_name character varying(500),
    customer_phone character varying(80),
    status character varying(40) DEFAULT 'open'::character varying NOT NULL,
    created_by integer,
    closed_by integer,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    last_activity_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    priority character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    top_level_remarks text,
    ticket_phone_override character varying(80),
    ticket_alt_phone character varying(80),
    ticket_email character varying(320),
    ticket_address text,
    created_by_name character varying(300),
    ticket_category character varying(20) DEFAULT 'complaint'::character varying,
    return_dc_number character varying(50),
    complaint_type character varying(50),
    serial_number character varying(120),
    unique_number character varying(120),
    delivery_person_id integer,
    assigned_parts jsonb DEFAULT '[]'::jsonb NOT NULL,
    replaced_parts jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.support_tickets OWNER TO postgres;

--
-- Name: support_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_tickets_id_seq OWNER TO postgres;

--
-- Name: support_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_tickets_id_seq OWNED BY public.support_tickets.id;


--
-- Name: teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teams (
    team_id integer NOT NULL,
    team_name character varying(100) NOT NULL,
    manager_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.teams OWNER TO postgres;

--
-- Name: teams_team_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.teams_team_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.teams_team_id_seq OWNER TO postgres;

--
-- Name: teams_team_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.teams_team_id_seq OWNED BY public.teams.team_id;


--
-- Name: ticket_checklist_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_checklist_progress (
    id integer NOT NULL,
    ticket_id integer,
    stage_id integer,
    checklist_data jsonb NOT NULL,
    completed_by integer,
    completed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ticket_checklist_progress OWNER TO postgres;

--
-- Name: ticket_checklist_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ticket_checklist_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ticket_checklist_progress_id_seq OWNER TO postgres;

--
-- Name: ticket_checklist_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ticket_checklist_progress_id_seq OWNED BY public.ticket_checklist_progress.id;


--
-- Name: ticket_parts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_parts (
    id integer NOT NULL,
    ticket_id integer,
    part_id integer,
    quantity_used integer NOT NULL,
    notes text,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ticket_parts OWNER TO postgres;

--
-- Name: ticket_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ticket_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ticket_parts_id_seq OWNER TO postgres;

--
-- Name: ticket_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ticket_parts_id_seq OWNED BY public.ticket_parts.id;


--
-- Name: ticket_services; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_services (
    service_id integer NOT NULL,
    ticket_id integer,
    service_type character varying(255) NOT NULL,
    cost numeric(10,2) DEFAULT 0 NOT NULL,
    added_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.ticket_services OWNER TO postgres;

--
-- Name: ticket_services_service_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ticket_services_service_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ticket_services_service_id_seq OWNER TO postgres;

--
-- Name: ticket_services_service_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ticket_services_service_id_seq OWNED BY public.ticket_services.service_id;


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tickets (
    ticket_id integer NOT NULL,
    serial_number character varying(100) NOT NULL,
    machine_number character varying(100),
    brand character varying(50),
    model character varying(100),
    processor character varying(100),
    ram character varying(50),
    storage character varying(50),
    status character varying(50) DEFAULT 'in_progress'::character varying,
    priority character varying(20) DEFAULT 'normal'::character varying,
    current_stage_id integer,
    assigned_team_id integer,
    assigned_user_id integer,
    initial_condition text,
    final_grade character varying(10),
    initial_cost numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamp with time zone,
    ttspl_id character varying(100),
    CONSTRAINT tickets_priority_check CHECK (((priority)::text = ANY (ARRAY[('low'::character varying)::text, ('normal'::character varying)::text, ('high'::character varying)::text, ('urgent'::character varying)::text]))),
    CONSTRAINT tickets_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('on_hold'::character varying)::text])))
);


ALTER TABLE public.tickets OWNER TO postgres;

--
-- Name: tickets_ticket_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tickets_ticket_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tickets_ticket_id_seq OWNER TO postgres;

--
-- Name: tickets_ticket_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tickets_ticket_id_seq OWNED BY public.tickets.ticket_id;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_permissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    section character varying(100) NOT NULL,
    can_view boolean,
    can_create boolean,
    can_edit boolean,
    can_delete boolean,
    granted_by integer,
    granted_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.user_permissions OWNER TO postgres;

--
-- Name: user_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_permissions_id_seq OWNER TO postgres;

--
-- Name: user_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_permissions_id_seq OWNED BY public.user_permissions.id;


--
-- Name: user_teams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_teams (
    user_id integer NOT NULL,
    team_id integer NOT NULL
);


ALTER TABLE public.user_teams OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    name character varying(100) NOT NULL,
    email character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    team_id integer,
    active boolean DEFAULT true,
    barcode character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    permissions text[] DEFAULT '{}'::text[],
    mobile_no character varying(50),
    status character varying(20) DEFAULT 'active'::character varying,
    user_type character varying(20) DEFAULT 'internal'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    rejection_reason text,
    company_name character varying(255),
    gst_number character varying(50),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['super_admin'::character varying, 'admin'::character varying, 'manager'::character varying, 'team_member'::character varying, 'team_lead'::character varying, 'sales'::character varying, 'floor_manager'::character varying, 'procurement'::character varying, 'qc'::character varying, 'dispatch'::character varying, 'warehouse'::character varying, 'support_lead'::character varying, 'support_tech'::character varying, 'customer'::character varying, 'vendor'::character varying, 'technician'::character varying])::text[]))),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'pending_approval'::character varying, 'rejected'::character varying, 'blocked'::character varying])::text[]))),
    CONSTRAINT users_user_type_check CHECK (((user_type)::text = ANY ((ARRAY['internal'::character varying, 'customer'::character varying, 'vendor'::character varying, 'technician'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_user_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_user_id_seq OWNER TO postgres;

--
-- Name: users_user_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_user_id_seq OWNED BY public.users.user_id;


--
-- Name: vendor_audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_audit_logs (
    log_id integer NOT NULL,
    actor_user_id integer,
    vendor_id integer,
    entity_type character varying(64) NOT NULL,
    entity_id character varying(64),
    action character varying(64) NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendor_audit_logs OWNER TO postgres;

--
-- Name: vendor_audit_logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_audit_logs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_audit_logs_log_id_seq OWNER TO postgres;

--
-- Name: vendor_audit_logs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_audit_logs_log_id_seq OWNED BY public.vendor_audit_logs.log_id;


--
-- Name: vendor_billing; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_billing (
    billing_id integer NOT NULL,
    vendor_id integer,
    billing_month integer NOT NULL,
    billing_year integer NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    assigned_to_user_id integer,
    totals jsonb DEFAULT '{}'::jsonb,
    detail jsonb DEFAULT '[]'::jsonb,
    file_path text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT vendor_billing_billing_month_check CHECK (((billing_month >= 1) AND (billing_month <= 12)))
);


ALTER TABLE public.vendor_billing OWNER TO postgres;

--
-- Name: vendor_billing_billing_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_billing_billing_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_billing_billing_id_seq OWNER TO postgres;

--
-- Name: vendor_billing_billing_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_billing_billing_id_seq OWNED BY public.vendor_billing.billing_id;


--
-- Name: vendor_goods_received_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_goods_received_notes (
    grn_id integer NOT NULL,
    po_id integer,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    spo_id integer,
    CONSTRAINT vendor_grn_po_or_spo_chk CHECK ((((po_id IS NOT NULL) AND (spo_id IS NULL)) OR ((po_id IS NULL) AND (spo_id IS NOT NULL))))
);


ALTER TABLE public.vendor_goods_received_notes OWNER TO postgres;

--
-- Name: vendor_goods_received_notes_grn_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_goods_received_notes_grn_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_goods_received_notes_grn_id_seq OWNER TO postgres;

--
-- Name: vendor_goods_received_notes_grn_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_goods_received_notes_grn_id_seq OWNED BY public.vendor_goods_received_notes.grn_id;


--
-- Name: vendor_inventory_asset_sequence; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_inventory_asset_sequence (
    id smallint DEFAULT 1 NOT NULL,
    next_num integer DEFAULT 1 NOT NULL,
    CONSTRAINT vendor_inventory_asset_sequence_id_check CHECK ((id = 1))
);


ALTER TABLE public.vendor_inventory_asset_sequence OWNER TO postgres;

--
-- Name: vendor_product_details_product_detail_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_product_details_product_detail_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_product_details_product_detail_id_seq OWNER TO postgres;

--
-- Name: vendor_product_details_product_detail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_product_details_product_detail_id_seq OWNED BY public.vendor_product_details.product_detail_id;


--
-- Name: vendor_product_inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_product_inventory (
    id integer NOT NULL,
    product_id integer,
    serial_id integer NOT NULL,
    serial_number character varying(255) NOT NULL,
    unique_product_serial character varying(255),
    product_model_name character varying(255),
    status character varying(64) DEFAULT 'in_stock'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendor_product_inventory OWNER TO postgres;

--
-- Name: vendor_product_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_product_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_product_inventory_id_seq OWNER TO postgres;

--
-- Name: vendor_product_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_product_inventory_id_seq OWNED BY public.vendor_product_inventory.id;


--
-- Name: vendor_purchase_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_purchase_orders (
    po_id integer NOT NULL,
    purchase_order_number character varying(64) NOT NULL,
    purchase_order_date date NOT NULL,
    purchase_order_type character varying(64) NOT NULL,
    vendor_id integer NOT NULL,
    po_state character varying(128) NOT NULL,
    is_same_state boolean DEFAULT false NOT NULL,
    sub_total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    assets_details jsonb,
    product_details_legacy_ids jsonb,
    remarks text,
    public_token uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying(64) DEFAULT 'draft'::character varying NOT NULL,
    invoice_created boolean DEFAULT false NOT NULL,
    invoice_path text,
    rental_period character varying(128),
    status_updated_by_admin_id integer,
    status_updated_by_name character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    bill_name character varying(255),
    bill_files jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.vendor_purchase_orders OWNER TO postgres;

--
-- Name: vendor_purchase_orders_po_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_purchase_orders_po_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_purchase_orders_po_id_seq OWNER TO postgres;

--
-- Name: vendor_purchase_orders_po_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_purchase_orders_po_id_seq OWNED BY public.vendor_purchase_orders.po_id;


--
-- Name: vendor_refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_refresh_tokens (
    id integer NOT NULL,
    vendor_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendor_refresh_tokens OWNER TO postgres;

--
-- Name: vendor_refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_refresh_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_refresh_tokens_id_seq OWNER TO postgres;

--
-- Name: vendor_refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_refresh_tokens_id_seq OWNED BY public.vendor_refresh_tokens.id;


--
-- Name: vendor_replaced_products; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_replaced_products (
    replaced_id integer NOT NULL,
    vendor_id integer,
    po_id integer,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(64) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.vendor_replaced_products OWNER TO postgres;

--
-- Name: vendor_replaced_products_replaced_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_replaced_products_replaced_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_replaced_products_replaced_id_seq OWNER TO postgres;

--
-- Name: vendor_replaced_products_replaced_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_replaced_products_replaced_id_seq OWNED BY public.vendor_replaced_products.replaced_id;


--
-- Name: vendor_serial_number_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_serial_number_audit (
    audit_id integer NOT NULL,
    po_id integer NOT NULL,
    grn_id integer NOT NULL,
    old_serial character varying(255) NOT NULL,
    new_serial character varying(255) NOT NULL,
    changed_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendor_serial_number_audit OWNER TO postgres;

--
-- Name: vendor_serial_number_audit_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_serial_number_audit_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_serial_number_audit_audit_id_seq OWNER TO postgres;

--
-- Name: vendor_serial_number_audit_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_serial_number_audit_audit_id_seq OWNED BY public.vendor_serial_number_audit.audit_id;


--
-- Name: vendor_serial_numbers_serial_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_serial_numbers_serial_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_serial_numbers_serial_id_seq OWNER TO postgres;

--
-- Name: vendor_serial_numbers_serial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_serial_numbers_serial_id_seq OWNED BY public.vendor_serial_numbers.serial_id;


--
-- Name: vendor_shops; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_shops (
    shop_id integer NOT NULL,
    vendor_id integer NOT NULL,
    name character varying(255) NOT NULL,
    address text,
    contact character varying(32),
    image_url text,
    banner_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.vendor_shops OWNER TO postgres;

--
-- Name: vendor_shops_shop_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_shops_shop_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_shops_shop_id_seq OWNER TO postgres;

--
-- Name: vendor_shops_shop_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_shops_shop_id_seq OWNED BY public.vendor_shops.shop_id;


--
-- Name: vendor_spare_parts_catalog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_spare_parts_catalog (
    part_id integer NOT NULL,
    name character varying(255) NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendor_spare_parts_catalog OWNER TO postgres;

--
-- Name: vendor_spare_parts_catalog_part_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_spare_parts_catalog_part_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_spare_parts_catalog_part_id_seq OWNER TO postgres;

--
-- Name: vendor_spare_parts_catalog_part_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_spare_parts_catalog_part_id_seq OWNED BY public.vendor_spare_parts_catalog.part_id;


--
-- Name: vendor_spare_parts_purchase_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_spare_parts_purchase_orders (
    spo_id integer NOT NULL,
    purchase_order_number character varying(64) NOT NULL,
    purchase_order_date date NOT NULL,
    vendor_id integer NOT NULL,
    po_state character varying(128) NOT NULL,
    is_same_state boolean DEFAULT false NOT NULL,
    sub_total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    assets_details jsonb,
    remarks text,
    public_token uuid DEFAULT gen_random_uuid() NOT NULL,
    status character varying(64) DEFAULT 'draft'::character varying NOT NULL,
    status_updated_by_admin_id integer,
    status_updated_by_name character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    bill_name character varying(255),
    bill_files jsonb DEFAULT '[]'::jsonb NOT NULL
);


ALTER TABLE public.vendor_spare_parts_purchase_orders OWNER TO postgres;

--
-- Name: vendor_spare_parts_purchase_orders_spo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_spare_parts_purchase_orders_spo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_spare_parts_purchase_orders_spo_id_seq OWNER TO postgres;

--
-- Name: vendor_spare_parts_purchase_orders_spo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_spare_parts_purchase_orders_spo_id_seq OWNED BY public.vendor_spare_parts_purchase_orders.spo_id;


--
-- Name: vendor_wallets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_wallets (
    wallet_id integer NOT NULL,
    vendor_id integer NOT NULL,
    withdrawn numeric(18,2) DEFAULT 0 NOT NULL,
    commission_given numeric(18,2) DEFAULT 0 NOT NULL,
    total_earning numeric(18,2) DEFAULT 0 NOT NULL,
    pending_withdraw numeric(18,2) DEFAULT 0 NOT NULL,
    delivery_charge_earned numeric(18,2) DEFAULT 0 NOT NULL,
    collected_cash numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.vendor_wallets OWNER TO postgres;

--
-- Name: vendor_wallets_wallet_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_wallets_wallet_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_wallets_wallet_id_seq OWNER TO postgres;

--
-- Name: vendor_wallets_wallet_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_wallets_wallet_id_seq OWNED BY public.vendor_wallets.wallet_id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendors (
    vendor_id integer NOT NULL,
    status character varying(32) DEFAULT 'approved'::character varying NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255),
    business_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(32) NOT NULL,
    password_hash text NOT NULL,
    address text NOT NULL,
    business_type character varying(255) NOT NULL,
    registration_date date NOT NULL,
    state character varying(128) NOT NULL,
    gst_number character varying(64),
    brand_code character varying(64),
    business_registration_number character varying(128),
    tax_identification_number character varying(128),
    bank_name character varying(255) NOT NULL,
    account_number character varying(64) NOT NULL,
    bank_ifsc_code character varying(32) NOT NULL,
    account_holder_name character varying(255) NOT NULL,
    image_url text,
    licenses_url text,
    remember_pass_plain text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.vendors OWNER TO postgres;

--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendors_vendor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendors_vendor_id_seq OWNER TO postgres;

--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendors_vendor_id_seq OWNED BY public.vendors.vendor_id;


--
-- Name: work_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.work_logs (
    log_id integer NOT NULL,
    ticket_id integer,
    user_id integer,
    stage_id integer,
    start_time timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    end_time timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.work_logs OWNER TO postgres;

--
-- Name: work_logs_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.work_logs_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.work_logs_log_id_seq OWNER TO postgres;

--
-- Name: work_logs_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.work_logs_log_id_seq OWNED BY public.work_logs.log_id;


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: postgres
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
)
PARTITION BY RANGE (inserted_at);


ALTER TABLE realtime.messages OWNER TO postgres;

--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: postgres
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


ALTER TABLE realtime.schema_migrations OWNER TO postgres;

--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: postgres
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


ALTER TABLE realtime.subscription OWNER TO postgres;

--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: postgres
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


ALTER TABLE storage.buckets OWNER TO postgres;

--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: postgres
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE storage.buckets_analytics OWNER TO postgres;

--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.buckets_vectors OWNER TO postgres;

--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE storage.migrations OWNER TO postgres;

--
-- Name: objects; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


ALTER TABLE storage.objects OWNER TO postgres;

--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: postgres
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb
);


ALTER TABLE storage.s3_multipart_uploads OWNER TO postgres;

--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.s3_multipart_uploads_parts OWNER TO postgres;

--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: postgres
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.vector_indexes OWNER TO postgres;

--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: activities activity_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activities ALTER COLUMN activity_id SET DEFAULT nextval('public.activities_activity_id_seq'::regclass);


--
-- Name: allocation_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_logs ALTER COLUMN id SET DEFAULT nextval('public.allocation_logs_id_seq'::regclass);


--
-- Name: chip_level_repairs repair_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chip_level_repairs ALTER COLUMN repair_id SET DEFAULT nextval('public.chip_level_repairs_repair_id_seq'::regclass);


--
-- Name: customer_addresses customer_address_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_addresses ALTER COLUMN customer_address_id SET DEFAULT nextval('public.customer_addresses_customer_address_id_seq'::regclass);


--
-- Name: customer_inventory id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_inventory ALTER COLUMN id SET DEFAULT nextval('public.customer_inventory_id_seq'::regclass);


--
-- Name: customers customer_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers ALTER COLUMN customer_id SET DEFAULT nextval('public.customers_customer_id_seq'::regclass);


--
-- Name: delivery_challan_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines ALTER COLUMN id SET DEFAULT nextval('public.delivery_challan_lines_id_seq'::regclass);


--
-- Name: delivery_technicians technician_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_technicians ALTER COLUMN technician_id SET DEFAULT nextval('public.delivery_technicians_technician_id_seq'::regclass);


--
-- Name: diagnosis_images image_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_images ALTER COLUMN image_id SET DEFAULT nextval('public.diagnosis_images_image_id_seq'::regclass);


--
-- Name: diagnosis_parts_required id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_parts_required ALTER COLUMN id SET DEFAULT nextval('public.diagnosis_parts_required_id_seq'::regclass);


--
-- Name: diagnosis_results diagnosis_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_results ALTER COLUMN diagnosis_id SET DEFAULT nextval('public.diagnosis_results_diagnosis_id_seq'::regclass);


--
-- Name: email_lead_ingestion_log ingestion_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_lead_ingestion_log ALTER COLUMN ingestion_id SET DEFAULT nextval('public.email_lead_ingestion_log_ingestion_id_seq'::regclass);


--
-- Name: email_queue email_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_queue ALTER COLUMN email_id SET DEFAULT nextval('public.email_queue_email_id_seq'::regclass);


--
-- Name: inventory inventory_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory ALTER COLUMN inventory_id SET DEFAULT nextval('public.inventory_inventory_id_seq'::regclass);


--
-- Name: inward_outward id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inward_outward ALTER COLUMN id SET DEFAULT nextval('public.inward_outward_id_seq'::regclass);


--
-- Name: laptop_catalog catalog_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.laptop_catalog ALTER COLUMN catalog_id SET DEFAULT nextval('public.laptop_catalog_catalog_id_seq'::regclass);


--
-- Name: lead_activities activity_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_activities ALTER COLUMN activity_id SET DEFAULT nextval('public.lead_activities_activity_id_seq'::regclass);


--
-- Name: lead_addresses address_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_addresses ALTER COLUMN address_id SET DEFAULT nextval('public.lead_addresses_address_id_seq'::regclass);


--
-- Name: lead_assignments assignment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_assignments ALTER COLUMN assignment_id SET DEFAULT nextval('public.lead_assignments_assignment_id_seq'::regclass);


--
-- Name: lead_auto_assign_config id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_auto_assign_config ALTER COLUMN id SET DEFAULT nextval('public.lead_auto_assign_config_id_seq'::regclass);


--
-- Name: lead_company_research research_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_company_research ALTER COLUMN research_id SET DEFAULT nextval('public.lead_company_research_research_id_seq'::regclass);


--
-- Name: lead_followup_notifications notification_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_followup_notifications ALTER COLUMN notification_id SET DEFAULT nextval('public.lead_followup_notifications_notification_id_seq'::regclass);


--
-- Name: lead_orders lead_order_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_orders ALTER COLUMN lead_order_id SET DEFAULT nextval('public.lead_orders_lead_order_id_seq'::regclass);


--
-- Name: lead_remarks remark_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_remarks ALTER COLUMN remark_id SET DEFAULT nextval('public.lead_remarks_remark_id_seq'::regclass);


--
-- Name: leads lead_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads ALTER COLUMN lead_id SET DEFAULT nextval('public.leads_lead_id_seq'::regclass);


--
-- Name: order_items item_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items ALTER COLUMN item_id SET DEFAULT nextval('public.order_items_item_id_seq'::regclass);


--
-- Name: order_status_history history_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_status_history ALTER COLUMN history_id SET DEFAULT nextval('public.order_status_history_history_id_seq'::regclass);


--
-- Name: orders order_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders ALTER COLUMN order_id SET DEFAULT nextval('public.orders_order_id_seq'::regclass);


--
-- Name: part_requests request_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests ALTER COLUMN request_id SET DEFAULT nextval('public.part_requests_request_id_seq'::regclass);


--
-- Name: parts part_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parts ALTER COLUMN part_id SET DEFAULT nextval('public.parts_part_id_seq'::regclass);


--
-- Name: permission_audit_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.permission_audit_logs_id_seq'::regclass);


--
-- Name: permission_sections id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_sections ALTER COLUMN id SET DEFAULT nextval('public.permission_sections_id_seq'::regclass);


--
-- Name: photos photo_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photos ALTER COLUMN photo_id SET DEFAULT nextval('public.photos_photo_id_seq'::regclass);


--
-- Name: procurement_requests request_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.procurement_requests ALTER COLUMN request_id SET DEFAULT nextval('public.procurement_requests_request_id_seq'::regclass);


--
-- Name: qc_photos photo_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_photos ALTER COLUMN photo_id SET DEFAULT nextval('public.qc_photos_photo_id_seq'::regclass);


--
-- Name: qc_results qc_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_results ALTER COLUMN qc_id SET DEFAULT nextval('public.qc_results_qc_id_seq'::regclass);


--
-- Name: rent_devices id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rent_devices ALTER COLUMN id SET DEFAULT nextval('public.rent_devices_id_seq'::regclass);


--
-- Name: repair_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repair_logs ALTER COLUMN id SET DEFAULT nextval('public.repair_logs_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: sales_order_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_lines ALTER COLUMN id SET DEFAULT nextval('public.sales_order_lines_id_seq'::regclass);


--
-- Name: sales_quotations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_quotations ALTER COLUMN id SET DEFAULT nextval('public.sales_quotations_id_seq'::regclass);


--
-- Name: sm_courier_details id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sm_courier_details ALTER COLUMN id SET DEFAULT nextval('public.sm_courier_details_id_seq'::regclass);


--
-- Name: spare_parts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spare_parts ALTER COLUMN id SET DEFAULT nextval('public.spare_parts_id_seq'::regclass);


--
-- Name: stage_checklists checklist_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_checklists ALTER COLUMN checklist_id SET DEFAULT nextval('public.stage_checklists_checklist_id_seq'::regclass);


--
-- Name: stages stage_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stages ALTER COLUMN stage_id SET DEFAULT nextval('public.stages_stage_id_seq'::regclass);


--
-- Name: support_issue_categories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_issue_categories ALTER COLUMN id SET DEFAULT nextval('public.support_issue_categories_id_seq'::regclass);


--
-- Name: support_replacement_orders id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders ALTER COLUMN id SET DEFAULT nextval('public.support_replacement_orders_id_seq'::regclass);


--
-- Name: support_ticket_item_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_audit ALTER COLUMN id SET DEFAULT nextval('public.support_ticket_item_audit_id_seq'::regclass);


--
-- Name: support_ticket_item_comments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_comments ALTER COLUMN id SET DEFAULT nextval('public.support_ticket_item_comments_id_seq'::regclass);


--
-- Name: support_ticket_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items ALTER COLUMN id SET DEFAULT nextval('public.support_ticket_items_id_seq'::regclass);


--
-- Name: support_tickets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets ALTER COLUMN id SET DEFAULT nextval('public.support_tickets_id_seq'::regclass);


--
-- Name: teams team_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams ALTER COLUMN team_id SET DEFAULT nextval('public.teams_team_id_seq'::regclass);


--
-- Name: ticket_checklist_progress id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_checklist_progress ALTER COLUMN id SET DEFAULT nextval('public.ticket_checklist_progress_id_seq'::regclass);


--
-- Name: ticket_parts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_parts ALTER COLUMN id SET DEFAULT nextval('public.ticket_parts_id_seq'::regclass);


--
-- Name: ticket_services service_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_services ALTER COLUMN service_id SET DEFAULT nextval('public.ticket_services_service_id_seq'::regclass);


--
-- Name: tickets ticket_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets ALTER COLUMN ticket_id SET DEFAULT nextval('public.tickets_ticket_id_seq'::regclass);


--
-- Name: user_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_permissions_id_seq'::regclass);


--
-- Name: users user_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN user_id SET DEFAULT nextval('public.users_user_id_seq'::regclass);


--
-- Name: vendor_audit_logs log_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_audit_logs ALTER COLUMN log_id SET DEFAULT nextval('public.vendor_audit_logs_log_id_seq'::regclass);


--
-- Name: vendor_billing billing_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_billing ALTER COLUMN billing_id SET DEFAULT nextval('public.vendor_billing_billing_id_seq'::regclass);


--
-- Name: vendor_goods_received_notes grn_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_goods_received_notes ALTER COLUMN grn_id SET DEFAULT nextval('public.vendor_goods_received_notes_grn_id_seq'::regclass);


--
-- Name: vendor_product_details product_detail_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_product_details ALTER COLUMN product_detail_id SET DEFAULT nextval('public.vendor_product_details_product_detail_id_seq'::regclass);


--
-- Name: vendor_product_inventory id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_product_inventory ALTER COLUMN id SET DEFAULT nextval('public.vendor_product_inventory_id_seq'::regclass);


--
-- Name: vendor_purchase_orders po_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_purchase_orders ALTER COLUMN po_id SET DEFAULT nextval('public.vendor_purchase_orders_po_id_seq'::regclass);


--
-- Name: vendor_refresh_tokens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.vendor_refresh_tokens_id_seq'::regclass);


--
-- Name: vendor_replaced_products replaced_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_replaced_products ALTER COLUMN replaced_id SET DEFAULT nextval('public.vendor_replaced_products_replaced_id_seq'::regclass);


--
-- Name: vendor_serial_number_audit audit_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_number_audit ALTER COLUMN audit_id SET DEFAULT nextval('public.vendor_serial_number_audit_audit_id_seq'::regclass);


--
-- Name: vendor_serial_numbers serial_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_numbers ALTER COLUMN serial_id SET DEFAULT nextval('public.vendor_serial_numbers_serial_id_seq'::regclass);


--
-- Name: vendor_shops shop_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_shops ALTER COLUMN shop_id SET DEFAULT nextval('public.vendor_shops_shop_id_seq'::regclass);


--
-- Name: vendor_spare_parts_catalog part_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_spare_parts_catalog ALTER COLUMN part_id SET DEFAULT nextval('public.vendor_spare_parts_catalog_part_id_seq'::regclass);


--
-- Name: vendor_spare_parts_purchase_orders spo_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders ALTER COLUMN spo_id SET DEFAULT nextval('public.vendor_spare_parts_purchase_orders_spo_id_seq'::regclass);


--
-- Name: vendor_wallets wallet_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_wallets ALTER COLUMN wallet_id SET DEFAULT nextval('public.vendor_wallets_wallet_id_seq'::regclass);


--
-- Name: vendors vendor_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendors ALTER COLUMN vendor_id SET DEFAULT nextval('public.vendors_vendor_id_seq'::regclass);


--
-- Name: work_logs log_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_logs ALTER COLUMN log_id SET DEFAULT nextval('public.work_logs_log_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (activity_id);


--
-- Name: allocation_logs allocation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.allocation_logs
    ADD CONSTRAINT allocation_logs_pkey PRIMARY KEY (id);


--
-- Name: chip_level_repairs chip_level_repairs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_pkey PRIMARY KEY (repair_id);


--
-- Name: chip_level_repairs chip_level_repairs_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_ticket_id_key UNIQUE (ticket_id);


--
-- Name: customer_addresses customer_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_pkey PRIMARY KEY (customer_address_id);


--
-- Name: customer_addresses customer_addresses_source_lead_address_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_source_lead_address_id_key UNIQUE (source_lead_address_id);


--
-- Name: customer_inventory customer_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_inventory
    ADD CONSTRAINT customer_inventory_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (customer_id);


--
-- Name: customers customers_source_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_source_lead_id_key UNIQUE (source_lead_id);


--
-- Name: delivery_challan_lines delivery_challan_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_pkey PRIMARY KEY (id);


--
-- Name: delivery_technicians delivery_technicians_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_technicians
    ADD CONSTRAINT delivery_technicians_pkey PRIMARY KEY (technician_id);


--
-- Name: diagnosis_images diagnosis_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_images
    ADD CONSTRAINT diagnosis_images_pkey PRIMARY KEY (image_id);


--
-- Name: diagnosis_parts_required diagnosis_parts_required_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_pkey PRIMARY KEY (id);


--
-- Name: diagnosis_results diagnosis_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_pkey PRIMARY KEY (diagnosis_id);


--
-- Name: diagnosis_results diagnosis_results_ticket_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_ticket_id_key UNIQUE (ticket_id);


--
-- Name: email_lead_ingestion_log email_lead_ingestion_log_message_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_lead_ingestion_log
    ADD CONSTRAINT email_lead_ingestion_log_message_id_key UNIQUE (message_id);


--
-- Name: email_lead_ingestion_log email_lead_ingestion_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_lead_ingestion_log
    ADD CONSTRAINT email_lead_ingestion_log_pkey PRIMARY KEY (ingestion_id);


--
-- Name: email_queue email_queue_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: email_queue email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (email_id);


--
-- Name: existing_customer existing_customer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.existing_customer
    ADD CONSTRAINT existing_customer_pkey PRIMARY KEY (customer_id);


--
-- Name: inventory inventory_machine_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_machine_number_key UNIQUE (machine_number);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (inventory_id);


--
-- Name: inventory inventory_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_serial_number_key UNIQUE (serial_number);


--
-- Name: inward_outward inward_outward_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inward_outward
    ADD CONSTRAINT inward_outward_pkey PRIMARY KEY (id);


--
-- Name: laptop_catalog laptop_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.laptop_catalog
    ADD CONSTRAINT laptop_catalog_pkey PRIMARY KEY (catalog_id);


--
-- Name: lead_activities lead_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (activity_id);


--
-- Name: lead_addresses lead_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_addresses
    ADD CONSTRAINT lead_addresses_pkey PRIMARY KEY (address_id);


--
-- Name: lead_assignments lead_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_pkey PRIMARY KEY (assignment_id);


--
-- Name: lead_auto_assign_config lead_auto_assign_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_auto_assign_config
    ADD CONSTRAINT lead_auto_assign_config_pkey PRIMARY KEY (id);


--
-- Name: lead_company_research lead_company_research_lead_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_company_research
    ADD CONSTRAINT lead_company_research_lead_id_key UNIQUE (lead_id);


--
-- Name: lead_company_research lead_company_research_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_company_research
    ADD CONSTRAINT lead_company_research_pkey PRIMARY KEY (research_id);


--
-- Name: lead_followup_notifications lead_followup_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_followup_notifications
    ADD CONSTRAINT lead_followup_notifications_pkey PRIMARY KEY (notification_id);


--
-- Name: lead_orders lead_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_orders
    ADD CONSTRAINT lead_orders_pkey PRIMARY KEY (lead_order_id);


--
-- Name: lead_remarks lead_remarks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_remarks
    ADD CONSTRAINT lead_remarks_pkey PRIMARY KEY (remark_id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (lead_id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (item_id);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (history_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


--
-- Name: part_requests part_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_pkey PRIMARY KEY (request_id);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (part_id);


--
-- Name: permission_audit_logs permission_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: permission_sections permission_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_sections
    ADD CONSTRAINT permission_sections_pkey PRIMARY KEY (id);


--
-- Name: permission_sections permission_sections_section_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_sections
    ADD CONSTRAINT permission_sections_section_key UNIQUE (section);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (photo_id);


--
-- Name: procurement_requests procurement_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_pkey PRIMARY KEY (request_id);


--
-- Name: qc_photos qc_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_photos
    ADD CONSTRAINT qc_photos_pkey PRIMARY KEY (photo_id);


--
-- Name: qc_results qc_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_pkey PRIMARY KEY (qc_id);


--
-- Name: qc_round_robin_state qc_round_robin_state_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_round_robin_state
    ADD CONSTRAINT qc_round_robin_state_pkey PRIMARY KEY (team_id);


--
-- Name: rent_devices rent_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rent_devices
    ADD CONSTRAINT rent_devices_pkey PRIMARY KEY (id);


--
-- Name: repair_logs repair_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.repair_logs
    ADD CONSTRAINT repair_logs_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_section_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_section_key UNIQUE (role, section);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sales_order_lines sales_order_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_pkey PRIMARY KEY (id);


--
-- Name: sales_quotations sales_quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: sm_courier_details sm_courier_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sm_courier_details
    ADD CONSTRAINT sm_courier_details_pkey PRIMARY KEY (id);


--
-- Name: sm_document_sequences sm_document_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sm_document_sequences
    ADD CONSTRAINT sm_document_sequences_pkey PRIMARY KEY (doc_type);


--
-- Name: spare_parts spare_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.spare_parts
    ADD CONSTRAINT spare_parts_pkey PRIMARY KEY (id);


--
-- Name: stage_checklists stage_checklists_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_checklists
    ADD CONSTRAINT stage_checklists_pkey PRIMARY KEY (checklist_id);


--
-- Name: stages stages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stages
    ADD CONSTRAINT stages_pkey PRIMARY KEY (stage_id);


--
-- Name: support_issue_categories support_issue_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_issue_categories
    ADD CONSTRAINT support_issue_categories_name_key UNIQUE (name);


--
-- Name: support_issue_categories support_issue_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_issue_categories
    ADD CONSTRAINT support_issue_categories_pkey PRIMARY KEY (id);


--
-- Name: support_replacement_orders support_replacement_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_pkey PRIMARY KEY (id);


--
-- Name: support_settings support_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_settings
    ADD CONSTRAINT support_settings_pkey PRIMARY KEY (key);


--
-- Name: support_ticket_item_audit support_ticket_item_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_item_comments support_ticket_item_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_comments
    ADD CONSTRAINT support_ticket_item_comments_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_items support_ticket_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (team_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_pkey PRIMARY KEY (id);


--
-- Name: ticket_parts ticket_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_parts
    ADD CONSTRAINT ticket_parts_pkey PRIMARY KEY (id);


--
-- Name: ticket_services ticket_services_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_services
    ADD CONSTRAINT ticket_services_pkey PRIMARY KEY (service_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (ticket_id);


--
-- Name: lead_followup_notifications unique_lead_followup_email_notification; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_followup_notifications
    ADD CONSTRAINT unique_lead_followup_email_notification UNIQUE (lead_id, follow_up_at, recipient_email, channel);


--
-- Name: qc_results unique_ticket_qc_stage; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT unique_ticket_qc_stage UNIQUE (ticket_id, qc_stage);


--
-- Name: laptop_catalog uq_laptop_catalog; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.laptop_catalog
    ADD CONSTRAINT uq_laptop_catalog UNIQUE (brand, model, processor, generation, ram, storage, device_type);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_user_id_section_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_section_key UNIQUE (user_id, section);


--
-- Name: user_teams user_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_pkey PRIMARY KEY (user_id, team_id);


--
-- Name: users users_barcode_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_barcode_key UNIQUE (barcode);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: vendor_audit_logs vendor_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_audit_logs
    ADD CONSTRAINT vendor_audit_logs_pkey PRIMARY KEY (log_id);


--
-- Name: vendor_billing vendor_billing_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_billing
    ADD CONSTRAINT vendor_billing_pkey PRIMARY KEY (billing_id);


--
-- Name: vendor_goods_received_notes vendor_goods_received_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_goods_received_notes
    ADD CONSTRAINT vendor_goods_received_notes_pkey PRIMARY KEY (grn_id);


--
-- Name: vendor_inventory_asset_sequence vendor_inventory_asset_sequence_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_inventory_asset_sequence
    ADD CONSTRAINT vendor_inventory_asset_sequence_pkey PRIMARY KEY (id);


--
-- Name: vendor_product_details vendor_product_details_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_product_details
    ADD CONSTRAINT vendor_product_details_pkey PRIMARY KEY (product_detail_id);


--
-- Name: vendor_product_inventory vendor_product_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_product_inventory
    ADD CONSTRAINT vendor_product_inventory_pkey PRIMARY KEY (id);


--
-- Name: vendor_purchase_orders vendor_purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_pkey PRIMARY KEY (po_id);


--
-- Name: vendor_purchase_orders vendor_purchase_orders_purchase_order_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_purchase_order_number_key UNIQUE (purchase_order_number);


--
-- Name: vendor_refresh_tokens vendor_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_refresh_tokens
    ADD CONSTRAINT vendor_refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: vendor_replaced_products vendor_replaced_products_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_replaced_products
    ADD CONSTRAINT vendor_replaced_products_pkey PRIMARY KEY (replaced_id);


--
-- Name: vendor_serial_number_audit vendor_serial_number_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_number_audit
    ADD CONSTRAINT vendor_serial_number_audit_pkey PRIMARY KEY (audit_id);


--
-- Name: vendor_serial_numbers vendor_serial_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_pkey PRIMARY KEY (serial_id);


--
-- Name: vendor_shops vendor_shops_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_shops
    ADD CONSTRAINT vendor_shops_pkey PRIMARY KEY (shop_id);


--
-- Name: vendor_spare_parts_catalog vendor_spare_parts_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_spare_parts_catalog
    ADD CONSTRAINT vendor_spare_parts_catalog_pkey PRIMARY KEY (part_id);


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_orders_pkey PRIMARY KEY (spo_id);


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_orders_purchase_order_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_orders_purchase_order_number_key UNIQUE (purchase_order_number);


--
-- Name: vendor_wallets vendor_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_wallets
    ADD CONSTRAINT vendor_wallets_pkey PRIMARY KEY (wallet_id);


--
-- Name: vendor_wallets vendor_wallets_vendor_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_wallets
    ADD CONSTRAINT vendor_wallets_vendor_id_key UNIQUE (vendor_id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (vendor_id);


--
-- Name: work_logs work_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_pkey PRIMARY KEY (log_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: postgres
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: postgres
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: postgres
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: postgres
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: postgres
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: idx_activities_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_activities_ticket ON public.activities USING btree (ticket_id);


--
-- Name: idx_allocation_logs_product; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_allocation_logs_product ON public.allocation_logs USING btree (product_id);


--
-- Name: idx_allocation_logs_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_allocation_logs_serial ON public.allocation_logs USING btree (serial_number);


--
-- Name: idx_allocation_logs_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_allocation_logs_vendor ON public.allocation_logs USING btree (vendor_id);


--
-- Name: idx_customer_addresses_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_addresses_customer_id ON public.customer_addresses USING btree (customer_id);


--
-- Name: idx_customer_inventory_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_inventory_customer ON public.customer_inventory USING btree (customer_id);


--
-- Name: idx_customer_inventory_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_inventory_serial ON public.customer_inventory USING btree (serial_number);


--
-- Name: idx_customer_inventory_unique_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_inventory_unique_serial ON public.customer_inventory USING btree (unique_serial_number);


--
-- Name: idx_customers_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_status ON public.customers USING btree (status);


--
-- Name: idx_customers_updated_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_updated_at ON public.customers USING btree (updated_at DESC);


--
-- Name: idx_delivery_challan_lines_dc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_challan_lines_dc ON public.delivery_challan_lines USING btree (dc_number);


--
-- Name: idx_delivery_challan_lines_delivery_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_challan_lines_delivery_person ON public.delivery_challan_lines USING btree (delivery_person_id);


--
-- Name: idx_delivery_challan_lines_so; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_challan_lines_so ON public.delivery_challan_lines USING btree (sales_order_number);


--
-- Name: idx_delivery_challan_lines_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_challan_lines_status ON public.delivery_challan_lines USING btree (status);


--
-- Name: idx_delivery_technicians_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_delivery_technicians_active ON public.delivery_technicians USING btree (is_active);


--
-- Name: idx_delivery_technicians_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_delivery_technicians_email ON public.delivery_technicians USING btree (lower((email)::text)) WHERE (email IS NOT NULL);


--
-- Name: idx_delivery_technicians_phone_country; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_delivery_technicians_phone_country ON public.delivery_technicians USING btree (country_code, phone) WHERE ((phone IS NOT NULL) AND ((phone)::text <> ''::text));


--
-- Name: idx_diagnosis_parts_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_diagnosis_parts_status ON public.diagnosis_parts_required USING btree (status);


--
-- Name: idx_diagnosis_parts_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_diagnosis_parts_ticket ON public.diagnosis_parts_required USING btree (ticket_id);


--
-- Name: idx_diagnosis_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_diagnosis_ticket ON public.diagnosis_results USING btree (ticket_id);


--
-- Name: idx_email_lead_ingestion_processed; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_email_lead_ingestion_processed ON public.email_lead_ingestion_log USING btree (processed_at DESC);


--
-- Name: idx_email_queue_status_schedule; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_email_queue_status_schedule ON public.email_queue USING btree (status, scheduled_at);


--
-- Name: idx_existing_customer_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_existing_customer_email ON public.existing_customer USING btree (lower((email)::text));


--
-- Name: idx_existing_customer_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_existing_customer_name ON public.existing_customer USING btree (lower((customer_name)::text));


--
-- Name: idx_inventory_is_dummy; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_is_dummy ON public.inventory USING btree (is_dummy) WHERE (is_dummy = true);


--
-- Name: idx_inventory_machine; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_machine ON public.inventory USING btree (machine_number);


--
-- Name: idx_inventory_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_serial ON public.inventory USING btree (serial_number);


--
-- Name: idx_inward_outward_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inward_outward_serial ON public.inward_outward USING btree (serial_number);


--
-- Name: idx_lead_addresses_lead_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lead_addresses_lead_id ON public.lead_addresses USING btree (lead_id);


--
-- Name: idx_lead_followup_notifications_lead; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lead_followup_notifications_lead ON public.lead_followup_notifications USING btree (lead_id);


--
-- Name: idx_lead_orders_lead_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lead_orders_lead_id ON public.lead_orders USING btree (lead_id);


--
-- Name: idx_lead_remarks_lead; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lead_remarks_lead ON public.lead_remarks USING btree (lead_id);


--
-- Name: idx_leads_assigned; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leads_assigned ON public.leads USING btree (assigned_user_id);


--
-- Name: idx_leads_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leads_email ON public.leads USING btree (email);


--
-- Name: idx_leads_follow_up; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leads_follow_up ON public.leads USING btree (follow_up_date);


--
-- Name: idx_leads_phone; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leads_phone ON public.leads USING btree (phone);


--
-- Name: idx_leads_quotation_accept_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leads_quotation_accept_token ON public.leads USING btree (quotation_accept_token) WHERE (quotation_accept_token IS NOT NULL);


--
-- Name: idx_leads_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_leads_status ON public.leads USING btree (status);


--
-- Name: idx_order_items_customer_address_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_customer_address_id ON public.order_items USING btree (customer_address_id);


--
-- Name: idx_order_items_destination; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_destination ON public.order_items USING btree (order_id, destination_pincode);


--
-- Name: idx_order_items_qc_passed; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_qc_passed ON public.order_items USING btree (order_id, qc_passed);


--
-- Name: idx_order_items_tracking_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_items_tracking_status ON public.order_items USING btree (order_id, tracking_status);


--
-- Name: idx_order_status_history_order; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_status_history_order ON public.order_status_history USING btree (order_id);


--
-- Name: idx_order_status_history_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_status_history_order_id ON public.order_status_history USING btree (order_id);


--
-- Name: idx_orders_status_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_status_created ON public.orders USING btree (status, created_at DESC);


--
-- Name: idx_permission_audit_logs_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_permission_audit_logs_created ON public.permission_audit_logs USING btree (created_at DESC);


--
-- Name: idx_permission_audit_logs_target; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_permission_audit_logs_target ON public.permission_audit_logs USING btree (target_type, target_id);


--
-- Name: idx_qc_results_result; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qc_results_result ON public.qc_results USING btree (qc_result);


--
-- Name: idx_qc_results_stage; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qc_results_stage ON public.qc_results USING btree (qc_stage);


--
-- Name: idx_qc_results_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qc_results_ticket ON public.qc_results USING btree (ticket_id);


--
-- Name: idx_qc_rr_state_updated; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_qc_rr_state_updated ON public.qc_round_robin_state USING btree (updated_at);


--
-- Name: idx_rent_devices_serial_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rent_devices_serial_id ON public.rent_devices USING btree (serial_id);


--
-- Name: idx_repair_logs_serial_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_repair_logs_serial_id ON public.repair_logs USING btree (serial_number_id);


--
-- Name: idx_sales_order_lines_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_order_lines_number ON public.sales_order_lines USING btree (sales_order_number);


--
-- Name: idx_sales_order_lines_quotation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_order_lines_quotation ON public.sales_order_lines USING btree (quotation_number);


--
-- Name: idx_sales_quotations_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_quotations_customer ON public.sales_quotations USING btree (customer_id);


--
-- Name: idx_sales_quotations_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_quotations_number ON public.sales_quotations USING btree (quotation_number);


--
-- Name: idx_sales_quotations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_quotations_status ON public.sales_quotations USING btree (status);


--
-- Name: idx_stages_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stages_category ON public.stages USING btree (stage_category);


--
-- Name: idx_support_item_comments_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_item_comments_item ON public.support_ticket_item_comments USING btree (item_id);


--
-- Name: idx_support_replacement_orders_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_replacement_orders_ticket ON public.support_replacement_orders USING btree (ticket_id);


--
-- Name: idx_support_ticket_items_assigned; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_ticket_items_assigned ON public.support_ticket_items USING btree (assigned_to);


--
-- Name: idx_support_ticket_items_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_ticket_items_ticket ON public.support_ticket_items USING btree (ticket_id);


--
-- Name: idx_support_tickets_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_tickets_customer ON public.support_tickets USING btree (customer_id);


--
-- Name: idx_support_tickets_delivery_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_tickets_delivery_person ON public.support_tickets USING btree (delivery_person_id);


--
-- Name: idx_support_tickets_return_dc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_tickets_return_dc ON public.support_tickets USING btree (return_dc_number);


--
-- Name: idx_support_tickets_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_tickets_machine; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tickets_machine ON public.tickets USING btree (machine_number);


--
-- Name: idx_tickets_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tickets_serial ON public.tickets USING btree (serial_number);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tickets_status ON public.tickets USING btree (status);


--
-- Name: idx_tickets_ttspl_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tickets_ttspl_id ON public.tickets USING btree (ttspl_id);


--
-- Name: idx_user_teams_team; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_teams_team ON public.user_teams USING btree (team_id);


--
-- Name: idx_user_teams_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_teams_user ON public.user_teams USING btree (user_id);


--
-- Name: idx_vendor_audit_actor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_audit_actor ON public.vendor_audit_logs USING btree (actor_user_id);


--
-- Name: idx_vendor_audit_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_audit_entity ON public.vendor_audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_vendor_billing_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_billing_period ON public.vendor_billing USING btree (billing_year, billing_month);


--
-- Name: idx_vendor_billing_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_billing_status ON public.vendor_billing USING btree (status);


--
-- Name: idx_vendor_billing_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_billing_vendor ON public.vendor_billing USING btree (vendor_id);


--
-- Name: idx_vendor_product_details_po; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_product_details_po ON public.vendor_product_details USING btree (po_id);


--
-- Name: idx_vendor_product_inventory_serial_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vendor_product_inventory_serial_id ON public.vendor_product_inventory USING btree (serial_id);


--
-- Name: idx_vendor_product_inventory_serial_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vendor_product_inventory_serial_number ON public.vendor_product_inventory USING btree (lower((serial_number)::text));


--
-- Name: idx_vendor_refresh_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_refresh_vendor ON public.vendor_refresh_tokens USING btree (vendor_id);


--
-- Name: idx_vendor_replaced_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_replaced_status ON public.vendor_replaced_products USING btree (status);


--
-- Name: idx_vendor_replaced_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_replaced_vendor ON public.vendor_replaced_products USING btree (vendor_id);


--
-- Name: idx_vendor_serial_inventory_asset_code_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vendor_serial_inventory_asset_code_unique ON public.vendor_serial_numbers USING btree (inventory_asset_code) WHERE ((inventory_asset_code IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_vendor_serial_inventory_status_po; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_serial_inventory_status_po ON public.vendor_serial_numbers USING btree (inventory_status, po_id) WHERE ((deleted_at IS NULL) AND (po_id IS NOT NULL));


--
-- Name: idx_vendor_serial_po_grn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_serial_po_grn ON public.vendor_serial_numbers USING btree (po_id, grn_id);


--
-- Name: idx_vendor_serial_spo_grn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_serial_spo_grn ON public.vendor_serial_numbers USING btree (spo_id, grn_id) WHERE (spo_id IS NOT NULL);


--
-- Name: idx_vendor_serial_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vendor_serial_unique ON public.vendor_serial_numbers USING btree (lower((serial_number)::text)) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendor_shops_one_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vendor_shops_one_active ON public.vendor_shops USING btree (vendor_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendor_shops_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_shops_vendor ON public.vendor_shops USING btree (vendor_id);


--
-- Name: idx_vendors_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendors_deleted ON public.vendors USING btree (deleted_at);


--
-- Name: idx_vendors_email_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vendors_email_active ON public.vendors USING btree (lower((email)::text)) WHERE (deleted_at IS NULL);


--
-- Name: idx_vendors_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendors_status ON public.vendors USING btree (status);


--
-- Name: idx_vgrn_po; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vgrn_po ON public.vendor_goods_received_notes USING btree (po_id);


--
-- Name: idx_vgrn_spo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vgrn_spo ON public.vendor_goods_received_notes USING btree (spo_id) WHERE (spo_id IS NOT NULL);


--
-- Name: idx_vpo_dates; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vpo_dates ON public.vendor_purchase_orders USING btree (purchase_order_date DESC);


--
-- Name: idx_vpo_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vpo_deleted ON public.vendor_purchase_orders USING btree (deleted_at);


--
-- Name: idx_vpo_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vpo_status ON public.vendor_purchase_orders USING btree (status);


--
-- Name: idx_vpo_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vpo_vendor ON public.vendor_purchase_orders USING btree (vendor_id);


--
-- Name: idx_vspc_active_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vspc_active_name ON public.vendor_spare_parts_catalog USING btree (active, name);


--
-- Name: idx_vspo_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vspo_status ON public.vendor_spare_parts_purchase_orders USING btree (status);


--
-- Name: idx_vspo_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vspo_vendor ON public.vendor_spare_parts_purchase_orders USING btree (vendor_id);


--
-- Name: idx_work_logs_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_work_logs_active ON public.work_logs USING btree (ticket_id) WHERE (end_time IS NULL);


--
-- Name: idx_work_logs_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_work_logs_ticket ON public.work_logs USING btree (ticket_id);


--
-- Name: uq_customer_inventory_line; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_customer_inventory_line ON public.customer_inventory USING btree (customer_id, asset_kind, asset_bucket, COALESCE((delivery_challan_id)::text, ''::text), COALESCE(erp_serial_id, ''::character varying), COALESCE(unique_serial_number, ''::character varying), COALESCE(serial_number, ''::character varying));


--
-- Name: uq_tickets_serial_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_tickets_serial_open ON public.tickets USING btree (serial_number) WHERE ((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('on_hold'::character varying)::text]));


--
-- Name: ux_customer_addresses_head_office; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_customer_addresses_head_office ON public.customer_addresses USING btree (customer_id, is_head_office) WHERE (is_head_office = true);


--
-- Name: ux_stages_stage_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_stages_stage_name ON public.stages USING btree (stage_name);


--
-- Name: ux_teams_team_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ux_teams_team_name ON public.teams USING btree (team_name);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: postgres
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: postgres
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_key; Type: INDEX; Schema: realtime; Owner: postgres
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_key ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: postgres
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: lead_addresses trg_sync_customer_from_lead_on_addresses; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_sync_customer_from_lead_on_addresses AFTER INSERT OR DELETE OR UPDATE ON public.lead_addresses FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_customer_from_lead();


--
-- Name: leads trg_sync_customer_from_lead_on_leads; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_sync_customer_from_lead_on_leads AFTER INSERT OR UPDATE OF status, name, company_name, email, phone ON public.leads FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_customer_from_lead();


--
-- Name: lead_company_research trg_sync_customer_from_lead_on_research; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_sync_customer_from_lead_on_research AFTER INSERT OR UPDATE OF gst, address, city, state, pincode ON public.lead_company_research FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_customer_from_lead();


--
-- Name: inventory update_inventory_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: leads update_leads_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: tickets update_tickets_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: postgres
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: postgres
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: postgres
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: postgres
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: postgres
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: postgres
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: activities activities_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: activities activities_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: activities activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: chip_level_repairs chip_level_repairs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: chip_level_repairs chip_level_repairs_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: chip_level_repairs chip_level_repairs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chip_level_repairs
    ADD CONSTRAINT chip_level_repairs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: customer_inventory customer_inventory_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_inventory
    ADD CONSTRAINT customer_inventory_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.existing_customer(customer_id) ON DELETE CASCADE;


--
-- Name: customers customers_source_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(lead_id) ON DELETE SET NULL;


--
-- Name: delivery_challan_lines delivery_challan_lines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: delivery_challan_lines delivery_challan_lines_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: delivery_technicians delivery_technicians_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_technicians
    ADD CONSTRAINT delivery_technicians_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: diagnosis_images diagnosis_images_diagnosis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_images
    ADD CONSTRAINT diagnosis_images_diagnosis_id_fkey FOREIGN KEY (diagnosis_id) REFERENCES public.diagnosis_results(diagnosis_id) ON DELETE CASCADE;


--
-- Name: diagnosis_parts_required diagnosis_parts_required_attached_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_attached_by_fkey FOREIGN KEY (attached_by) REFERENCES public.users(user_id);


--
-- Name: diagnosis_parts_required diagnosis_parts_required_diagnosis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_diagnosis_id_fkey FOREIGN KEY (diagnosis_id) REFERENCES public.diagnosis_results(diagnosis_id) ON DELETE CASCADE;


--
-- Name: diagnosis_parts_required diagnosis_parts_required_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_parts_required
    ADD CONSTRAINT diagnosis_parts_required_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: diagnosis_results diagnosis_results_diagnosed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_diagnosed_by_fkey FOREIGN KEY (diagnosed_by) REFERENCES public.users(user_id);


--
-- Name: diagnosis_results diagnosis_results_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.diagnosis_results
    ADD CONSTRAINT diagnosis_results_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: email_lead_ingestion_log email_lead_ingestion_log_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_lead_ingestion_log
    ADD CONSTRAINT email_lead_ingestion_log_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE SET NULL;


--
-- Name: lead_activities lead_activities_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: lead_addresses lead_addresses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_addresses
    ADD CONSTRAINT lead_addresses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: lead_addresses lead_addresses_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_addresses
    ADD CONSTRAINT lead_addresses_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_assignments lead_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(user_id);


--
-- Name: lead_assignments lead_assignments_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(user_id);


--
-- Name: lead_assignments lead_assignments_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_auto_assign_config lead_auto_assign_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_auto_assign_config
    ADD CONSTRAINT lead_auto_assign_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: lead_company_research lead_company_research_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_company_research
    ADD CONSTRAINT lead_company_research_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_followup_notifications lead_followup_notifications_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_followup_notifications
    ADD CONSTRAINT lead_followup_notifications_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_orders lead_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_orders
    ADD CONSTRAINT lead_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: lead_orders lead_orders_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_orders
    ADD CONSTRAINT lead_orders_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_remarks lead_remarks_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_remarks
    ADD CONSTRAINT lead_remarks_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE CASCADE;


--
-- Name: lead_remarks lead_remarks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_remarks
    ADD CONSTRAINT lead_remarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: leads leads_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(user_id);


--
-- Name: leads leads_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(user_id);


--
-- Name: leads leads_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.leads(lead_id);


--
-- Name: order_items order_items_customer_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_customer_address_id_fkey FOREIGN KEY (customer_address_id) REFERENCES public.customer_addresses(customer_address_id) ON DELETE SET NULL;


--
-- Name: order_items order_items_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.inventory(inventory_id);


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- Name: order_status_history order_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(user_id);


--
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- Name: orders orders_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(user_id);


--
-- Name: orders orders_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: permission_audit_logs permission_audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: photos photos_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: photos photos_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: photos photos_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id);


--
-- Name: procurement_requests procurement_requests_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.procurement_requests
    ADD CONSTRAINT procurement_requests_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(item_id) ON DELETE CASCADE;


--
-- Name: qc_photos qc_photos_qc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_photos
    ADD CONSTRAINT qc_photos_qc_id_fkey FOREIGN KEY (qc_id) REFERENCES public.qc_results(qc_id) ON DELETE CASCADE;


--
-- Name: qc_results qc_results_checked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_checked_by_fkey FOREIGN KEY (checked_by) REFERENCES public.users(user_id);


--
-- Name: qc_results qc_results_tested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_tested_by_fkey FOREIGN KEY (tested_by) REFERENCES public.users(user_id);


--
-- Name: qc_results qc_results_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.qc_results
    ADD CONSTRAINT qc_results_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: sales_order_lines sales_order_lines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: sales_order_lines sales_order_lines_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_lines
    ADD CONSTRAINT sales_order_lines_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: sales_quotations sales_quotations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: sales_quotations sales_quotations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: stage_checklists stage_checklists_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_checklists
    ADD CONSTRAINT stage_checklists_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: stages stages_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stages
    ADD CONSTRAINT stages_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id);


--
-- Name: support_replacement_orders support_replacement_orders_complaint_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_complaint_item_id_fkey FOREIGN KEY (complaint_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_replacement_orders support_replacement_orders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: support_replacement_orders support_replacement_orders_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.support_ticket_items(id) ON DELETE CASCADE;


--
-- Name: support_replacement_orders support_replacement_orders_pickup_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_pickup_item_id_fkey FOREIGN KEY (pickup_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_replacement_orders support_replacement_orders_source_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_source_item_id_fkey FOREIGN KEY (source_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_replacement_orders support_replacement_orders_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_audit support_ticket_item_audit_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.support_ticket_items(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_audit support_ticket_item_audit_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_audit support_ticket_item_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_audit
    ADD CONSTRAINT support_ticket_item_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: support_ticket_item_comments support_ticket_item_comments_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_comments
    ADD CONSTRAINT support_ticket_item_comments_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.support_ticket_items(id) ON DELETE CASCADE;


--
-- Name: support_ticket_item_comments support_ticket_item_comments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_item_comments
    ADD CONSTRAINT support_ticket_item_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_issue_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_issue_category_id_fkey FOREIGN KEY (issue_category_id) REFERENCES public.support_issue_categories(id);


--
-- Name: support_ticket_items support_ticket_items_outcome_set_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_outcome_set_by_fkey FOREIGN KEY (outcome_set_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_pickup_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_pickup_assigned_to_fkey FOREIGN KEY (pickup_assigned_to) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_replacement_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_replacement_approved_by_fkey FOREIGN KEY (replacement_approved_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_replacement_flagged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_replacement_flagged_by_fkey FOREIGN KEY (replacement_flagged_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_source_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_source_item_id_fkey FOREIGN KEY (source_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_ticket_items support_ticket_items_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(user_id);


--
-- Name: support_tickets support_tickets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(user_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: ticket_checklist_progress ticket_checklist_progress_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_checklist_progress
    ADD CONSTRAINT ticket_checklist_progress_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: ticket_parts ticket_parts_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_parts
    ADD CONSTRAINT ticket_parts_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(part_id);


--
-- Name: ticket_parts ticket_parts_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_parts
    ADD CONSTRAINT ticket_parts_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: ticket_services ticket_services_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_services
    ADD CONSTRAINT ticket_services_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.users(user_id);


--
-- Name: ticket_services ticket_services_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_services
    ADD CONSTRAINT ticket_services_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: tickets tickets_assigned_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assigned_team_id_fkey FOREIGN KEY (assigned_team_id) REFERENCES public.teams(team_id);


--
-- Name: tickets tickets_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.users(user_id);


--
-- Name: tickets tickets_current_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_current_stage_id_fkey FOREIGN KEY (current_stage_id) REFERENCES public.stages(stage_id);


--
-- Name: user_permissions user_permissions_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(user_id);


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: user_teams user_teams_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id) ON DELETE CASCADE;


--
-- Name: user_teams user_teams_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_teams
    ADD CONSTRAINT user_teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: users users_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: users users_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(team_id);


--
-- Name: vendor_audit_logs vendor_audit_logs_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_audit_logs
    ADD CONSTRAINT vendor_audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_audit_logs vendor_audit_logs_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_audit_logs
    ADD CONSTRAINT vendor_audit_logs_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE SET NULL;


--
-- Name: vendor_billing vendor_billing_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_billing
    ADD CONSTRAINT vendor_billing_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_billing vendor_billing_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_billing
    ADD CONSTRAINT vendor_billing_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE SET NULL;


--
-- Name: vendor_goods_received_notes vendor_goods_received_notes_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_goods_received_notes
    ADD CONSTRAINT vendor_goods_received_notes_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE CASCADE;


--
-- Name: vendor_goods_received_notes vendor_goods_received_notes_spo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_goods_received_notes
    ADD CONSTRAINT vendor_goods_received_notes_spo_id_fkey FOREIGN KEY (spo_id) REFERENCES public.vendor_spare_parts_purchase_orders(spo_id) ON DELETE CASCADE;


--
-- Name: vendor_product_details vendor_product_details_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_product_details
    ADD CONSTRAINT vendor_product_details_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE CASCADE;


--
-- Name: vendor_product_inventory vendor_product_inventory_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_product_inventory
    ADD CONSTRAINT vendor_product_inventory_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id) ON DELETE CASCADE;


--
-- Name: vendor_purchase_orders vendor_purchase_orders_status_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_status_updated_by_admin_id_fkey FOREIGN KEY (status_updated_by_admin_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_purchase_orders vendor_purchase_orders_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_purchase_orders
    ADD CONSTRAINT vendor_purchase_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendor_refresh_tokens vendor_refresh_tokens_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_refresh_tokens
    ADD CONSTRAINT vendor_refresh_tokens_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


--
-- Name: vendor_replaced_products vendor_replaced_products_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_replaced_products
    ADD CONSTRAINT vendor_replaced_products_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE SET NULL;


--
-- Name: vendor_replaced_products vendor_replaced_products_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_replaced_products
    ADD CONSTRAINT vendor_replaced_products_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE SET NULL;


--
-- Name: vendor_serial_number_audit vendor_serial_number_audit_changed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_number_audit
    ADD CONSTRAINT vendor_serial_number_audit_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_serial_numbers vendor_serial_numbers_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.vendor_goods_received_notes(grn_id) ON DELETE CASCADE;


--
-- Name: vendor_serial_numbers vendor_serial_numbers_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id) ON DELETE CASCADE;


--
-- Name: vendor_serial_numbers vendor_serial_numbers_spo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_spo_id_fkey FOREIGN KEY (spo_id) REFERENCES public.vendor_spare_parts_purchase_orders(spo_id) ON DELETE CASCADE;


--
-- Name: vendor_shops vendor_shops_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_shops
    ADD CONSTRAINT vendor_shops_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_ord_status_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_ord_status_updated_by_admin_id_fkey FOREIGN KEY (status_updated_by_admin_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: vendor_spare_parts_purchase_orders vendor_spare_parts_purchase_orders_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_spare_parts_purchase_orders
    ADD CONSTRAINT vendor_spare_parts_purchase_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendor_wallets vendor_wallets_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_wallets
    ADD CONSTRAINT vendor_wallets_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


--
-- Name: work_logs work_logs_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.stages(stage_id);


--
-- Name: work_logs work_logs_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: work_logs work_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.work_logs
    ADD CONSTRAINT work_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: postgres
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: postgres
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: postgres
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: postgres
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: postgres
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION supabase_realtime OWNER TO postgres;

--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: postgres
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


ALTER EVENT TRIGGER issue_graphql_placeholder OWNER TO postgres;

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: postgres
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


ALTER EVENT TRIGGER issue_pg_cron_access OWNER TO postgres;

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: postgres
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


ALTER EVENT TRIGGER issue_pg_graphql_access OWNER TO postgres;

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: postgres
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


ALTER EVENT TRIGGER issue_pg_net_access OWNER TO postgres;

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: postgres
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


ALTER EVENT TRIGGER pgrst_ddl_watch OWNER TO postgres;

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: postgres
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


ALTER EVENT TRIGGER pgrst_drop_watch OWNER TO postgres;

--
-- Phase 1 patch (new_crm_rentfoxxy): vendor portal, PO approval, GRN bills, billing
-- See database/phase1_schema_patch.sql for the same content in isolation.
--

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS vendor_portal_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS vendor_portal_last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_portal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS po_payment_terms VARCHAR(50) DEFAULT 'postpaid_monthly',
  ADD COLUMN IF NOT EXISTS credit_days INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS msme_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contact_person_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_person_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pincode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.vendor_purchase_orders
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_vendor_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_invoice_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vendor_invoice_file TEXT,
  ADD COLUMN IF NOT EXISTS vendor_invoice_uploaded_at TIMESTAMPTZ;

ALTER TABLE public.vendor_goods_received_notes
  ADD COLUMN IF NOT EXISTS bill_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS bill_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bill_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS public.vendor_debit_notes (
  debit_note_id SERIAL PRIMARY KEY,
  debit_note_number VARCHAR(50) NOT NULL UNIQUE,
  vendor_id INT NOT NULL REFERENCES public.vendors(vendor_id),
  po_id INT REFERENCES public.vendor_purchase_orders(po_id),
  reason VARCHAR(255) NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INT DEFAULT 0,
  unit_rate NUMERIC(12,2) DEFAULT 0,
  ttspl_ids JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending',
  adjusted_in_bill_id INT,
  created_by INT REFERENCES public.users(user_id),
  approved_by INT REFERENCES public.users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vendor_monthly_bills (
  bill_id SERIAL PRIMARY KEY,
  bill_number VARCHAR(50) NOT NULL UNIQUE,
  vendor_id INT NOT NULL REFERENCES public.vendors(vendor_id),
  bill_month INT NOT NULL,
  bill_year INT NOT NULL,
  bill_date DATE NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  gst_amount NUMERIC(12,2) DEFAULT 0,
  debit_note_adjustment NUMERIC(12,2) DEFAULT 0,
  total_payable NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'generated',
  payment_date DATE,
  payment_reference VARCHAR(100),
  notes TEXT,
  generated_by INT REFERENCES public.users(user_id),
  approved_by INT REFERENCES public.users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_id, bill_month, bill_year)
);

CREATE TABLE IF NOT EXISTS public.vendor_portal_sessions (
  session_id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES public.vendors(vendor_id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpo_status_workflow ON public.vendor_purchase_orders (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vgrn_bill_status ON public.vendor_goods_received_notes (bill_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_vendor ON public.vendor_portal_sessions (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_expires ON public.vendor_portal_sessions (expires_at);

--
-- PostgreSQL database dump complete
--

\unrestrict 2gq2Q7RpwSX5iPIb3zF0HeCc3bWBzosUeFogNP0gRnLHzSWgdnkbt0YvWPHCecO

