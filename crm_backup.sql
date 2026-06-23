--
-- PostgreSQL database dump
--

\restrict bQQsHhG2wAeOlCcKo56hlAOnPVzQKZX58FZcRUGsYeDY6bCccBF5ygpeV1xOTC8

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
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
-- Name: update_lead_last_activity(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_lead_last_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE leads SET last_activity_at = NOW()
  WHERE lead_id = NEW.lead_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_lead_last_activity() OWNER TO postgres;

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
-- Name: asset_config_brands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_brands (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_brands_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_brands OWNER TO postgres;

--
-- Name: asset_config_brands_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_brands_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_brands_id_seq OWNER TO postgres;

--
-- Name: asset_config_brands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_brands_id_seq OWNED BY public.asset_config_brands.id;


--
-- Name: asset_config_generations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_generations (
    id integer NOT NULL,
    processor_id integer NOT NULL,
    name character varying(80) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_generations_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_generations OWNER TO postgres;

--
-- Name: asset_config_generations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_generations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_generations_id_seq OWNER TO postgres;

--
-- Name: asset_config_generations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_generations_id_seq OWNED BY public.asset_config_generations.id;


--
-- Name: asset_config_gpu; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_gpu (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_gpu_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_gpu OWNER TO postgres;

--
-- Name: asset_config_gpu_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_gpu_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_gpu_id_seq OWNER TO postgres;

--
-- Name: asset_config_gpu_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_gpu_id_seq OWNED BY public.asset_config_gpu.id;


--
-- Name: asset_config_models; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_models (
    id integer NOT NULL,
    brand_id integer NOT NULL,
    name character varying(200) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_models_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_models OWNER TO postgres;

--
-- Name: asset_config_models_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_models_id_seq OWNER TO postgres;

--
-- Name: asset_config_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_models_id_seq OWNED BY public.asset_config_models.id;


--
-- Name: asset_config_processors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_processors (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_processors_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_processors OWNER TO postgres;

--
-- Name: asset_config_processors_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_processors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_processors_id_seq OWNER TO postgres;

--
-- Name: asset_config_processors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_processors_id_seq OWNED BY public.asset_config_processors.id;


--
-- Name: asset_config_ram; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_ram (
    id integer NOT NULL,
    name character varying(40) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_ram_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_ram OWNER TO postgres;

--
-- Name: asset_config_ram_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_ram_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_ram_id_seq OWNER TO postgres;

--
-- Name: asset_config_ram_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_ram_id_seq OWNED BY public.asset_config_ram.id;


--
-- Name: asset_config_screen_sizes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_screen_sizes (
    id integer NOT NULL,
    name character varying(40) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_screen_sizes_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_screen_sizes OWNER TO postgres;

--
-- Name: asset_config_screen_sizes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_screen_sizes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_screen_sizes_id_seq OWNER TO postgres;

--
-- Name: asset_config_screen_sizes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_screen_sizes_id_seq OWNED BY public.asset_config_screen_sizes.id;


--
-- Name: asset_config_storage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_config_storage (
    id integer NOT NULL,
    name character varying(60) NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by integer,
    updated_by integer,
    deleted_at timestamp with time zone,
    CONSTRAINT asset_config_storage_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_config_storage OWNER TO postgres;

--
-- Name: asset_config_storage_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_config_storage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_config_storage_id_seq OWNER TO postgres;

--
-- Name: asset_config_storage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_config_storage_id_seq OWNED BY public.asset_config_storage.id;


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
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chip_level_repairs_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('waiting_parts'::character varying)::text, ('completed'::character varying)::text])))
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
-- Name: companies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.companies (
    company_id integer NOT NULL,
    code character varying(20) NOT NULL,
    legal_name character varying(255) NOT NULL,
    gstin character varying(20),
    pan character varying(20),
    address text,
    state_code character varying(4),
    hsn_code character varying(20) DEFAULT '84713000'::character varying,
    logo_url text,
    dc_prefix character varying(12) NOT NULL,
    invoice_prefix character varying(12) NOT NULL,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email character varying(255),
    phone character varying(32)
);


ALTER TABLE public.companies OWNER TO postgres;

--
-- Name: companies_company_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.companies_company_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.companies_company_id_seq OWNER TO postgres;

--
-- Name: companies_company_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.companies_company_id_seq OWNED BY public.companies.company_id;


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
    address_type character varying(30),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
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
-- Name: customer_credit_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_credit_notes (
    credit_note_id integer NOT NULL,
    credit_note_number character varying(50) NOT NULL,
    customer_id integer NOT NULL,
    invoice_id integer,
    reason character varying(255) NOT NULL,
    description text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 0,
    unit_rate numeric(12,2) DEFAULT 0,
    from_date date,
    to_date date,
    ttspl_ids jsonb DEFAULT '[]'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    applied_in_invoice_id integer,
    created_by integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    serial_id integer,
    return_ticket_id integer,
    source character varying(30),
    CONSTRAINT customer_credit_notes_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('applied'::character varying)::text, ('cancelled'::character varying)::text])))
);


ALTER TABLE public.customer_credit_notes OWNER TO postgres;

--
-- Name: COLUMN customer_credit_notes.return_ticket_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.customer_credit_notes.return_ticket_id IS 'Floor return_qc ticket raised when the unit was picked up';


--
-- Name: customer_credit_notes_credit_note_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_credit_notes_credit_note_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_credit_notes_credit_note_id_seq OWNER TO postgres;

--
-- Name: customer_credit_notes_credit_note_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_credit_notes_credit_note_id_seq OWNED BY public.customer_credit_notes.credit_note_id;


--
-- Name: customer_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_documents (
    doc_id integer NOT NULL,
    customer_id integer NOT NULL,
    lead_id integer,
    doc_type character varying(50) NOT NULL,
    doc_label character varying(255),
    file_path text NOT NULL,
    file_name character varying(255),
    file_size_bytes integer,
    uploaded_by integer,
    is_signed boolean DEFAULT false,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT customer_documents_doc_type_check CHECK (((doc_type)::text = ANY (ARRAY[('gst_certificate'::character varying)::text, ('pan_card'::character varying)::text, ('agreement'::character varying)::text, ('kyc_id'::character varying)::text, ('other'::character varying)::text])))
);


ALTER TABLE public.customer_documents OWNER TO postgres;

--
-- Name: customer_documents_doc_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_documents_doc_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_documents_doc_id_seq OWNER TO postgres;

--
-- Name: customer_documents_doc_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_documents_doc_id_seq OWNED BY public.customer_documents.doc_id;


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
    passivated_reason character varying(500),
    deprecated boolean DEFAULT true
);


ALTER TABLE public.customer_inventory OWNER TO postgres;

--
-- Name: TABLE customer_inventory; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.customer_inventory IS 'DEPRECATED 2026-06: ERP-era table. Customer holdings now derived from vendor_serial_numbers. Read-only / historical.';


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
-- Name: customer_invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_invoices (
    invoice_id integer NOT NULL,
    invoice_number character varying(50) NOT NULL,
    customer_id integer NOT NULL,
    invoice_month integer NOT NULL,
    invoice_year integer NOT NULL,
    invoice_date date NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(12,2) DEFAULT 0,
    gst_percent numeric(5,2) DEFAULT 18,
    gst_amount numeric(12,2) DEFAULT 0,
    credit_note_adjustment numeric(12,2) DEFAULT 0,
    security_deposit numeric(12,2) DEFAULT 0,
    grand_total numeric(12,2) DEFAULT 0,
    status character varying(20) DEFAULT 'draft'::character varying,
    irn character varying(100),
    irn_generated_at timestamp with time zone,
    qr_code_url text,
    signed_qr_code text,
    eway_bill_number character varying(50),
    eway_bill_valid_till timestamp with time zone,
    pdf_path text,
    sent_at timestamp with time zone,
    sent_by integer,
    paid_at timestamp with time zone,
    payment_reference character varying(100),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    entity_code character varying(20),
    CONSTRAINT customer_invoices_invoice_month_check CHECK (((invoice_month >= 1) AND (invoice_month <= 12))),
    CONSTRAINT customer_invoices_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('sent'::character varying)::text, ('paid'::character varying)::text, ('overdue'::character varying)::text, ('cancelled'::character varying)::text])))
);


ALTER TABLE public.customer_invoices OWNER TO postgres;

--
-- Name: customer_invoices_invoice_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_invoices_invoice_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_invoices_invoice_id_seq OWNER TO postgres;

--
-- Name: customer_invoices_invoice_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_invoices_invoice_id_seq OWNED BY public.customer_invoices.invoice_id;


--
-- Name: customer_portal_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_portal_sessions (
    session_id integer NOT NULL,
    customer_id integer NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.customer_portal_sessions OWNER TO postgres;

--
-- Name: customer_portal_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_portal_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_portal_sessions_session_id_seq OWNER TO postgres;

--
-- Name: customer_portal_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_portal_sessions_session_id_seq OWNED BY public.customer_portal_sessions.session_id;


--
-- Name: customer_security_deposits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_security_deposits (
    deposit_id integer NOT NULL,
    customer_id integer NOT NULL,
    sales_order_number character varying(50),
    amount numeric(12,2) NOT NULL,
    received_date date NOT NULL,
    status character varying(20) DEFAULT 'held'::character varying,
    refund_amount numeric(12,2) DEFAULT 0,
    refund_date date,
    refund_reference character varying(100),
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT customer_security_deposits_status_check CHECK (((status)::text = ANY (ARRAY[('held'::character varying)::text, ('partially_refunded'::character varying)::text, ('refunded'::character varying)::text, ('adjusted'::character varying)::text])))
);


ALTER TABLE public.customer_security_deposits OWNER TO postgres;

--
-- Name: customer_security_deposits_deposit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_security_deposits_deposit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_security_deposits_deposit_id_seq OWNER TO postgres;

--
-- Name: customer_security_deposits_deposit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_security_deposits_deposit_id_seq OWNED BY public.customer_security_deposits.deposit_id;


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
    status smallint DEFAULT 1 NOT NULL,
    company_name character varying(255),
    pan_number character varying(20),
    company_type character varying(100),
    company_size integer,
    industry character varying(100),
    billing_address text,
    billing_city character varying(100),
    billing_state character varying(100),
    billing_pincode character varying(10),
    shipping_same boolean DEFAULT true,
    shipping_address text,
    shipping_city character varying(100),
    shipping_state character varying(100),
    shipping_pincode character varying(10),
    whatsapp_number character varying(32),
    designation character varying(255),
    source_lead_stage character varying(100),
    onboarded_by integer,
    onboarded_at timestamp with time zone,
    portal_enabled boolean DEFAULT false,
    notes text,
    kyc_verified boolean DEFAULT false,
    kyc_verified_by integer,
    kyc_verified_at timestamp with time zone,
    source_lead_id integer,
    portal_password_hash text,
    portal_last_login timestamp with time zone,
    kyc_status character varying(20) DEFAULT 'pending'::character varying,
    kyc_documents jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT customers_kyc_status_check CHECK (((kyc_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('submitted'::character varying)::text, ('verified'::character varying)::text, ('rejected'::character varying)::text])))
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
-- Name: dc_qc_tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.dc_qc_tickets (
    id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    sales_order_number character varying(50),
    ticket_id integer NOT NULL,
    ttspl_id character varying(50),
    serial_id integer,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT dc_qc_tickets_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('qc_passed'::character varying)::text, ('qc_failed'::character varying)::text])))
);


ALTER TABLE public.dc_qc_tickets OWNER TO postgres;

--
-- Name: dc_qc_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dc_qc_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dc_qc_tickets_id_seq OWNER TO postgres;

--
-- Name: dc_qc_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.dc_qc_tickets_id_seq OWNED BY public.dc_qc_tickets.id;


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
    dispatch_mode character varying(20) DEFAULT 'courier'::character varying,
    porter_booking_id character varying(100),
    estimated_delivery date,
    pre_dispatch_qc_ticket_id integer,
    pre_dispatch_qc_passed boolean DEFAULT false,
    irn character varying(100),
    irn_generated_at timestamp with time zone,
    qr_code_url text,
    eway_bill_number character varying(50),
    eway_bill_valid_till timestamp with time zone,
    invoice_sent_at timestamp with time zone,
    invoice_sent_by integer,
    delivered_at timestamp with time zone,
    delivered_by integer,
    delivery_location text,
    delivery_otp character varying(10),
    delivery_otp_sent_at timestamp with time zone,
    pod_image_url text,
    rejection_reason text,
    entity_code character varying(20),
    porter_tracking_id character varying(100),
    porter_order_id character varying(100),
    porter_booking_url text,
    courier_tracking_url text,
    dispatched_at timestamp with time zone,
    reached_at timestamp with time zone,
    tech_latitude character varying(64),
    tech_longitude character varying(64),
    serial_verified_at timestamp with time zone,
    serial_verified_no character varying(255),
    otp_code character varying(10),
    otp_sent_at timestamp with time zone,
    otp_verified_at timestamp with time zone,
    pod_photo_url text,
    esign_url text,
    pod_submitted_at timestamp with time zone,
    pod_submitted_by integer,
    pod_type character varying(20),
    delivery_notes text,
    movement_type character varying(10) DEFAULT 'outbound'::character varying NOT NULL,
    support_ticket_id integer,
    original_dc_number character varying(50),
    CONSTRAINT delivery_challan_lines_dispatch_mode_check CHECK (((dispatch_mode)::text = ANY (ARRAY[('courier'::character varying)::text, ('porter'::character varying)::text, ('inhouse'::character varying)::text]))),
    CONSTRAINT delivery_challan_lines_movement_type_check CHECK (((movement_type)::text = ANY (ARRAY[('outbound'::character varying)::text, ('return'::character varying)::text]))),
    CONSTRAINT delivery_challan_lines_ship_by_check CHECK (((ship_by IS NULL) OR ((ship_by)::text = ANY (ARRAY[('by_hand'::character varying)::text, ('by_courier'::character varying)::text])))),
    CONSTRAINT delivery_challan_lines_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('shipped'::character varying)::text, ('in_transit'::character varying)::text, ('reached'::character varying)::text, ('delivered'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text])))
);


ALTER TABLE public.delivery_challan_lines OWNER TO postgres;

--
-- Name: COLUMN delivery_challan_lines.movement_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.delivery_challan_lines.movement_type IS 'outbound = delivery to customer; return = pickup from customer (Return DC)';


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
-- Name: demo_agreements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.demo_agreements (
    demo_id integer NOT NULL,
    sales_order_number character varying(50),
    dc_number character varying(50),
    customer_id integer NOT NULL,
    serial_id integer,
    ttspl_id character varying(64),
    delivered_at timestamp with time zone,
    decision_due_at timestamp with time zone,
    decision character varying(20) DEFAULT 'pending'::character varying,
    decided_at timestamp with time zone,
    decided_by integer,
    rent_start_date date,
    pickup_ticket_id integer,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT demo_agreements_decision_check CHECK (((decision)::text = ANY (ARRAY[('pending'::character varying)::text, ('keep'::character varying)::text, ('return'::character varying)::text])))
);


ALTER TABLE public.demo_agreements OWNER TO postgres;

--
-- Name: demo_agreements_demo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.demo_agreements_demo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.demo_agreements_demo_id_seq OWNER TO postgres;

--
-- Name: demo_agreements_demo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.demo_agreements_demo_id_seq OWNED BY public.demo_agreements.demo_id;


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
-- Name: einvoice_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.einvoice_records (
    record_id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    invoice_id integer,
    customer_id integer,
    invoice_number character varying(50),
    irn character varying(100),
    ack_number character varying(100),
    ack_date timestamp with time zone,
    signed_invoice text,
    signed_qr_code text,
    qr_code_image_url text,
    status character varying(20) DEFAULT 'generated'::character varying,
    cancelled_at timestamp with time zone,
    cancel_reason character varying(255),
    zoho_response jsonb,
    generated_by integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT einvoice_records_status_check CHECK (((status)::text = ANY (ARRAY[('generated'::character varying)::text, ('cancelled'::character varying)::text])))
);


ALTER TABLE public.einvoice_records OWNER TO postgres;

--
-- Name: einvoice_records_record_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.einvoice_records_record_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.einvoice_records_record_id_seq OWNER TO postgres;

--
-- Name: einvoice_records_record_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.einvoice_records_record_id_seq OWNED BY public.einvoice_records.record_id;


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
-- Name: eway_bill_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.eway_bill_records (
    record_id integer NOT NULL,
    dc_number character varying(50) NOT NULL,
    ewb_number character varying(50),
    ewb_date timestamp with time zone,
    valid_upto timestamp with time zone,
    transporter_id character varying(50),
    transporter_name character varying(100),
    vehicle_number character varying(20),
    mode_of_transport character varying(20) DEFAULT 'road'::character varying,
    distance_km integer,
    status character varying(20) DEFAULT 'active'::character varying,
    zoho_response jsonb,
    generated_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT eway_bill_records_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('extended'::character varying)::text, ('cancelled'::character varying)::text])))
);


ALTER TABLE public.eway_bill_records OWNER TO postgres;

--
-- Name: eway_bill_records_record_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.eway_bill_records_record_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.eway_bill_records_record_id_seq OWNER TO postgres;

--
-- Name: eway_bill_records_record_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.eway_bill_records_record_id_seq OWNED BY public.eway_bill_records.record_id;


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
-- Name: grn_access_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grn_access_attempts (
    id integer NOT NULL,
    access_number integer,
    access_id integer,
    success boolean DEFAULT false NOT NULL,
    result character varying(40),
    ip character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.grn_access_attempts OWNER TO postgres;

--
-- Name: grn_access_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grn_access_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grn_access_attempts_id_seq OWNER TO postgres;

--
-- Name: grn_access_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grn_access_attempts_id_seq OWNED BY public.grn_access_attempts.id;


--
-- Name: grn_access_number_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grn_access_number_seq
    START WITH 17
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grn_access_number_seq OWNER TO postgres;

--
-- Name: grn_access_numbers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grn_access_numbers (
    id integer NOT NULL,
    access_number integer NOT NULL,
    capture_url text NOT NULL,
    capture_token uuid,
    po_id integer,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    used_at timestamp with time zone,
    expires_at timestamp with time zone,
    CONSTRAINT grn_access_numbers_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('used'::character varying)::text, ('expired'::character varying)::text])))
);


ALTER TABLE public.grn_access_numbers OWNER TO postgres;

--
-- Name: grn_access_numbers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grn_access_numbers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grn_access_numbers_id_seq OWNER TO postgres;

--
-- Name: grn_access_numbers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grn_access_numbers_id_seq OWNED BY public.grn_access_numbers.id;


--
-- Name: grn_config_verifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grn_config_verifications (
    id integer NOT NULL,
    token_id uuid,
    po_id integer,
    line_index integer,
    expected_config jsonb,
    actual_config jsonb,
    matched_fields text[],
    mismatched_fields jsonb,
    configuration_matched boolean DEFAULT false NOT NULL,
    ip character varying(64),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.grn_config_verifications OWNER TO postgres;

--
-- Name: grn_config_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grn_config_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grn_config_verifications_id_seq OWNER TO postgres;

--
-- Name: grn_config_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grn_config_verifications_id_seq OWNED BY public.grn_config_verifications.id;


--
-- Name: grn_serial_capture_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grn_serial_capture_tokens (
    token_id uuid DEFAULT gen_random_uuid() NOT NULL,
    po_id integer NOT NULL,
    line_index integer NOT NULL,
    unit_index integer DEFAULT 0 NOT NULL,
    total_units integer DEFAULT 1 NOT NULL,
    serial_number text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_by integer,
    expires_at timestamp with time zone NOT NULL,
    captured_at timestamp with time zone,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    config_verified boolean DEFAULT false,
    config_verified_at timestamp with time zone,
    actual_config jsonb,
    config_check jsonb,
    CONSTRAINT grn_serial_capture_tokens_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'captured'::text, 'used'::text, 'expired'::text, 'cancelled'::text])))
);


ALTER TABLE public.grn_serial_capture_tokens OWNER TO postgres;

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
-- Name: inventory_status_transitions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_status_transitions (
    transition_id integer NOT NULL,
    serial_id integer,
    ttspl_id character varying(64),
    from_status character varying(64),
    to_status character varying(64) NOT NULL,
    reason character varying(255),
    dc_number character varying(50),
    customer_id integer,
    entity_code character varying(20),
    actor_user_id integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.inventory_status_transitions OWNER TO postgres;

--
-- Name: inventory_status_transitions_transition_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventory_status_transitions_transition_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventory_status_transitions_transition_id_seq OWNER TO postgres;

--
-- Name: inventory_status_transitions_transition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventory_status_transitions_transition_id_seq OWNED BY public.inventory_status_transitions.transition_id;


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
    mobile_no character varying(32),
    address text NOT NULL,
    pincode character varying(20),
    address_type character varying(30),
    created_by integer,
    created_at timestamp with time zone DEFAULT now()
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
    updated_at timestamp with time zone DEFAULT now(),
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
-- Name: lead_import_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lead_import_logs (
    import_id integer NOT NULL,
    imported_by integer,
    total_rows integer DEFAULT 0,
    imported integer DEFAULT 0,
    duplicates integer DEFAULT 0,
    errors integer DEFAULT 0,
    error_details jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lead_import_logs OWNER TO postgres;

--
-- Name: lead_import_logs_import_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lead_import_logs_import_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lead_import_logs_import_id_seq OWNER TO postgres;

--
-- Name: lead_import_logs_import_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lead_import_logs_import_id_seq OWNED BY public.lead_import_logs.import_id;


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
    city character varying(100),
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
    lead_stage character varying(200),
    quotation_accept_token character varying(64),
    quotation_accepted_at timestamp with time zone,
    quotation_last_sent_at timestamp with time zone,
    quotation_last_estimate_no character varying(50),
    quotation_last_to_email character varying(255),
    whatsapp_number character varying(32),
    designation character varying(255),
    quantity_required integer,
    monthly_budget numeric(12,2),
    rental_duration integer,
    use_case character varying(100),
    company_type character varying(100),
    company_size integer,
    industry character varying(100),
    annual_revenue character varying(100),
    pan_number character varying(20),
    gst_number character varying(20),
    state character varying(100),
    pincode character varying(10),
    billing_address text,
    shipping_same_as_billing boolean DEFAULT true,
    shipping_address text,
    follow_up_time time without time zone,
    converted_at timestamp with time zone,
    converted_by integer,
    customer_id integer,
    inquiry_type character varying(50) DEFAULT 'rental'::character varying,
    last_activity_at timestamp with time zone DEFAULT now(),
    company_brand character varying(255),
    brand character varying(100),
    processor character varying(100),
    generation character varying(50),
    ram character varying(50),
    storage character varying(50),
    personal_remarks text,
    CONSTRAINT leads_inquiry_type_check CHECK (((inquiry_type)::text = ANY (ARRAY[('rental'::character varying)::text, ('sales'::character varying)::text, ('both'::character varying)::text]))),
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
    unit_price numeric(10,2) DEFAULT 0,
    gst_percent numeric(5,2) DEFAULT 18,
    gst_amount numeric(10,2) DEFAULT 0,
    total_with_gst numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    qc_passed boolean DEFAULT false,
    is_wfh boolean DEFAULT false,
    shipping_charge numeric(10,2) DEFAULT 0,
    estimate_id character varying(120),
    destination_pincode character varying(20),
    tracking_status character varying(30) DEFAULT 'Not Dispatched'::character varying,
    item_tracker_id character varying(120),
    item_courier_partner character varying(120),
    item_dispatch_date date,
    item_estimated_delivery date,
    delivered_at timestamp with time zone,
    proposed_delivery_date date,
    qc_sales_checklist jsonb,
    qc_sales_passed_at timestamp with time zone
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
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.orders (
    order_id integer NOT NULL,
    customer_id integer,
    lead_type character varying(50),
    order_type character varying(20) DEFAULT 'Sales'::character varying,
    status character varying(50) DEFAULT 'New Lead'::character varying,
    owner_user_id integer,
    lockin_period_days integer DEFAULT 0,
    security_amount numeric(10,2) DEFAULT 0,
    is_wfh boolean DEFAULT false,
    shipping_charge numeric(10,2) DEFAULT 0,
    shipping_gst_amount numeric(10,2) DEFAULT 0,
    subtotal_amount numeric(12,2) DEFAULT 0,
    items_gst_amount numeric(12,2) DEFAULT 0,
    grand_total_amount numeric(12,2) DEFAULT 0,
    invoice_number character varying(100),
    invoice_generated_at timestamp with time zone,
    eway_bill_number character varying(100),
    eway_bill_generated_at timestamp with time zone,
    delivery_date date,
    shipping_address text,
    dispatch_date date,
    tracker_id character varying(100),
    courier_partner character varying(100),
    dispatched_at timestamp with time zone,
    estimated_delivery date,
    qc_received_at timestamp with time zone,
    qc_completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    cancelled_at timestamp with time zone,
    cancelled_by integer,
    CONSTRAINT orders_order_type_check CHECK (((order_type)::text = ANY (ARRAY[('Sales'::character varying)::text, ('Rent'::character varying)::text, ('Demo'::character varying)::text])))
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
-- Name: part_instances; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.part_instances (
    instance_id integer NOT NULL,
    prt_id character varying(30) NOT NULL,
    part_id integer NOT NULL,
    spo_id integer,
    grn_id integer,
    batch_number character varying(50),
    unit_cost numeric(10,2) DEFAULT 0 NOT NULL,
    status character varying(30) DEFAULT 'in_stock'::character varying NOT NULL,
    location_code character varying(100),
    installed_ttspl_id character varying(50),
    installed_ticket_id integer,
    installed_at timestamp with time zone,
    removed_at timestamp with time zone,
    condition_on_removal character varying(20),
    notes text,
    received_at timestamp with time zone DEFAULT now(),
    received_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT part_instances_status_check CHECK (((status)::text = ANY (ARRAY[('in_stock'::character varying)::text, ('reserved'::character varying)::text, ('installed'::character varying)::text, ('defective'::character varying)::text, ('returned'::character varying)::text, ('discarded'::character varying)::text, ('sold'::character varying)::text, ('with_technician'::character varying)::text])))
);


ALTER TABLE public.part_instances OWNER TO postgres;

--
-- Name: part_instances_instance_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.part_instances_instance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.part_instances_instance_id_seq OWNER TO postgres;

--
-- Name: part_instances_instance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.part_instances_instance_id_seq OWNED BY public.part_instances.instance_id;


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
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    request_number character varying(30),
    request_type character varying(20) DEFAULT 'replacement'::character varying,
    part_id integer,
    quantity integer DEFAULT 1,
    stage_name character varying(100),
    ticket_stage_id integer,
    config_field character varying(50),
    old_value character varying(200),
    new_value character varying(200),
    blocks_stage boolean DEFAULT true,
    approved_by integer,
    approved_at timestamp with time zone,
    rejection_reason text,
    escalated_by integer,
    escalated_at timestamp with time zone,
    spo_id integer,
    instance_id integer,
    attached_at timestamp with time zone,
    attached_by integer,
    old_part_returned boolean DEFAULT false,
    old_part_returned_at timestamp with time zone,
    old_part_condition character varying(20),
    old_part_notes text
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
    location_code character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    min_threshold integer DEFAULT 5,
    description text,
    category character varying(100) DEFAULT 'general'::character varying,
    part_sku character varying(100),
    compatible_brands text[],
    compatible_models text[],
    is_consumable boolean DEFAULT false,
    warranty_months integer DEFAULT 0,
    notes text,
    archived boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now()
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
    qc_stage character varying(20) NOT NULL,
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
    CONSTRAINT qc_results_qc_stage_check CHECK (((qc_stage)::text = ANY (ARRAY[('QC1'::character varying)::text, ('QC2'::character varying)::text, ('Dispatch QC'::character varying)::text])))
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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_code character varying(20),
    security_type character varying(20) DEFAULT 'none'::character varying,
    delivery_address jsonb,
    is_wfh boolean DEFAULT false,
    delivery_notes text
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
-- Name: sales_order_payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_order_payments (
    payment_id integer NOT NULL,
    sales_order_number character varying(50) NOT NULL,
    customer_id integer,
    payment_type character varying(30) NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    payment_mode character varying(30) DEFAULT 'bank_transfer'::character varying,
    reference_number character varying(100),
    notes text,
    recorded_by integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sales_order_payments_payment_mode_check CHECK (((payment_mode)::text = ANY (ARRAY[('bank_transfer'::character varying)::text, ('cheque'::character varying)::text, ('upi'::character varying)::text, ('cash'::character varying)::text, ('other'::character varying)::text]))),
    CONSTRAINT sales_order_payments_payment_type_check CHECK (((payment_type)::text = ANY (ARRAY[('advance'::character varying)::text, ('security_deposit'::character varying)::text, ('monthly'::character varying)::text, ('partial'::character varying)::text, ('final'::character varying)::text])))
);


ALTER TABLE public.sales_order_payments OWNER TO postgres;

--
-- Name: sales_order_payments_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sales_order_payments_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_order_payments_payment_id_seq OWNER TO postgres;

--
-- Name: sales_order_payments_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sales_order_payments_payment_id_seq OWNED BY public.sales_order_payments.payment_id;


--
-- Name: sales_order_serials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_order_serials (
    allocation_id integer NOT NULL,
    sales_order_number character varying(50) NOT NULL,
    line_id integer,
    serial_id integer,
    ttspl_id character varying(64),
    serial_number character varying(255),
    qc_ticket_id integer,
    qc_status character varying(20) DEFAULT 'pending'::character varying,
    status character varying(20) DEFAULT 'attached'::character varying,
    dc_number character varying(50),
    entity_code character varying(20),
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    delivery_address jsonb,
    delivery_notes text,
    is_wfh boolean DEFAULT false,
    CONSTRAINT sales_order_serials_qc_status_check CHECK (((qc_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('passed'::character varying)::text, ('failed'::character varying)::text]))),
    CONSTRAINT sales_order_serials_status_check CHECK (((status)::text = ANY (ARRAY[('attached'::character varying)::text, ('dispatched'::character varying)::text, ('removed'::character varying)::text])))
);


ALTER TABLE public.sales_order_serials OWNER TO postgres;

--
-- Name: sales_order_serials_allocation_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sales_order_serials_allocation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_order_serials_allocation_id_seq OWNER TO postgres;

--
-- Name: sales_order_serials_allocation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sales_order_serials_allocation_id_seq OWNED BY public.sales_order_serials.allocation_id;


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
    source_lead_id integer,
    entity_code character varying(20),
    security_type character varying(20) DEFAULT 'none'::character varying,
    CONSTRAINT sales_quotations_quotation_type_check CHECK (((quotation_type)::text = ANY ((ARRAY['sale'::character varying, 'rental'::character varying, 'demo'::character varying])::text[]))),
    CONSTRAINT sales_quotations_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
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
    current_customer_id integer,
    current_dc_number character varying(50),
    current_entity character varying(20),
    dispatch_mode character varying(20),
    dispatched_at timestamp with time zone,
    delivered_at timestamp with time zone,
    returned_at timestamp with time zone,
    rent_start_date date,
    rent_end_date date,
    rent_monthly_rate numeric(12,2),
    status_changed_at timestamp with time zone,
    rent_billed_until date,
    CONSTRAINT vendor_serial_po_or_spo_chk CHECK ((((po_id IS NOT NULL) AND (spo_id IS NULL)) OR ((po_id IS NULL) AND (spo_id IS NOT NULL))))
);


ALTER TABLE public.vendor_serial_numbers OWNER TO postgres;

--
-- Name: COLUMN vendor_serial_numbers.rent_billed_until; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.vendor_serial_numbers.rent_billed_until IS 'Prepaid-through date: last date the current customer has been invoiced for this rental unit. NULL = not yet billed.';


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
-- Name: stage_transition_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stage_transition_rules (
    rule_id integer NOT NULL,
    from_stage_name character varying(100) NOT NULL,
    to_stage_name character varying(100) NOT NULL,
    condition character varying(100),
    is_backward boolean DEFAULT false,
    notes text
);


ALTER TABLE public.stage_transition_rules OWNER TO postgres;

--
-- Name: stage_transition_rules_rule_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stage_transition_rules_rule_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stage_transition_rules_rule_id_seq OWNER TO postgres;

--
-- Name: stage_transition_rules_rule_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stage_transition_rules_rule_id_seq OWNED BY public.stage_transition_rules.rule_id;


--
-- Name: stages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stages (
    stage_id integer NOT NULL,
    stage_name character varying(100) NOT NULL,
    stage_order integer NOT NULL,
    team_id integer,
    stage_category character varying(100),
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
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
-- Name: support_challan_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_challan_items (
    id integer NOT NULL,
    challan_id integer NOT NULL,
    part_request_id integer NOT NULL,
    part_id integer NOT NULL,
    instance_id integer,
    prt_id character varying(30),
    part_name character varying(255),
    quantity integer DEFAULT 1 NOT NULL,
    unit_cost numeric(10,2) DEFAULT 0,
    returned_qty integer DEFAULT 0,
    return_status character varying(20) DEFAULT 'held'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT support_challan_items_return_status_check CHECK (((return_status)::text = ANY (ARRAY[('held'::character varying)::text, ('used'::character varying)::text, ('returned'::character varying)::text])))
);


ALTER TABLE public.support_challan_items OWNER TO postgres;

--
-- Name: support_challan_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_challan_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_challan_items_id_seq OWNER TO postgres;

--
-- Name: support_challan_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_challan_items_id_seq OWNED BY public.support_challan_items.id;


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
-- Name: support_part_challans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_part_challans (
    id integer NOT NULL,
    challan_number character varying(30) NOT NULL,
    support_ticket_id integer NOT NULL,
    ttspl_id character varying(120),
    issued_to integer NOT NULL,
    issued_by integer,
    issued_at timestamp with time zone,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    tech_esign_url text,
    tech_esign_at timestamp with time zone,
    tech_esign_name character varying(255),
    wh_esign_url text,
    wh_esign_at timestamp with time zone,
    wh_esign_name character varying(255),
    pdf_path text,
    return_pdf_path text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT support_part_challans_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('issued'::character varying)::text, ('partially_returned'::character varying)::text, ('fully_returned'::character varying)::text])))
);


ALTER TABLE public.support_part_challans OWNER TO postgres;

--
-- Name: support_part_challans_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_part_challans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_part_challans_id_seq OWNER TO postgres;

--
-- Name: support_part_challans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_part_challans_id_seq OWNED BY public.support_part_challans.id;


--
-- Name: support_part_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_part_requests (
    id integer NOT NULL,
    request_number character varying(30) NOT NULL,
    support_ticket_id integer NOT NULL,
    support_item_id integer,
    ttspl_id character varying(120),
    serial_number character varying(255),
    requested_by integer NOT NULL,
    assigned_to_tech integer,
    part_id integer NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    reason text,
    status character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    instance_id integer,
    challan_id integer,
    approved_by integer,
    approved_at timestamp with time zone,
    issued_at timestamp with time zone,
    used_at timestamp with time zone,
    return_requested_at timestamp with time zone,
    returned_at timestamp with time zone,
    returned_to integer,
    rejection_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reassign_to_ticket_id integer,
    reassign_to_item_id integer,
    reassign_to_ttspl_id character varying(120),
    reassign_to_serial character varying(255),
    reassign_reason text,
    reassign_requested_at timestamp with time zone,
    reassign_requested_by integer,
    CONSTRAINT support_part_requests_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('challan_generated'::character varying)::text, ('issued'::character varying)::text, ('used'::character varying)::text, ('return_requested'::character varying)::text, ('returned'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text])))
);


ALTER TABLE public.support_part_requests OWNER TO postgres;

--
-- Name: support_part_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_part_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_part_requests_id_seq OWNER TO postgres;

--
-- Name: support_part_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_part_requests_id_seq OWNED BY public.support_part_requests.id;


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
    pickup_completed_at timestamp with time zone,
    sales_order_number character varying(50),
    dc_number character varying(50),
    delivery_person_id integer,
    pickup_assigned_to integer,
    pickup_pod_path text,
    new_dc_number character varying(50)
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
    pickup_completed_at timestamp with time zone,
    visited_lat character varying(30),
    visited_lng character varying(30),
    ttspl_id character varying(120),
    ttspl_verified boolean DEFAULT false,
    ttspl_verified_at timestamp with time zone,
    ttspl_verified_by integer,
    reached_warehouse_at timestamp with time zone,
    warehouse_received_by integer,
    floor_ticket_id integer,
    proof_of_completion_path text,
    pickup_type character varying(20),
    customer_otp_code character varying(6),
    customer_otp_sent_at timestamp with time zone,
    customer_otp_verified_at timestamp with time zone,
    warehouse_received_at timestamp with time zone,
    warehouse_esign_url text,
    warehouse_esign_at timestamp with time zone,
    warehouse_esign_by integer,
    porter_tracking_id character varying(200),
    porter_order_id character varying(200),
    return_dc_number character varying(50),
    technician_esign_url text,
    technician_esign_at timestamp with time zone,
    technician_esign_by integer,
    CONSTRAINT support_ticket_items_pickup_type_check CHECK (((pickup_type IS NULL) OR ((pickup_type)::text = ANY (ARRAY[('repair'::character varying)::text, ('return'::character varying)::text]))))
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
    replaced_parts jsonb DEFAULT '[]'::jsonb NOT NULL,
    ttspl_id character varying(50),
    dc_number character varying(50),
    sales_order_number character varying(50),
    customer_portal_ticket boolean DEFAULT false,
    portal_customer_id integer,
    pickup_address jsonb
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
-- Name: ticket_part_blocks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_part_blocks (
    block_id integer NOT NULL,
    ticket_id integer NOT NULL,
    request_id integer NOT NULL,
    blocked_at timestamp with time zone DEFAULT now(),
    unblocked_at timestamp with time zone,
    is_active boolean DEFAULT true
);


ALTER TABLE public.ticket_part_blocks OWNER TO postgres;

--
-- Name: ticket_part_blocks_block_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ticket_part_blocks_block_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ticket_part_blocks_block_id_seq OWNER TO postgres;

--
-- Name: ticket_part_blocks_block_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ticket_part_blocks_block_id_seq OWNED BY public.ticket_part_blocks.block_id;


--
-- Name: ticket_parts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_parts (
    id integer NOT NULL,
    ticket_id integer,
    part_id integer,
    quantity_used integer NOT NULL,
    notes text,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    unit_cost numeric(10,2) DEFAULT 0,
    is_upgrade boolean DEFAULT false
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
    ttspl_id character varying(100),
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
    vendor_serial_id integer,
    ticket_type character varying(50) DEFAULT 'grn_qc'::character varying,
    qc_fail_count integer DEFAULT 0,
    qc1_failed_at timestamp with time zone,
    qc2_failed_at timestamp with time zone,
    qc1_fail_reason text,
    qc2_fail_reason text,
    qc1_passed_at timestamp with time zone,
    qc2_passed_at timestamp with time zone,
    body_paint_required boolean DEFAULT false,
    chip_repair_required boolean DEFAULT false,
    highlighted boolean DEFAULT false,
    highlighted_reason text,
    floor_manager_qc_failed boolean DEFAULT false,
    floor_manager_qc_failed_at timestamp with time zone,
    floor_manager_qc_fail_reason text,
    return_to_vendor_dc_number character varying(50),
    sales_order_id integer,
    sales_order_number character varying(50),
    open_part_requests integer DEFAULT 0,
    CONSTRAINT tickets_priority_check CHECK (((priority)::text = ANY (ARRAY[('low'::character varying)::text, ('normal'::character varying)::text, ('high'::character varying)::text, ('urgent'::character varying)::text]))),
    CONSTRAINT tickets_status_check CHECK (((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('on_hold'::character varying)::text, ('qc_failed_return_vendor'::character varying)::text, ('cancelled'::character varying)::text]))),
    CONSTRAINT tickets_ticket_type_check CHECK (((ticket_type)::text = ANY (ARRAY[('grn_qc'::character varying)::text, ('sales_order_qc'::character varying)::text, ('return_qc'::character varying)::text, ('support'::character varying)::text, ('general'::character varying)::text])))
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
-- Name: ttspl_audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ttspl_audit_log (
    log_id integer NOT NULL,
    ttspl_id character varying(50) NOT NULL,
    vendor_serial_id integer,
    event_type character varying(80) NOT NULL,
    description text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    actor_user_id integer,
    actor_name character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.ttspl_audit_log OWNER TO postgres;

--
-- Name: ttspl_audit_log_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ttspl_audit_log_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ttspl_audit_log_log_id_seq OWNER TO postgres;

--
-- Name: ttspl_audit_log_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ttspl_audit_log_log_id_seq OWNED BY public.ttspl_audit_log.log_id;


--
-- Name: ttspl_config_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ttspl_config_history (
    history_id integer NOT NULL,
    ttspl_id character varying(50) NOT NULL,
    vendor_serial_id integer,
    ticket_id integer,
    changed_by integer,
    change_type character varying(50) NOT NULL,
    field_name character varying(50) NOT NULL,
    old_value text,
    new_value text,
    notes text,
    part_used_id integer,
    part_cost numeric(10,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ttspl_config_history_change_type_check CHECK (((change_type)::text = ANY (ARRAY[('upgrade'::character varying)::text, ('replacement'::character varying)::text, ('correction'::character varying)::text, ('initial'::character varying)::text])))
);


ALTER TABLE public.ttspl_config_history OWNER TO postgres;

--
-- Name: ttspl_config_history_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ttspl_config_history_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ttspl_config_history_history_id_seq OWNER TO postgres;

--
-- Name: ttspl_config_history_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ttspl_config_history_history_id_seq OWNED BY public.ttspl_config_history.history_id;


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
    permissions text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(20) DEFAULT 'active'::character varying,
    user_type character varying(20) DEFAULT 'internal'::character varying,
    approved_by integer,
    approved_at timestamp without time zone,
    rejection_reason text,
    company_name character varying(255),
    gst_number character varying(50),
    mobile_no character varying(50),
    last_login timestamp with time zone,
    last_login_ip character varying(50),
    deactivated_at timestamp with time zone,
    deactivated_by integer,
    deactivation_reason text,
    profile_photo_url text,
    designation character varying(100),
    department character varying(100),
    employee_id character varying(50),
    joining_date date,
    notes text,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['super_admin'::character varying, 'admin'::character varying, 'manager'::character varying, 'team_member'::character varying, 'team_lead'::character varying, 'sales'::character varying, 'floor_manager'::character varying, 'procurement'::character varying, 'qc'::character varying, 'dispatch'::character varying, 'warehouse'::character varying, 'accounts'::character varying, 'support_lead'::character varying, 'support_tech'::character varying, 'dispatch_qc'::character varying, 'customer'::character varying, 'vendor'::character varying, 'technician'::character varying])::text[]))),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('pending_approval'::character varying)::text, ('rejected'::character varying)::text, ('blocked'::character varying)::text, ('inactive'::character varying)::text]))),
    CONSTRAINT users_user_type_check CHECK (((user_type)::text = ANY (ARRAY[('internal'::character varying)::text, ('customer'::character varying)::text, ('vendor'::character varying)::text, ('technician'::character varying)::text])))
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
-- Name: vendor_debit_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_debit_notes (
    debit_note_id integer NOT NULL,
    debit_note_number character varying(50) NOT NULL,
    vendor_id integer NOT NULL,
    po_id integer,
    reason character varying(255) NOT NULL,
    description text,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 0,
    unit_rate numeric(12,2) DEFAULT 0,
    ttspl_ids jsonb DEFAULT '[]'::jsonb,
    status character varying(20) DEFAULT 'pending'::character varying,
    adjusted_in_bill_id integer,
    created_by integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    serial_id integer,
    return_ticket_id integer,
    support_ticket_id integer,
    CONSTRAINT vendor_debit_notes_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('adjusted'::character varying)::text, ('cancelled'::character varying)::text])))
);


ALTER TABLE public.vendor_debit_notes OWNER TO postgres;

--
-- Name: COLUMN vendor_debit_notes.return_ticket_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.vendor_debit_notes.return_ticket_id IS 'Floor ticket whose Force-Fail returned the unit to the vendor';


--
-- Name: vendor_debit_notes_debit_note_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_debit_notes_debit_note_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_debit_notes_debit_note_id_seq OWNER TO postgres;

--
-- Name: vendor_debit_notes_debit_note_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_debit_notes_debit_note_id_seq OWNED BY public.vendor_debit_notes.debit_note_id;


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
    bill_status character varying(20) DEFAULT 'pending'::character varying,
    bill_files jsonb DEFAULT '[]'::jsonb NOT NULL,
    bill_name character varying(255),
    CONSTRAINT vendor_goods_received_notes_bill_status_check CHECK (((bill_status)::text = ANY (ARRAY[('pending'::character varying)::text, ('received'::character varying)::text]))),
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
-- Name: vendor_monthly_bills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_monthly_bills (
    bill_id integer NOT NULL,
    bill_number character varying(50) NOT NULL,
    vendor_id integer NOT NULL,
    bill_month integer NOT NULL,
    bill_year integer NOT NULL,
    bill_date date NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    subtotal numeric(12,2) DEFAULT 0,
    gst_amount numeric(12,2) DEFAULT 0,
    debit_note_adjustment numeric(12,2) DEFAULT 0,
    total_payable numeric(12,2) DEFAULT 0,
    status character varying(20) DEFAULT 'generated'::character varying,
    payment_date date,
    payment_reference character varying(100),
    notes text,
    generated_by integer,
    approved_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vendor_monthly_bills_status_check CHECK (((status)::text = ANY (ARRAY[('generated'::character varying)::text, ('approved'::character varying)::text, ('paid'::character varying)::text, ('disputed'::character varying)::text])))
);


ALTER TABLE public.vendor_monthly_bills OWNER TO postgres;

--
-- Name: vendor_monthly_bills_bill_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_monthly_bills_bill_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_monthly_bills_bill_id_seq OWNER TO postgres;

--
-- Name: vendor_monthly_bills_bill_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_monthly_bills_bill_id_seq OWNED BY public.vendor_monthly_bills.bill_id;


--
-- Name: vendor_portal_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_portal_sessions (
    session_id integer NOT NULL,
    vendor_id integer NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.vendor_portal_sessions OWNER TO postgres;

--
-- Name: vendor_portal_sessions_session_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_portal_sessions_session_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_portal_sessions_session_id_seq OWNER TO postgres;

--
-- Name: vendor_portal_sessions_session_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_portal_sessions_session_id_seq OWNED BY public.vendor_portal_sessions.session_id;


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
    bill_files jsonb DEFAULT '[]'::jsonb NOT NULL,
    expected_delivery_date date,
    rejection_reason text,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    sent_to_vendor_at timestamp with time zone,
    vendor_invoice_number character varying(100),
    vendor_invoice_file text,
    vendor_invoice_uploaded_at timestamp with time zone
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
    deleted_at timestamp with time zone,
    vendor_portal_password_hash text,
    vendor_portal_last_login timestamp with time zone,
    vendor_portal_enabled boolean DEFAULT true NOT NULL,
    po_payment_terms character varying(50) DEFAULT 'postpaid_monthly'::character varying,
    credit_days integer DEFAULT 1,
    pan_number character varying(20),
    msme_number character varying(50),
    contact_person_name character varying(255),
    contact_person_phone character varying(32),
    alternate_phone character varying(32),
    city character varying(100),
    pincode character varying(10),
    logo_url text,
    notes text
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
-- Name: asset_config_brands id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_brands ALTER COLUMN id SET DEFAULT nextval('public.asset_config_brands_id_seq'::regclass);


--
-- Name: asset_config_generations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_generations ALTER COLUMN id SET DEFAULT nextval('public.asset_config_generations_id_seq'::regclass);


--
-- Name: asset_config_gpu id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_gpu ALTER COLUMN id SET DEFAULT nextval('public.asset_config_gpu_id_seq'::regclass);


--
-- Name: asset_config_models id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_models ALTER COLUMN id SET DEFAULT nextval('public.asset_config_models_id_seq'::regclass);


--
-- Name: asset_config_processors id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_processors ALTER COLUMN id SET DEFAULT nextval('public.asset_config_processors_id_seq'::regclass);


--
-- Name: asset_config_ram id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_ram ALTER COLUMN id SET DEFAULT nextval('public.asset_config_ram_id_seq'::regclass);


--
-- Name: asset_config_screen_sizes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_screen_sizes ALTER COLUMN id SET DEFAULT nextval('public.asset_config_screen_sizes_id_seq'::regclass);


--
-- Name: asset_config_storage id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_storage ALTER COLUMN id SET DEFAULT nextval('public.asset_config_storage_id_seq'::regclass);


--
-- Name: chip_level_repairs repair_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chip_level_repairs ALTER COLUMN repair_id SET DEFAULT nextval('public.chip_level_repairs_repair_id_seq'::regclass);


--
-- Name: companies company_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies ALTER COLUMN company_id SET DEFAULT nextval('public.companies_company_id_seq'::regclass);


--
-- Name: customer_addresses customer_address_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_addresses ALTER COLUMN customer_address_id SET DEFAULT nextval('public.customer_addresses_customer_address_id_seq'::regclass);


--
-- Name: customer_credit_notes credit_note_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes ALTER COLUMN credit_note_id SET DEFAULT nextval('public.customer_credit_notes_credit_note_id_seq'::regclass);


--
-- Name: customer_documents doc_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_documents ALTER COLUMN doc_id SET DEFAULT nextval('public.customer_documents_doc_id_seq'::regclass);


--
-- Name: customer_inventory id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_inventory ALTER COLUMN id SET DEFAULT nextval('public.customer_inventory_id_seq'::regclass);


--
-- Name: customer_invoices invoice_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_invoices ALTER COLUMN invoice_id SET DEFAULT nextval('public.customer_invoices_invoice_id_seq'::regclass);


--
-- Name: customer_portal_sessions session_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_portal_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.customer_portal_sessions_session_id_seq'::regclass);


--
-- Name: customer_security_deposits deposit_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_security_deposits ALTER COLUMN deposit_id SET DEFAULT nextval('public.customer_security_deposits_deposit_id_seq'::regclass);


--
-- Name: customers customer_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers ALTER COLUMN customer_id SET DEFAULT nextval('public.customers_customer_id_seq'::regclass);


--
-- Name: dc_qc_tickets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_qc_tickets ALTER COLUMN id SET DEFAULT nextval('public.dc_qc_tickets_id_seq'::regclass);


--
-- Name: delivery_challan_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines ALTER COLUMN id SET DEFAULT nextval('public.delivery_challan_lines_id_seq'::regclass);


--
-- Name: delivery_technicians technician_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_technicians ALTER COLUMN technician_id SET DEFAULT nextval('public.delivery_technicians_technician_id_seq'::regclass);


--
-- Name: demo_agreements demo_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_agreements ALTER COLUMN demo_id SET DEFAULT nextval('public.demo_agreements_demo_id_seq'::regclass);


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
-- Name: einvoice_records record_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.einvoice_records ALTER COLUMN record_id SET DEFAULT nextval('public.einvoice_records_record_id_seq'::regclass);


--
-- Name: email_queue email_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_queue ALTER COLUMN email_id SET DEFAULT nextval('public.email_queue_email_id_seq'::regclass);


--
-- Name: eway_bill_records record_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.eway_bill_records ALTER COLUMN record_id SET DEFAULT nextval('public.eway_bill_records_record_id_seq'::regclass);


--
-- Name: grn_access_attempts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_access_attempts ALTER COLUMN id SET DEFAULT nextval('public.grn_access_attempts_id_seq'::regclass);


--
-- Name: grn_access_numbers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_access_numbers ALTER COLUMN id SET DEFAULT nextval('public.grn_access_numbers_id_seq'::regclass);


--
-- Name: grn_config_verifications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_config_verifications ALTER COLUMN id SET DEFAULT nextval('public.grn_config_verifications_id_seq'::regclass);


--
-- Name: inventory inventory_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory ALTER COLUMN inventory_id SET DEFAULT nextval('public.inventory_inventory_id_seq'::regclass);


--
-- Name: inventory_status_transitions transition_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_status_transitions ALTER COLUMN transition_id SET DEFAULT nextval('public.inventory_status_transitions_transition_id_seq'::regclass);


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
-- Name: lead_import_logs import_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_import_logs ALTER COLUMN import_id SET DEFAULT nextval('public.lead_import_logs_import_id_seq'::regclass);


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
-- Name: orders order_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders ALTER COLUMN order_id SET DEFAULT nextval('public.orders_order_id_seq'::regclass);


--
-- Name: part_instances instance_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_instances ALTER COLUMN instance_id SET DEFAULT nextval('public.part_instances_instance_id_seq'::regclass);


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
-- Name: sales_order_payments payment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_payments ALTER COLUMN payment_id SET DEFAULT nextval('public.sales_order_payments_payment_id_seq'::regclass);


--
-- Name: sales_order_serials allocation_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_serials ALTER COLUMN allocation_id SET DEFAULT nextval('public.sales_order_serials_allocation_id_seq'::regclass);


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
-- Name: stage_transition_rules rule_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_transition_rules ALTER COLUMN rule_id SET DEFAULT nextval('public.stage_transition_rules_rule_id_seq'::regclass);


--
-- Name: stages stage_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stages ALTER COLUMN stage_id SET DEFAULT nextval('public.stages_stage_id_seq'::regclass);


--
-- Name: support_challan_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_challan_items ALTER COLUMN id SET DEFAULT nextval('public.support_challan_items_id_seq'::regclass);


--
-- Name: support_issue_categories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_issue_categories ALTER COLUMN id SET DEFAULT nextval('public.support_issue_categories_id_seq'::regclass);


--
-- Name: support_part_challans id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_challans ALTER COLUMN id SET DEFAULT nextval('public.support_part_challans_id_seq'::regclass);


--
-- Name: support_part_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests ALTER COLUMN id SET DEFAULT nextval('public.support_part_requests_id_seq'::regclass);


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
-- Name: ticket_part_blocks block_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_part_blocks ALTER COLUMN block_id SET DEFAULT nextval('public.ticket_part_blocks_block_id_seq'::regclass);


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
-- Name: ttspl_audit_log log_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_audit_log ALTER COLUMN log_id SET DEFAULT nextval('public.ttspl_audit_log_log_id_seq'::regclass);


--
-- Name: ttspl_config_history history_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_config_history ALTER COLUMN history_id SET DEFAULT nextval('public.ttspl_config_history_history_id_seq'::regclass);


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
-- Name: vendor_debit_notes debit_note_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_debit_notes ALTER COLUMN debit_note_id SET DEFAULT nextval('public.vendor_debit_notes_debit_note_id_seq'::regclass);


--
-- Name: vendor_goods_received_notes grn_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_goods_received_notes ALTER COLUMN grn_id SET DEFAULT nextval('public.vendor_goods_received_notes_grn_id_seq'::regclass);


--
-- Name: vendor_monthly_bills bill_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_monthly_bills ALTER COLUMN bill_id SET DEFAULT nextval('public.vendor_monthly_bills_bill_id_seq'::regclass);


--
-- Name: vendor_portal_sessions session_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_portal_sessions ALTER COLUMN session_id SET DEFAULT nextval('public.vendor_portal_sessions_session_id_seq'::regclass);


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
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.audit_log_entries (instance_id, id, payload, created_at, ip_address) FROM stdin;
\.


--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.custom_oauth_providers (id, provider_type, identifier, name, client_id, client_secret, acceptable_client_ids, scopes, pkce_enabled, attribute_mapping, authorization_params, enabled, email_optional, issuer, discovery_url, skip_nonce_check, cached_discovery, discovery_cached_at, authorization_url, token_url, userinfo_url, jwks_uri, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.flow_state (id, user_id, auth_code, code_challenge_method, code_challenge, provider_type, provider_access_token, provider_refresh_token, created_at, updated_at, authentication_method, auth_code_issued_at, invite_token, referrer, oauth_client_state_id, linking_target_id, email_optional) FROM stdin;
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id) FROM stdin;
\.


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.instances (id, uuid, raw_base_config, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) FROM stdin;
\.


--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.mfa_challenges (id, factor_id, created_at, verified_at, ip_address, otp_code, web_authn_session_data) FROM stdin;
\.


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret, phone, last_challenged_at, web_authn_credential, web_authn_aaguid, last_webauthn_challenge_data) FROM stdin;
\.


--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope, state, resource, code_challenge, code_challenge_method, response_type, status, authorization_code, created_at, expires_at, approved_at, nonce) FROM stdin;
\.


--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.oauth_client_states (id, provider_type, code_verifier, created_at) FROM stdin;
\.


--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.oauth_clients (id, client_secret_hash, registration_type, redirect_uris, grant_types, client_name, client_uri, logo_uri, created_at, updated_at, deleted_at, client_type, token_endpoint_auth_method) FROM stdin;
\.


--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.oauth_consents (id, user_id, client_id, scopes, granted_at, revoked_at) FROM stdin;
\.


--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.refresh_tokens (instance_id, id, token, user_id, revoked, created_at, updated_at, parent, session_id) FROM stdin;
\.


--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.saml_providers (id, sso_provider_id, entity_id, metadata_xml, metadata_url, attribute_mapping, created_at, updated_at, name_id_format) FROM stdin;
\.


--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.saml_relay_states (id, sso_provider_id, request_id, for_email, redirect_to, created_at, updated_at, flow_state_id) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.schema_migrations (version) FROM stdin;
20171026211738
20171026211808
20171026211834
20180103212743
20180108183307
20180119214651
20180125194653
00
20210710035447
20210722035447
20210730183235
20210909172000
20210927181326
20211122151130
20211124214934
20211202183645
20220114185221
20220114185340
20220224000811
20220323170000
20220429102000
20220531120530
20220614074223
20220811173540
20221003041349
20221003041400
20221011041400
20221020193600
20221021073300
20221021082433
20221027105023
20221114143122
20221114143410
20221125140132
20221208132122
20221215195500
20221215195800
20221215195900
20230116124310
20230116124412
20230131181311
20230322519590
20230402418590
20230411005111
20230508135423
20230523124323
20230818113222
20230914180801
20231027141322
20231114161723
20231117164230
20240115144230
20240214120130
20240306115329
20240314092811
20240427152123
20240612123726
20240729123726
20240802193726
20240806073726
20241009103726
20250717082212
20250731150234
20250804100000
20250901200500
20250903112500
20250904133000
20250925093508
20251007112900
20251104100000
20251111201300
20251201000000
20260115000000
20260121000000
20260219120000
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.sessions (id, user_id, created_at, updated_at, factor_id, aal, not_after, refreshed_at, user_agent, ip, tag, oauth_client_id, refresh_token_hmac_key, refresh_token_counter, scopes) FROM stdin;
\.


--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.sso_domains (id, sso_provider_id, domain, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.sso_providers (id, resource_id, created_at, updated_at, disabled) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: postgres
--

COPY auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous) FROM stdin;
\.


--
-- Data for Name: activities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.activities (activity_id, ticket_id, stage_id, user_id, action, notes, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: allocation_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.allocation_logs (id, vendor_id, vendor_name, serial_number, unique_id, action_taken, remarks, qc_status, in_ward, out_ward, extra, created_at, user_id, customer_id, customer_name, challan_id, product_id, model_name, old_serial_number, po_type, purchase_type, locking_period, added_date, failure_reason, checked_by, assigned_to, warranty_status, rental_status, extra_details, require_parts, file_path, log_type, updated_at) FROM stdin;
\.


--
-- Data for Name: asset_config_brands; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_brands (id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: asset_config_generations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_generations (id, processor_id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: asset_config_gpu; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_gpu (id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: asset_config_models; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_models (id, brand_id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: asset_config_processors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_processors (id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: asset_config_ram; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_ram (id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: asset_config_screen_sizes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_screen_sizes (id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: asset_config_storage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_config_storage (id, name, status, created_at, updated_at, created_by, updated_by, deleted_at) FROM stdin;
\.


--
-- Data for Name: chip_level_repairs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.chip_level_repairs (repair_id, ticket_id, created_by, updated_by, status, issues, issue_notes, parts_required, parts_notes, resolved_checks, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.companies (company_id, code, legal_name, gstin, pan, address, state_code, hsn_code, logo_url, dc_prefix, invoice_prefix, active, created_at, updated_at, email, phone) FROM stdin;
\.


--
-- Data for Name: customer_addresses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_addresses (customer_address_id, customer_id, concern_person, mobile_no, address, pincode, is_head_office, source_lead_address_id, address_type, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: customer_credit_notes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_credit_notes (credit_note_id, credit_note_number, customer_id, invoice_id, reason, description, amount, quantity, unit_rate, from_date, to_date, ttspl_ids, status, applied_in_invoice_id, created_by, approved_by, created_at, updated_at, serial_id, return_ticket_id, source) FROM stdin;
\.


--
-- Data for Name: customer_documents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_documents (doc_id, customer_id, lead_id, doc_type, doc_label, file_path, file_name, file_size_bytes, uploaded_by, is_signed, notes, created_at) FROM stdin;
\.


--
-- Data for Name: customer_inventory; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_inventory (id, customer_id, asset_kind, asset_bucket, delivery_challan_id, dc_number, delivery_date, erp_serial_id, serial_number, unique_serial_number, model_name, generation, screen_size, ram, storage, gpu, processor, quotation_type, rate, locking_period, delivery_status, delivery_type, courier_name, awb_number, sales_status, documents, erp_raw, synced_at, created_at, updated_at, passivated_at, passivated_reason, deprecated) FROM stdin;
\.


--
-- Data for Name: customer_invoices; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_invoices (invoice_id, invoice_number, customer_id, invoice_month, invoice_year, invoice_date, from_date, to_date, line_items, subtotal, gst_percent, gst_amount, credit_note_adjustment, security_deposit, grand_total, status, irn, irn_generated_at, qr_code_url, signed_qr_code, eway_bill_number, eway_bill_valid_till, pdf_path, sent_at, sent_by, paid_at, payment_reference, notes, created_at, updated_at, entity_code) FROM stdin;
\.


--
-- Data for Name: customer_portal_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_portal_sessions (session_id, customer_id, token, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: customer_security_deposits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_security_deposits (deposit_id, customer_id, sales_order_number, amount, received_date, status, refund_amount, refund_date, refund_reference, notes, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customers (customer_id, name, email, phone, gst_no, type, details, address, created_at, updated_at, status, company_name, pan_number, company_type, company_size, industry, billing_address, billing_city, billing_state, billing_pincode, shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode, whatsapp_number, designation, source_lead_stage, onboarded_by, onboarded_at, portal_enabled, notes, kyc_verified, kyc_verified_by, kyc_verified_at, source_lead_id, portal_password_hash, portal_last_login, kyc_status, kyc_documents) FROM stdin;
\.


--
-- Data for Name: dc_qc_tickets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.dc_qc_tickets (id, dc_number, sales_order_number, ticket_id, ttspl_id, serial_id, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: delivery_challan_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.delivery_challan_lines (id, dc_number, sales_order_number, quotation_number, customer_id, customer_name, email, gst_number, supply_state, security_amount, shiping_charges, branch, customer_billing_address, customer_shipping_address, brand, model_name, quantity, main_qty, serial_number, ship_by, courier_name, awb_number, delivery_person_id, remarks, status, pdf_path, file_path, delivered_serial_numbers, rejected_serial_numbers, pickuped_serial_numbers, submitted_remark, submitted_name, submitted_person_id, submitted_person_type, created_by, created_at, updated_at, d_otp, d_otp_verified_at, d_customer_name, d_customer_email, d_customer_mobile, delivery_completed_at, date_and_time, latitude, longitude, old_rejected_serial_numbers, returned_serial_numbers, dispatch_mode, porter_booking_id, estimated_delivery, pre_dispatch_qc_ticket_id, pre_dispatch_qc_passed, irn, irn_generated_at, qr_code_url, eway_bill_number, eway_bill_valid_till, invoice_sent_at, invoice_sent_by, delivered_at, delivered_by, delivery_location, delivery_otp, delivery_otp_sent_at, pod_image_url, rejection_reason, entity_code, porter_tracking_id, porter_order_id, porter_booking_url, courier_tracking_url, dispatched_at, reached_at, tech_latitude, tech_longitude, serial_verified_at, serial_verified_no, otp_code, otp_sent_at, otp_verified_at, pod_photo_url, esign_url, pod_submitted_at, pod_submitted_by, pod_type, delivery_notes, movement_type, support_ticket_id, original_dc_number) FROM stdin;
\.


--
-- Data for Name: delivery_technicians; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.delivery_technicians (technician_id, user_id, first_name, last_name, phone, email, is_active, created_at, updated_at, country_code, address, identity_type, identity_number, identity_image, image, password_hash) FROM stdin;
\.


--
-- Data for Name: demo_agreements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.demo_agreements (demo_id, sales_order_number, dc_number, customer_id, serial_id, ttspl_id, delivered_at, decision_due_at, decision, decided_at, decided_by, rent_start_date, pickup_ticket_id, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: diagnosis_images; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.diagnosis_images (image_id, diagnosis_id, section_name, image_path, uploaded_at) FROM stdin;
\.


--
-- Data for Name: diagnosis_parts_required; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.diagnosis_parts_required (id, diagnosis_id, ticket_id, part_name, part_category, quantity, is_available, inventory_part_id, status, attached_by, attached_at, created_at) FROM stdin;
\.


--
-- Data for Name: diagnosis_results; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.diagnosis_results (diagnosis_id, ticket_id, diagnosed_by, diagnosed_at, power_on, power_button_working, boots_successfully, bios_accessible, bios_password_lock, display_on, brightness_control, no_flickering, no_lines_spots, webcam_working, all_keys_working, touchpad_working, left_click_working, right_click_working, battery_detected, battery_charging, charging_port_tight, battery_swollen, storage_detected, smart_status_ok, no_bad_sectors, ram_detected, correct_capacity, slot_1_working, slot_2_working, wifi_detected, wifi_connecting, bluetooth_working, usb_ports, type_c, hdmi, audio_jack, power_port, fan_spinning, no_abnormal_noise, heating_normal, no_short, no_rust_liquid, no_ic_heating, bios_unlocked, hdd_unlocked, no_mdm_computrace, power_issue_flag, display_replacement_required, keyboard_replacement_required, battery_replacement_required, storage_replacement_required, ram_slot_fault, network_card_check, port_repair_required, cleaning_paste_required, chip_level_repair_required, security_hold, total_failures, next_team, remarks, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: einvoice_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.einvoice_records (record_id, dc_number, invoice_id, customer_id, invoice_number, irn, ack_number, ack_date, signed_invoice, signed_qr_code, qr_code_image_url, status, cancelled_at, cancel_reason, zoho_response, generated_by, created_at) FROM stdin;
\.


--
-- Data for Name: email_queue; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.email_queue (email_id, to_email, subject, body_text, body_html, dedupe_key, status, attempts, max_attempts, scheduled_at, sent_at, last_error, created_at) FROM stdin;
\.


--
-- Data for Name: eway_bill_records; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.eway_bill_records (record_id, dc_number, ewb_number, ewb_date, valid_upto, transporter_id, transporter_name, vehicle_number, mode_of_transport, distance_km, status, zoho_response, generated_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: existing_customer; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.existing_customer (customer_id, customer_name, contact_person_name, contact_person_number, customer_number, email, billing_address, shipping_address, erp_raw, synced_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: grn_access_attempts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grn_access_attempts (id, access_number, access_id, success, result, ip, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: grn_access_numbers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grn_access_numbers (id, access_number, capture_url, capture_token, po_id, status, created_by, created_at, used_at, expires_at) FROM stdin;
\.


--
-- Data for Name: grn_config_verifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grn_config_verifications (id, token_id, po_id, line_index, expected_config, actual_config, matched_fields, mismatched_fields, configuration_matched, ip, created_at) FROM stdin;
\.


--
-- Data for Name: grn_serial_capture_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grn_serial_capture_tokens (token_id, po_id, line_index, unit_index, total_units, serial_number, status, created_by, expires_at, captured_at, used_at, created_at, config_verified, config_verified_at, actual_config, config_check) FROM stdin;
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory (inventory_id, stock_type, device_type, machine_number, serial_number, brand, model, processor, ram, storage, grade, status, stage, created_at, updated_at, generation, gpu, screen_size) FROM stdin;
\.


--
-- Data for Name: inventory_status_transitions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_status_transitions (transition_id, serial_id, ttspl_id, from_status, to_status, reason, dc_number, customer_id, entity_code, actor_user_id, created_at) FROM stdin;
\.


--
-- Data for Name: inward_outward; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inward_outward (id, serial_number, unique_number, product_type, transaction_type, meta, created_at) FROM stdin;
\.


--
-- Data for Name: laptop_catalog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.laptop_catalog (catalog_id, brand, model, processor, generation, ram, storage, device_type, active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lead_activities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_activities (activity_id, lead_id, user_id, action, status_from, status_to, notes, created_at, stage_from, stage_to) FROM stdin;
1	1	4	lead_created	\N	\N	Lead created	2026-06-23 05:36:04.015+00	\N	\N
\.


--
-- Data for Name: lead_addresses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_addresses (address_id, lead_id, concern_person, mobile_no, address, pincode, address_type, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: lead_assignments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_assignments (assignment_id, lead_id, assigned_to, assigned_by, assigned_at, batch_id) FROM stdin;
1	1	4	4	2026-06-23 05:36:03.985+00	\N
\.


--
-- Data for Name: lead_auto_assign_config; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_auto_assign_config (id, user_ids, round_robin_index, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: lead_company_research; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_company_research (research_id, lead_id, cin, entity_type, roc, revenue, employees, gst, address, city, state, raw_response, researched_at, industry, pincode) FROM stdin;
1	1	Unknown	Unknown	Unknown	Unknown	Unknown	Unknown	Unknown	Unknown	Unknown	{"cin": "Unknown", "gst": "Unknown", "roc": "Unknown", "city": "Unknown", "state": "Unknown", "address": "Unknown", "pincode": "Unknown", "revenue": "Unknown", "summary": "Research unavailable for \\"kjnckjn Lenovo\\". Add details manually.", "website": "", "industry": "Unknown", "employees": "Unknown", "departments": [], "entity_type": "Unknown", "twitter_url": "", "facebook_url": "", "linkedin_url": "", "technologies": [], "subsidiary_of": "Unknown", "total_funding": "Unknown", "annual_revenue": "Unknown", "latest_funding": "Unknown", "latest_funding_amount": "Unknown"}	2026-06-23 05:36:04.348+00	Unknown	Unknown
\.


--
-- Data for Name: lead_followup_notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_followup_notifications (notification_id, lead_id, follow_up_at, recipient_email, channel, notified_at) FROM stdin;
\.


--
-- Data for Name: lead_import_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_import_logs (import_id, imported_by, total_rows, imported, duplicates, errors, error_details, created_at) FROM stdin;
\.


--
-- Data for Name: lead_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_orders (lead_order_id, lead_id, order_status, amount, details, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: lead_remarks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lead_remarks (remark_id, lead_id, user_id, note, created_at) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.leads (lead_id, name, company_name, email, phone, city, source, status, assigned_user_id, assigned_by, assigned_at, follow_up_date, is_duplicate, duplicate_of, rejection_reason, research_status, research_requested_at, created_at, updated_at, lead_stage, quotation_accept_token, quotation_accepted_at, quotation_last_sent_at, quotation_last_estimate_no, quotation_last_to_email, whatsapp_number, designation, quantity_required, monthly_budget, rental_duration, use_case, company_type, company_size, industry, annual_revenue, pan_number, gst_number, state, pincode, billing_address, shipping_same_as_billing, shipping_address, follow_up_time, converted_at, converted_by, customer_id, inquiry_type, last_activity_at, company_brand, brand, processor, generation, ram, storage, personal_remarks) FROM stdin;
1	ncdskj	kjnckjn	nursid@rentfoxxy.com	8389723897	gurvskdj	IndiaMART	Pending	4	4	2026-06-23 05:36:03.985+00	2026-06-23 00:00:00+00	f	\N	\N	failed	2026-06-23 05:36:04.365+00	2026-06-23 05:36:03.986+00	2026-06-23 05:50:59.652822+00	\N	\N	\N	\N	\N	\N	cjcsd	kjcsdkj	2	1299.00	12	Work From Office	Pvt Ltd	20	IT	10000	fnjdsnc39	kjdnsjk31921	Andhra Pradesh	89983298	\N	t	\N	11:05:00	\N	\N	\N	rental	2026-06-23 05:36:04.019598+00	jnns	Lenovo	AMD Ryzen 5	9th Gen	24 GB	128 GB SSD	cdsc
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_items (item_id, order_id, brand, processor, ram, storage, quantity, preferred_model, status, inventory_id, unit_price, gst_percent, gst_amount, total_with_gst, created_at, qc_passed, is_wfh, shipping_charge, estimate_id, destination_pincode, tracking_status, item_tracker_id, item_courier_partner, item_dispatch_date, item_estimated_delivery, delivered_at, proposed_delivery_date, qc_sales_checklist, qc_sales_passed_at) FROM stdin;
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.orders (order_id, customer_id, lead_type, order_type, status, owner_user_id, lockin_period_days, security_amount, is_wfh, shipping_charge, shipping_gst_amount, subtotal_amount, items_gst_amount, grand_total_amount, invoice_number, invoice_generated_at, eway_bill_number, eway_bill_generated_at, delivery_date, shipping_address, dispatch_date, tracker_id, courier_partner, dispatched_at, estimated_delivery, qc_received_at, qc_completed_at, created_at, updated_at, cancelled_at, cancelled_by) FROM stdin;
\.


--
-- Data for Name: part_instances; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part_instances (instance_id, prt_id, part_id, spo_id, grn_id, batch_number, unit_cost, status, location_code, installed_ttspl_id, installed_ticket_id, installed_at, removed_at, condition_on_removal, notes, received_at, received_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: part_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.part_requests (request_id, ticket_id, requested_by, part_name, description, status, created_at, updated_at, request_number, request_type, part_id, quantity, stage_name, ticket_stage_id, config_field, old_value, new_value, blocks_stage, approved_by, approved_at, rejection_reason, escalated_by, escalated_at, spo_id, instance_id, attached_at, attached_by, old_part_returned, old_part_returned_at, old_part_condition, old_part_notes) FROM stdin;
\.


--
-- Data for Name: parts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.parts (part_id, part_name, part_type, quantity, vendor, cost, location_code, created_at, min_threshold, description, category, part_sku, compatible_brands, compatible_models, is_consumable, warranty_months, notes, archived, updated_at) FROM stdin;
\.


--
-- Data for Name: permission_audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permission_audit_logs (id, actor_user_id, target_type, target_id, action, payload, created_at) FROM stdin;
1	2	role_permissions	warehouse	role_permissions_updated	{"count": 62}	2026-06-15 07:27:49.40042+00
2	2	role_permissions	warehouse	role_permissions_updated	{"count": 62}	2026-06-15 07:31:25.284508+00
3	2	role_permissions	sales	role_permissions_updated	{"count": 62}	2026-06-15 07:57:56.535865+00
4	2	role_permissions	sales	role_permissions_updated	{"count": 62}	2026-06-15 07:59:36.120739+00
5	2	role_permissions	sales	role_permissions_updated	{"count": 62}	2026-06-15 08:04:58.930056+00
6	2	user_permissions	16	user_permissions_updated	{"count": 0}	2026-06-15 17:42:39.137197+00
7	2	user_permissions	16	user_permissions_updated	{"count": 0}	2026-06-15 17:44:16.411471+00
8	2	user_permissions	16	user_permissions_updated	{"count": 1}	2026-06-15 17:44:35.448685+00
9	2	user_permissions	16	user_permissions_updated	{"count": 1}	2026-06-15 17:44:42.058236+00
10	2	role_permissions	sales	role_permissions_updated	{"count": 62}	2026-06-16 04:20:05.580832+00
11	2	user_permissions	16	user_permissions_updated	{"count": 1}	2026-06-16 04:21:13.767553+00
12	2	user_permissions	2	user_permissions_reset	{"removed": []}	2026-06-16 04:22:15.41481+00
13	2	role_permissions	sales	role_permissions_updated	{"count": 62}	2026-06-17 12:13:34.154231+00
14	2	user_permissions	5	user_permissions_updated	{"count": 1}	2026-06-18 20:07:59.950582+00
15	2	user_permissions	5	user_permissions_updated	{"count": 1}	2026-06-18 20:08:16.452749+00
16	2	role_permissions	admin	role_permissions_updated	{"count": 69}	2026-06-22 05:00:35.463594+00
17	2	role	dispatch_qc	role_created	{"id": 198, "name": "dispatch_qc", "created_at": "2026-06-22T06:09:09.173Z", "updated_at": "2026-06-22T06:09:09.173Z", "description": null, "display_name": "Dispatch QC", "is_system_role": false}	2026-06-22 06:09:09.179468+00
18	2	role	dispatch_qc	role_updated	{"id": 198, "name": "dispatch_qc", "created_at": "2026-06-22T06:09:09.173Z", "updated_at": "2026-06-22T06:09:41.148Z", "description": "Dispatch QC", "display_name": "Dispatch QC", "is_system_role": false}	2026-06-22 06:09:41.149453+00
19	2	role_permissions	dispatch_qc	role_permissions_updated	{"count": 69}	2026-06-22 06:13:07.093774+00
20	1	role_permissions	dispatch_qc	role_permissions_updated	{"count": 69}	2026-06-22 06:45:20.16991+00
21	2	role_permissions	dispatch_qc	role_permissions_updated	{"count": 69}	2026-06-22 07:43:40.810814+00
22	2	role_permissions	admin	role_permissions_updated	{"count": 70}	2026-06-22 12:35:42.396374+00
23	2	role_permissions	support_tech	role_permissions_updated	{"count": 70}	2026-06-22 12:47:52.525087+00
\.


--
-- Data for Name: permission_sections; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permission_sections (id, section, description, sort_order, created_at) FROM stdin;
5	catalogue	Product catalogue	50	2026-06-11 14:20:28.184433+00
6	orders	Orders	60	2026-06-11 14:20:28.184433+00
10	permissions	Roles and permissions	100	2026-06-11 14:20:28.184433+00
11	invoices	Invoices	110	2026-06-11 14:20:28.184433+00
42	technicians_bucket_list	Technicians bucket list	50	2026-06-11 14:20:33.995238+00
897	analytics_dashboard	Analytics Dashboard	11	2026-06-11 22:58:39.705514+00
956	lead_follow_ups	Follow-ups	41	2026-06-12 08:41:51.15297+00
173	lead_conversion	Lead Conversion	45	2026-06-11 17:40:40.592348+00
174	customer_documents	Customer Documents	85	2026-06-11 17:40:40.592348+00
41	delivery_register_management	Delivery Register	175	2026-06-11 14:20:32.640469+00
123	floor_pipeline	Floor Pipeline	25	2026-06-11 17:16:47.4941+00
124	floor_tickets	Floor Tickets	26	2026-06-11 17:16:47.4941+00
125	chip_level_repair	Chip Level Repair	27	2026-06-11 17:16:47.4941+00
126	parts_inventory	Parts Inventory	28	2026-06-11 17:16:47.4941+00
127	ttspl_history	TTSPL History	29	2026-06-11 17:16:47.4941+00
975	reports_access	Reports Access	402	2026-06-12 08:41:51.15297+00
898	reports_export	Export Reports	403	2026-06-11 22:58:39.705514+00
1237	customer_assets	Customer Assets (held inventory)	86	2026-06-12 21:54:37.988812+00
9	users	User Management	350	2026-06-11 14:20:28.184433+00
1238	kyc_management	Customer KYC	87	2026-06-12 21:54:37.988812+00
1239	demo_management	Demo Agreements	56	2026-06-12 21:54:37.988812+00
1240	company_settings	Company / Entity Settings	360	2026-06-12 21:54:37.988812+00
1782	parts_requests	Part Requests (Floor)	280	2026-06-19 06:46:54.060663+00
1783	parts_approval	Part Request Approval (Warehouse)	281	2026-06-19 06:46:54.060663+00
1784	parts_procurement	Parts Procurement	282	2026-06-19 06:46:54.060663+00
2218	support_part_requests	Support Part Requests (Field)	325	2026-06-20 20:17:09.308342+00
2219	support_part_challan	Support Part Challans (Warehouse)	326	2026-06-20 20:17:09.308342+00
40	customer_management	Customer management (ERP)	49	2026-06-11 14:20:30.959075+00
465	customer_billing	Customer Billing & Invoices	200	2026-06-11 21:17:47.998082+00
3476	asset_configuration	Asset Configuration	136	2026-06-22 12:36:30.633526+00
1709	technician_bucket	Delivery Technician (bucket & field deliveries)	177	2026-06-18 19:15:37.838434+00
2127	support_technician	Support Technician (field view)	321	2026-06-20 17:54:41.552268+00
466	vendor_billing_mgmt	Vendor Billing Management	201	2026-06-11 21:17:47.998082+00
467	credit_notes	Customer Credit Notes	202	2026-06-11 21:17:47.998082+00
468	debit_notes	Vendor Debit Notes	203	2026-06-11 21:17:47.998082+00
469	security_deposits	Security Deposits	204	2026-06-11 21:17:47.998082+00
470	billing_dashboard	Billing Dashboard & Reports	205	2026-06-11 21:17:47.998082+00
35	sales_quotations	Sales quotations (EST)	45	2026-06-11 14:20:29.301392+00
12	dashboard	Dashboard	10	2026-06-11 14:20:28.737665+00
36	sales_orders_doc	Sales order documents (SO)	46	2026-06-11 14:20:29.301392+00
37	delivery_challans	Delivery challans (DC)	47	2026-06-11 14:20:29.301392+00
38	return_dc	Return delivery challans	48	2026-06-11 14:20:29.301392+00
2	inventory	Inventory	20	2026-06-11 14:20:28.184433+00
1	tickets	Tickets	30	2026-06-11 14:20:28.184433+00
15	leads	Leads	40	2026-06-11 14:20:28.737665+00
16	sales_orders	Sales Orders	50	2026-06-11 14:20:28.737665+00
17	follow_ups	Follow Ups	60	2026-06-11 14:20:28.737665+00
18	lead_orders	Lead Orders	70	2026-06-11 14:20:28.737665+00
3	customers	Customers	80	2026-06-11 14:20:28.184433+00
20	manager_dashboard	Manager Dashboard	90	2026-06-11 14:20:28.737665+00
4	reports	Reports	100	2026-06-11 14:20:28.184433+00
22	parts	Parts	110	2026-06-11 14:20:28.737665+00
39	operation_management	Operation Management	44	2026-06-11 14:20:29.857466+00
8	procurement	Procurement	120	2026-06-11 14:20:28.184433+00
24	vendor_management	Vendor Management	130	2026-06-11 14:20:28.737665+00
25	warehouse	Warehouse	140	2026-06-11 14:20:28.737665+00
589	support_settings	Support Module Settings	301	2026-06-11 22:11:15.910377+00
297	sales_pipeline	Sales Pipeline (Quotations, SOs, DCs)	55	2026-06-11 19:30:41.740308+00
298	payment_records	Payment Recording	56	2026-06-11 19:30:41.740308+00
299	einvoice_ewb	E-Invoice and E-Way Bill	57	2026-06-11 19:30:41.740308+00
300	dispatch_ops	Dispatch Operations	175	2026-06-11 19:30:41.740308+00
26	qc_management	QC Management	150	2026-06-11 14:20:28.737665+00
27	inventory_management	Inventory Management	160	2026-06-11 14:20:28.737665+00
7	dispatch	Dispatch	170	2026-06-11 14:20:28.184433+00
29	support_tickets	Support Tickets	180	2026-06-11 14:20:28.737665+00
30	customer_inventory	Customer Inventory	190	2026-06-11 14:20:28.737665+00
31	teams	Teams	200	2026-06-11 14:20:28.737665+00
32	roles	Roles	210	2026-06-11 14:20:28.737665+00
33	role_permissions	Role Permissions	220	2026-06-11 14:20:28.737665+00
34	user_permissions	User Permissions	230	2026-06-11 14:20:28.737665+00
\.


--
-- Data for Name: photos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.photos (photo_id, ticket_id, stage_id, photo_url, photo_type, uploaded_by, uploaded_at) FROM stdin;
\.


--
-- Data for Name: procurement_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.procurement_requests (request_id, order_item_id, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: qc_photos; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.qc_photos (photo_id, qc_id, photo_path, uploaded_at) FROM stdin;
\.


--
-- Data for Name: qc_results; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.qc_results (qc_id, ticket_id, qc_stage, processor, generation, storage_type, ram_size, checklist_data, parts_replaced, replaced_parts, qc_result, failure_reasons, remarks, final_grade, grade_notes, tested_by, checked_by, qc_date, dispatch_date, is_locked, created_at, submitted_at) FROM stdin;
\.


--
-- Data for Name: qc_round_robin_state; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.qc_round_robin_state (team_id, last_assigned_user_id, updated_at) FROM stdin;
9	\N	2026-06-14 11:57:00.158718+00
10	9	2026-06-22 07:42:49.262759+00
\.


--
-- Data for Name: rent_devices; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rent_devices (id, serial_id, po_id, dc_number, serial_number, unique_number, product_id, rent_start_date, rent_end_date, rent_amount, month_rent, rent_with_gst, total_amount, vendor_id, type, status, customer_id, rent_stop_date, rent_start_date_again, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: repair_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.repair_logs (id, serial_number_id, serial_number, unique_number, new_serial_number, new_unique_number, repair_start_date, repair_end_date, type, remarks, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permissions (id, role, section, can_view, can_create, can_edit, can_delete) FROM stdin;
1	technician	tickets	t	t	t	f
2	technician	inventory	t	f	f	f
3	technician	customers	t	f	f	f
4	vendor	catalogue	t	t	t	t
5	vendor	orders	t	f	f	f
6	customer	tickets	t	t	f	f
7	customer	invoices	t	f	f	f
5630	manager	customer_assets	t	f	f	f
5632	support_lead	customer_assets	t	f	f	f
5634	accounts	customer_assets	t	f	f	f
5636	manager	kyc_management	t	t	t	f
19	vendor	sales_orders	t	f	f	f
21	vendor	lead_orders	t	f	f	f
5639	manager	demo_management	t	t	t	f
23	vendor	vendor_management	t	t	t	t
56	manager	dashboard	t	f	f	f
57	manager	inventory	t	t	t	t
58	manager	tickets	t	t	t	t
59	manager	leads	t	t	t	t
60	manager	sales_orders	t	t	t	t
61	manager	follow_ups	t	t	t	t
62	manager	lead_orders	t	t	t	t
63	manager	customers	t	t	t	t
64	manager	manager_dashboard	t	f	f	f
65	manager	reports	t	f	f	f
66	manager	parts	t	t	t	t
67	manager	procurement	t	t	t	t
68	manager	vendor_management	t	t	t	t
69	manager	warehouse	t	t	t	t
70	manager	qc_management	t	t	t	t
71	manager	inventory_management	t	t	t	t
72	manager	dispatch	t	t	t	t
73	manager	support_tickets	t	t	t	t
74	manager	customer_inventory	t	t	t	t
75	manager	teams	t	t	t	f
82	floor_manager	dashboard	t	f	f	f
83	floor_manager	inventory	t	t	t	f
84	floor_manager	tickets	t	t	t	f
85	floor_manager	reports	t	f	f	f
86	floor_manager	parts	t	t	t	f
87	floor_manager	qc_management	t	t	t	f
88	floor_manager	inventory_management	t	t	t	f
89	floor_manager	dispatch	t	t	t	f
90	floor_manager	customer_inventory	t	t	f	f
91	procurement	procurement	t	t	t	t
92	procurement	vendor_management	t	t	t	t
93	qc	qc_management	t	t	t	f
95	dispatch	dispatch	t	t	t	t
96	support_lead	support_tickets	t	t	t	t
97	support_lead	customer_inventory	t	t	t	f
100	team_member	dashboard	t	f	f	f
101	team_member	tickets	t	t	t	f
102	team_lead	dashboard	t	f	f	f
103	team_lead	tickets	t	t	t	t
109	customer	customers	t	f	f	f
5641	accounts	demo_management	t	f	f	f
5643	manager	company_settings	t	f	f	f
3742	manager	analytics_dashboard	t	f	f	f
3744	manager	reports_export	t	t	f	f
3745	accounts	reports_export	t	t	f	f
142	manager	sales_quotations	t	t	t	f
143	manager	sales_orders_doc	t	t	t	f
4155	manager	lead_follow_ups	t	t	t	f
4170	manager	chip_level_repair	t	f	t	f
4185	manager	einvoice_ewb	t	t	f	f
4188	manager	reports_access	t	f	f	f
4190	manager	users	t	t	t	f
4192	manager	roles	t	f	f	f
4193	manager	role_permissions	t	f	t	f
4194	manager	user_permissions	t	f	t	f
4218	floor_manager	warehouse	t	f	t	f
4219	floor_manager	vendor_management	t	f	f	f
4220	floor_manager	reports_access	t	f	f	f
4221	floor_manager	support_tickets	t	f	f	f
144	manager	delivery_challans	t	t	t	f
145	manager	return_dc	t	f	f	f
77	sales	leads	t	t	t	f
4197	sales	lead_follow_ups	t	f	f	f
146	sales	sales_quotations	t	t	t	f
147	sales	sales_orders_doc	t	t	t	f
78	sales	sales_orders	t	t	t	f
5640	sales	demo_management	t	t	t	f
79	sales	follow_ups	t	t	t	f
80	sales	lead_orders	t	t	t	f
81	sales	customers	t	t	t	f
5637	sales	kyc_management	t	t	t	f
4205	sales	inventory_management	t	f	f	f
4208	sales	reports_access	f	f	f	f
76	sales	dashboard	f	f	f	f
3746	sales	analytics_dashboard	f	f	f	f
4204	sales	inventory	t	f	f	f
4206	sales	ttspl_history	t	f	f	f
154	manager	delivery_register_management	t	t	t	f
33	admin	dashboard	t	t	t	t
157	manager	technicians_bucket_list	t	f	f	f
4238	qc	ttspl_history	t	f	f	f
3741	admin	analytics_dashboard	t	t	t	t
34	admin	inventory	t	t	t	t
35	admin	tickets	t	t	t	t
36	admin	leads	t	t	t	t
4142	admin	lead_follow_ups	t	t	t	t
138	admin	sales_quotations	t	t	t	t
139	admin	sales_orders_doc	t	t	t	t
140	admin	delivery_challans	t	t	t	t
141	admin	return_dc	t	t	t	t
5638	admin	demo_management	t	t	t	f
39	admin	lead_orders	t	t	t	t
40	admin	customers	t	t	t	t
5629	admin	customer_assets	t	f	f	f
5635	admin	kyc_management	t	t	t	f
41	admin	manager_dashboard	t	t	t	t
9	admin	permissions	t	t	t	t
42	admin	reports	t	t	t	t
43	admin	parts	t	t	t	t
44	admin	procurement	t	t	t	t
45	admin	vendor_management	t	t	t	t
46	admin	warehouse	t	t	t	t
47	admin	qc_management	t	t	t	t
49	admin	dispatch	t	t	t	t
51	admin	customer_inventory	t	t	t	t
31	admin	teams	t	t	t	t
25	admin	roles	t	t	t	t
27	admin	role_permissions	t	t	t	t
29	admin	user_permissions	t	t	t	t
8	admin	users	t	t	t	t
5642	admin	company_settings	t	t	t	t
4119	admin	reports_access	t	t	t	t
3743	admin	reports_export	t	t	t	t
5633	support_tech	customer_assets	t	f	f	f
98	support_tech	support_tickets	t	t	t	f
4223	team_member	floor_pipeline	t	f	t	f
4224	team_member	floor_tickets	t	f	t	f
4225	team_member	chip_level_repair	t	f	t	f
4226	team_member	parts_inventory	t	f	f	f
4227	team_member	ttspl_history	t	f	f	f
4229	team_lead	floor_pipeline	t	t	t	f
4230	team_lead	floor_tickets	t	t	t	f
479	admin	floor_pipeline	t	t	t	t
480	manager	floor_pipeline	t	t	t	f
481	floor_manager	floor_pipeline	t	t	t	f
482	technician	floor_pipeline	t	f	t	f
483	qc	floor_pipeline	t	f	t	f
485	manager	floor_tickets	t	f	t	f
486	floor_manager	floor_tickets	t	t	t	f
487	technician	floor_tickets	t	f	t	f
488	qc	floor_tickets	t	f	t	f
490	floor_manager	chip_level_repair	t	t	t	f
491	technician	chip_level_repair	t	f	t	f
493	manager	parts_inventory	t	t	t	f
494	floor_manager	parts_inventory	t	t	t	f
495	technician	parts_inventory	t	f	f	f
498	manager	ttspl_history	t	f	f	f
499	floor_manager	ttspl_history	t	f	f	f
500	technician	ttspl_history	t	f	f	f
502	accounts	ttspl_history	t	f	f	f
693	manager	lead_conversion	t	t	t	f
696	manager	customer_documents	t	t	t	f
698	accounts	customer_documents	t	f	f	f
4231	team_lead	chip_level_repair	t	t	t	f
4232	team_lead	parts_inventory	t	f	f	f
4233	team_lead	ttspl_history	t	f	f	f
4234	qc	dashboard	t	f	f	f
4239	qc	inventory_management	t	f	f	f
4240	procurement	dashboard	t	f	f	f
1208	manager	sales_pipeline	t	t	t	f
1211	dispatch	sales_pipeline	t	f	t	f
4243	procurement	inventory_management	t	f	f	f
4244	procurement	parts_inventory	t	t	t	f
1213	manager	payment_records	t	t	t	f
1214	accounts	payment_records	t	t	t	f
1216	accounts	einvoice_ewb	t	t	f	f
1217	dispatch	einvoice_ewb	t	f	f	f
1219	manager	dispatch_ops	t	f	t	f
1220	dispatch	dispatch_ops	t	f	t	f
4253	dispatch	dashboard	t	f	f	f
4256	dispatch	delivery_challans	t	f	t	f
4257	dispatch	delivery_register_management	t	f	t	f
4259	dispatch	customers	t	f	f	f
4260	accounts	dashboard	t	f	f	f
4268	accounts	reports_access	t	f	f	f
4270	accounts	customers	t	f	f	f
4271	accounts	delivery_challans	t	f	f	f
4274	support_lead	dashboard	t	f	f	f
1922	manager	customer_billing	t	t	t	f
1923	accounts	customer_billing	t	t	t	f
1926	manager	vendor_billing_mgmt	t	t	t	f
1927	accounts	vendor_billing_mgmt	t	t	t	f
1929	manager	credit_notes	t	t	t	f
1930	accounts	credit_notes	t	t	f	f
1932	manager	debit_notes	t	t	t	f
1933	accounts	debit_notes	t	t	f	f
1935	manager	security_deposits	t	t	t	f
1936	accounts	security_deposits	t	t	t	f
1938	manager	billing_dashboard	t	f	f	f
1939	accounts	billing_dashboard	t	f	f	f
2435	support	support_tickets	t	t	t	f
2437	accounts	support_tickets	t	f	f	f
2439	manager	support_settings	t	f	t	f
4276	support_lead	support_settings	t	f	t	f
4277	support_lead	customers	t	f	f	f
4279	support_lead	ttspl_history	t	f	f	f
4247	warehouse	inventory	t	f	t	f
501	warehouse	ttspl_history	t	f	f	f
4250	warehouse	delivery_challans	t	f	t	f
1210	warehouse	sales_pipeline	t	f	t	f
4252	warehouse	vendor_management	t	t	t	f
4248	warehouse	inventory_management	t	f	t	f
1221	warehouse	dispatch_ops	t	f	t	f
1209	sales	sales_pipeline	t	t	f	f
4245	warehouse	dashboard	t	f	f	f
697	sales	customer_documents	t	t	f	f
1924	sales	customer_billing	t	f	f	f
2436	sales	support_tickets	f	f	f	f
694	sales	lead_conversion	t	t	f	f
148	sales	delivery_challans	f	f	f	f
149	sales	return_dc	f	f	f	f
158	sales	technicians_bucket_list	t	f	f	f
484	admin	floor_tickets	t	t	t	t
489	admin	chip_level_repair	t	t	t	t
492	admin	parts_inventory	t	t	t	t
497	admin	ttspl_history	t	t	t	t
11899	dispatch_qc	lead_follow_ups	f	f	f	f
11900	dispatch_qc	operation_management	f	f	f	f
11901	dispatch_qc	lead_conversion	f	f	f	f
11902	dispatch_qc	sales_quotations	f	f	f	f
11903	dispatch_qc	sales_orders_doc	f	f	f	f
11904	dispatch_qc	delivery_challans	f	f	f	f
11905	dispatch_qc	return_dc	f	f	f	f
11906	dispatch_qc	customer_management	f	f	f	f
11907	dispatch_qc	catalogue	f	f	f	f
3983	admin	operation_management	t	t	t	t
692	admin	lead_conversion	t	t	t	t
3991	admin	catalogue	t	t	t	t
37	admin	sales_orders	t	t	t	t
156	admin	technicians_bucket_list	t	t	t	t
1207	admin	sales_pipeline	t	t	t	t
1212	admin	payment_records	t	t	t	t
1215	admin	einvoice_ewb	t	t	t	t
38	admin	follow_ups	t	t	t	t
3998	admin	orders	t	t	t	t
695	admin	customer_documents	t	t	t	t
4006	admin	invoices	t	t	t	t
48	admin	inventory_management	t	t	t	t
153	admin	delivery_register_management	t	t	t	t
1218	admin	dispatch_ops	t	t	t	t
50	admin	support_tickets	t	t	t	t
1921	admin	customer_billing	t	t	t	t
1925	admin	vendor_billing_mgmt	t	t	t	t
1928	admin	credit_notes	t	t	t	t
1931	admin	debit_notes	t	t	t	t
1934	admin	security_deposits	t	t	t	t
1937	admin	billing_dashboard	t	t	t	t
2438	admin	support_settings	t	t	t	t
4280	support_tech	dashboard	t	f	f	f
4282	support_tech	customers	t	f	f	f
11908	dispatch_qc	sales_orders	f	f	f	f
11909	dispatch_qc	technicians_bucket_list	f	f	f	f
11910	dispatch_qc	sales_pipeline	f	f	f	f
11911	dispatch_qc	demo_management	f	f	f	f
11912	dispatch_qc	payment_records	f	f	f	f
11889	dispatch_qc	dashboard	f	f	f	f
11890	dispatch_qc	analytics_dashboard	f	f	f	f
11891	dispatch_qc	inventory	f	f	f	f
11892	dispatch_qc	floor_pipeline	t	t	t	t
6321	warehouse	chip_level_repair	f	f	f	f
496	warehouse	parts_inventory	t	t	t	f
6444	sales	floor_tickets	f	f	f	f
6445	sales	chip_level_repair	f	f	f	f
6446	sales	parts_inventory	f	f	f	f
6317	warehouse	analytics_dashboard	f	f	f	f
6319	warehouse	floor_pipeline	f	f	f	f
6320	warehouse	floor_tickets	f	f	f	f
6324	warehouse	tickets	f	f	f	f
6325	warehouse	leads	f	f	f	f
6326	warehouse	lead_follow_ups	f	f	f	f
6327	warehouse	operation_management	f	f	f	f
6328	warehouse	lead_conversion	f	f	f	f
6329	warehouse	sales_quotations	f	f	f	f
6330	warehouse	sales_orders_doc	f	f	f	f
6332	warehouse	return_dc	f	f	f	f
6333	warehouse	customer_management	f	f	f	f
6334	warehouse	catalogue	f	f	f	f
6335	warehouse	sales_orders	f	f	f	f
6336	warehouse	technicians_bucket_list	f	f	f	f
6338	warehouse	demo_management	f	f	f	f
6339	warehouse	payment_records	f	f	f	f
6340	warehouse	einvoice_ewb	f	f	f	f
6341	warehouse	follow_ups	f	f	f	f
6342	warehouse	orders	f	f	f	f
6343	warehouse	lead_orders	f	f	f	f
6344	warehouse	customers	f	f	f	f
6345	warehouse	customer_documents	f	f	f	f
6346	warehouse	customer_assets	f	f	f	f
6347	warehouse	kyc_management	f	f	f	f
6348	warehouse	manager_dashboard	f	f	f	f
6349	warehouse	permissions	f	f	f	f
6350	warehouse	reports	f	f	f	f
6351	warehouse	invoices	f	f	f	f
6352	warehouse	parts	f	f	f	f
6353	warehouse	procurement	t	t	t	f
94	warehouse	warehouse	t	t	t	t
6356	warehouse	qc_management	f	f	f	f
6358	warehouse	dispatch	f	f	f	f
6359	warehouse	delivery_register_management	f	f	f	f
6361	warehouse	customer_inventory	f	f	f	f
6362	warehouse	customer_billing	f	f	f	f
6363	warehouse	teams	f	f	f	f
6364	warehouse	vendor_billing_mgmt	f	f	f	f
6365	warehouse	credit_notes	f	f	f	f
6366	warehouse	debit_notes	f	f	f	f
6367	warehouse	security_deposits	f	f	f	f
6368	warehouse	billing_dashboard	f	f	f	f
6369	warehouse	roles	f	f	f	f
6370	warehouse	role_permissions	f	f	f	f
6371	warehouse	user_permissions	f	f	f	f
6372	warehouse	support_tickets	f	f	f	f
6373	warehouse	support_settings	f	f	f	f
6374	warehouse	users	f	f	f	f
6375	warehouse	company_settings	f	f	f	f
6376	warehouse	reports_access	f	f	f	f
6377	warehouse	reports_export	f	f	f	f
6466	sales	orders	f	f	f	f
6448	sales	tickets	f	f	f	f
6458	sales	catalogue	f	f	f	f
6463	sales	payment_records	f	f	f	f
6464	sales	einvoice_ewb	f	f	f	f
5631	sales	customer_assets	t	f	f	f
6472	sales	manager_dashboard	f	f	f	f
6473	sales	permissions	f	f	f	f
6474	sales	reports	f	f	f	f
6475	sales	invoices	f	f	f	f
6476	sales	parts	f	f	f	f
6477	sales	procurement	f	f	f	f
6478	sales	vendor_management	f	f	f	f
6443	sales	floor_pipeline	f	f	f	f
11893	dispatch_qc	floor_tickets	t	t	t	t
11894	dispatch_qc	chip_level_repair	t	t	t	t
11895	dispatch_qc	parts_inventory	f	f	f	f
11896	dispatch_qc	ttspl_history	f	f	f	f
11897	dispatch_qc	tickets	t	t	t	t
11898	dispatch_qc	leads	f	f	f	f
15273	admin	asset_configuration	t	t	t	t
11913	dispatch_qc	einvoice_ewb	f	f	f	f
11914	dispatch_qc	follow_ups	f	f	f	f
11915	dispatch_qc	orders	f	f	f	f
11916	dispatch_qc	lead_orders	f	f	f	f
11917	dispatch_qc	customers	f	f	f	f
11918	dispatch_qc	customer_documents	f	f	f	f
7535	manager	technician_bucket	t	f	t	f
7536	sales	technician_bucket	t	f	f	f
7537	dispatch	technician_bucket	t	f	t	f
11919	dispatch_qc	customer_assets	f	f	f	f
11920	dispatch_qc	kyc_management	f	f	f	f
11921	dispatch_qc	manager_dashboard	f	f	f	f
11922	dispatch_qc	permissions	f	f	f	f
11923	dispatch_qc	reports	f	f	f	f
11924	dispatch_qc	invoices	f	f	f	f
11925	dispatch_qc	parts	f	f	f	f
11926	dispatch_qc	procurement	f	f	f	f
7763	manager	parts_requests	t	t	t	f
7764	floor_manager	parts_requests	t	t	t	f
7765	team_member	parts_requests	t	t	f	f
7766	team_lead	parts_requests	t	t	t	f
7767	technician	parts_requests	t	t	f	f
7768	qc	parts_requests	t	t	f	f
7770	manager	parts_approval	t	t	t	f
7771	warehouse	parts_approval	t	f	t	f
7773	manager	parts_procurement	t	t	t	f
7774	procurement	parts_procurement	t	t	t	f
11927	dispatch_qc	vendor_management	f	f	f	f
11928	dispatch_qc	warehouse	f	f	f	f
11929	dispatch_qc	qc_management	t	t	t	t
11930	dispatch_qc	inventory_management	f	f	f	f
11931	dispatch_qc	dispatch	f	f	f	f
11932	dispatch_qc	delivery_register_management	f	f	f	f
11933	dispatch_qc	dispatch_ops	f	f	f	f
15346	support_tech	support_part_challan	f	f	f	f
15347	support_tech	users	f	f	f	f
15348	support_tech	company_settings	f	f	f	f
11934	dispatch_qc	technician_bucket	f	f	f	f
6451	sales	operation_management	f	f	f	f
6479	sales	warehouse	f	f	f	f
6480	sales	qc_management	f	f	f	f
6482	sales	dispatch	f	f	f	f
155	sales	delivery_register_management	f	f	f	f
6484	sales	dispatch_ops	f	f	f	f
6485	sales	customer_inventory	f	f	f	f
6487	sales	teams	f	f	f	f
6488	sales	vendor_billing_mgmt	f	f	f	f
6489	sales	credit_notes	f	f	f	f
6490	sales	debit_notes	f	f	f	f
6491	sales	security_deposits	f	f	f	f
6492	sales	billing_dashboard	f	f	f	f
6493	sales	roles	f	f	f	f
6494	sales	role_permissions	f	f	f	f
6495	sales	user_permissions	f	f	f	f
6497	sales	support_settings	f	f	f	f
6498	sales	users	f	f	f	f
6499	sales	company_settings	f	f	f	f
6501	sales	reports_export	f	f	f	f
8842	manager	support_technician	t	f	t	f
9124	support_lead	support_part_requests	t	t	t	t
9125	warehouse	support_part_requests	t	f	t	f
9127	manager	support_part_requests	t	f	t	f
9128	warehouse	support_part_challan	t	t	t	f
9129	support_lead	support_part_challan	t	t	t	f
9131	manager	support_part_challan	t	f	f	f
11935	dispatch_qc	support_tickets	f	f	f	f
11936	dispatch_qc	customer_inventory	f	f	f	f
11937	dispatch_qc	customer_billing	f	f	f	f
11938	dispatch_qc	teams	f	f	f	f
11939	dispatch_qc	vendor_billing_mgmt	f	f	f	f
11940	dispatch_qc	credit_notes	f	f	f	f
11941	dispatch_qc	debit_notes	f	f	f	f
11942	dispatch_qc	security_deposits	f	f	f	f
11943	dispatch_qc	billing_dashboard	f	f	f	f
11944	dispatch_qc	roles	f	f	f	f
11945	dispatch_qc	role_permissions	f	f	f	f
11946	dispatch_qc	user_permissions	f	f	f	f
11947	dispatch_qc	parts_requests	f	f	f	f
11948	dispatch_qc	parts_approval	f	f	f	f
11949	dispatch_qc	parts_procurement	f	f	f	f
11950	dispatch_qc	support_settings	f	f	f	f
11951	dispatch_qc	support_technician	f	f	f	f
11952	dispatch_qc	support_part_requests	f	f	f	f
11953	dispatch_qc	support_part_challan	f	f	f	f
11954	dispatch_qc	users	f	f	f	f
11955	dispatch_qc	company_settings	f	f	f	f
11956	dispatch_qc	reports_access	f	f	f	f
11957	dispatch_qc	reports_export	f	f	f	f
150	admin	customer_management	t	t	t	t
151	manager	customer_management	t	t	t	t
152	sales	customer_management	t	t	t	f
13	super_admin	catalogue	t	t	t	t
15276	super_admin	asset_configuration	t	t	t	t
133	super_admin	customer_inventory	t	t	t	t
7534	admin	technician_bucket	t	t	t	t
7762	admin	parts_requests	t	t	t	t
7769	admin	parts_approval	t	t	t	t
7772	admin	parts_procurement	t	t	t	t
8841	admin	support_technician	t	t	t	t
9126	admin	support_part_requests	t	t	t	t
9130	admin	support_part_challan	t	t	t	t
15275	manager	asset_configuration	t	t	t	t
8840	support_lead	support_technician	t	t	t	t
8839	support_tech	support_technician	t	f	t	f
9123	support_tech	support_part_requests	t	t	t	f
15349	support_tech	reports_access	f	f	f	f
15350	support_tech	reports_export	f	f	f	f
15277	support_tech	technician_bucket	t	t	t	f
14	super_admin	orders	t	t	t	t
17	super_admin	permissions	t	t	t	t
15	super_admin	invoices	t	t	t	t
289	super_admin	technicians_bucket_list	t	t	t	t
3935	super_admin	analytics_dashboard	t	t	t	t
4084	super_admin	lead_follow_ups	t	t	t	t
843	super_admin	lead_conversion	t	t	t	t
844	super_admin	customer_documents	t	t	t	t
288	super_admin	delivery_register_management	t	t	t	t
658	super_admin	floor_pipeline	t	t	t	t
659	super_admin	floor_tickets	t	t	t	t
660	super_admin	chip_level_repair	t	t	t	t
661	super_admin	parts_inventory	t	t	t	t
662	super_admin	ttspl_history	t	t	t	t
4061	super_admin	reports_access	t	t	t	t
3936	super_admin	reports_export	t	t	t	t
10004	super_admin	customer_assets	t	t	t	t
16	super_admin	users	t	t	t	t
10006	super_admin	kyc_management	t	t	t	t
10007	super_admin	demo_management	t	t	t	t
10008	super_admin	company_settings	t	t	t	t
10046	super_admin	parts_requests	t	t	t	t
10047	super_admin	parts_approval	t	t	t	t
10048	super_admin	parts_procurement	t	t	t	t
10050	super_admin	support_part_requests	t	t	t	t
10051	super_admin	support_part_challan	t	t	t	t
294	super_admin	customer_management	t	t	t	t
2125	super_admin	customer_billing	t	t	t	t
10036	super_admin	technician_bucket	t	t	t	t
10035	super_admin	support_technician	t	t	t	t
2126	super_admin	vendor_billing_mgmt	t	t	t	t
2127	super_admin	credit_notes	t	t	t	t
2128	super_admin	debit_notes	t	t	t	t
2129	super_admin	security_deposits	t	t	t	t
2130	super_admin	billing_dashboard	t	t	t	t
290	super_admin	sales_quotations	t	t	t	t
291	super_admin	sales_orders_doc	t	t	t	t
292	super_admin	delivery_challans	t	t	t	t
293	super_admin	return_dc	t	t	t	t
11	super_admin	inventory	t	t	t	t
10	super_admin	tickets	t	t	t	t
118	super_admin	leads	t	t	t	t
20	super_admin	sales_orders	t	t	t	t
120	super_admin	follow_ups	t	t	t	t
22	super_admin	lead_orders	t	t	t	t
12	super_admin	customers	t	t	t	t
123	super_admin	manager_dashboard	t	t	t	t
18	super_admin	reports	t	t	t	t
125	super_admin	parts	t	t	t	t
295	super_admin	operation_management	t	t	t	t
126	super_admin	procurement	t	t	t	t
24	super_admin	vendor_management	t	t	t	t
128	super_admin	warehouse	t	t	t	t
15278	support_lead	technician_bucket	t	f	t	f
2640	super_admin	support_settings	t	t	t	t
129	super_admin	qc_management	t	t	t	t
130	super_admin	inventory_management	t	t	t	t
131	super_admin	dispatch	t	t	t	t
132	super_admin	support_tickets	t	t	t	t
28	super_admin	role_permissions	t	t	t	t
30	super_admin	user_permissions	t	t	t	t
115	super_admin	dashboard	t	t	t	t
1370	super_admin	sales_pipeline	t	t	t	t
1371	super_admin	payment_records	t	t	t	t
1372	super_admin	einvoice_ewb	t	t	t	t
1373	super_admin	dispatch_ops	t	t	t	t
32	super_admin	teams	t	t	t	t
26	super_admin	roles	t	t	t	t
15282	support_tech	analytics_dashboard	f	f	f	f
15283	support_tech	inventory	f	f	f	f
15284	support_tech	floor_pipeline	f	f	f	f
15285	support_tech	floor_tickets	f	f	f	f
15286	support_tech	chip_level_repair	f	f	f	f
15287	support_tech	parts_inventory	f	f	f	f
15288	support_tech	ttspl_history	f	f	f	f
15289	support_tech	tickets	f	f	f	f
15290	support_tech	leads	f	f	f	f
15291	support_tech	lead_follow_ups	f	f	f	f
15292	support_tech	operation_management	f	f	f	f
15293	support_tech	lead_conversion	f	f	f	f
15294	support_tech	sales_quotations	f	f	f	f
15295	support_tech	sales_orders_doc	f	f	f	f
15296	support_tech	delivery_challans	t	t	t	f
15297	support_tech	return_dc	f	f	f	f
15298	support_tech	customer_management	f	f	f	f
15299	support_tech	catalogue	f	f	f	f
15300	support_tech	sales_orders	f	f	f	f
15301	support_tech	technicians_bucket_list	t	t	t	f
15302	support_tech	sales_pipeline	f	f	f	f
15303	support_tech	demo_management	f	f	f	f
15304	support_tech	payment_records	f	f	f	f
15305	support_tech	einvoice_ewb	f	f	f	f
15306	support_tech	follow_ups	f	f	f	f
15307	support_tech	orders	f	f	f	f
15308	support_tech	lead_orders	f	f	f	f
15310	support_tech	customer_documents	f	f	f	f
15312	support_tech	kyc_management	f	f	f	f
15313	support_tech	manager_dashboard	f	f	f	f
15314	support_tech	permissions	f	f	f	f
15315	support_tech	reports	f	f	f	f
15316	support_tech	invoices	f	f	f	f
15317	support_tech	parts	f	f	f	f
15318	support_tech	procurement	f	f	f	f
15319	support_tech	vendor_management	f	f	f	f
15320	support_tech	asset_configuration	f	f	f	f
15321	support_tech	warehouse	f	f	f	f
15322	support_tech	qc_management	f	f	f	f
15323	support_tech	inventory_management	f	f	f	f
15324	support_tech	dispatch	f	f	f	f
15325	support_tech	delivery_register_management	t	t	t	f
15326	support_tech	dispatch_ops	f	f	f	f
99	support_tech	customer_inventory	t	f	f	f
15330	support_tech	customer_billing	f	f	f	f
15331	support_tech	teams	f	f	f	f
15332	support_tech	vendor_billing_mgmt	f	f	f	f
15333	support_tech	credit_notes	f	f	f	f
15334	support_tech	debit_notes	f	f	f	f
15335	support_tech	security_deposits	f	f	f	f
15336	support_tech	billing_dashboard	f	f	f	f
15337	support_tech	roles	f	f	f	f
15338	support_tech	role_permissions	f	f	f	f
15339	support_tech	user_permissions	f	f	f	f
15340	support_tech	parts_requests	f	f	f	f
15341	support_tech	parts_approval	f	f	f	f
15342	support_tech	parts_procurement	f	f	f	f
15343	support_tech	support_settings	f	f	f	f
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, name, display_name, description, is_system_role, created_at, updated_at) FROM stdin;
3	technician	Technician	Field / repair technician	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
4	vendor	Vendor	External vendor partner	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
5	customer	Customer	Customer portal user	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
1	super_admin	Super Admin	Full unrestricted access	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
2	admin	Admin	Full CRM access	t	2026-06-11 14:20:28.184433+00	2026-06-11 14:20:28.184433+00
103	manager	Manager	Approvals, reports, team oversight	t	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
104	sales	Sales	Leads, quotations, sales orders	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
105	floor_manager	Floor Manager	Assign tickets, floor oversight	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
106	team_member	Technician (Floor)	Assigned tickets, parts requests	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
107	team_lead	Senior Technician	Team tickets, parts management	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
108	qc	QC Inspector	QC1/QC2 stages only	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
109	procurement	Procurement	Purchase orders, GRN, vendors	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
110	warehouse	Warehouse	GRN, inventory, DC attachment	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
111	dispatch	Dispatch	Delivery challans, dispatch	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
112	accounts	Accounts	Billing, invoices, finance	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
113	support_lead	Support Lead	All support tickets, team management	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
114	support_tech	Support Technician	Own assigned support tickets	f	2026-06-12 08:41:51.15297+00	2026-06-12 08:41:51.15297+00
198	dispatch_qc	Dispatch QC	Dispatch QC	f	2026-06-22 06:09:09.173078+00	2026-06-22 06:09:41.148014+00
\.


--
-- Data for Name: sales_order_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales_order_lines (id, sales_order_number, quotation_number, customer_id, customer_name, customer_email, customer_mobile, customer_shipping_address, customer_billing_address, gst_number, supply_state, security_amount, shiping_charges, quotation_type, branch, brand, model_name, processor, generation, ram, storage, gpu, screen_size, quantity, main_qty, rate, locking_period, battery_charger_warranty, technical_warranty, remark, status, token, pdf_path, created_by, created_at, updated_at, entity_code, security_type, delivery_address, is_wfh, delivery_notes) FROM stdin;
\.


--
-- Data for Name: sales_order_payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales_order_payments (payment_id, sales_order_number, customer_id, payment_type, amount, payment_date, payment_mode, reference_number, notes, recorded_by, created_at) FROM stdin;
\.


--
-- Data for Name: sales_order_serials; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales_order_serials (allocation_id, sales_order_number, line_id, serial_id, ttspl_id, serial_number, qc_ticket_id, qc_status, status, dc_number, entity_code, created_by, created_at, updated_at, delivery_address, delivery_notes, is_wfh) FROM stdin;
\.


--
-- Data for Name: sales_quotations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales_quotations (id, quotation_number, customer_id, customer_name, customer_email, customer_mobile, customer_shipping_address, customer_billing_address, contact_person_name, contact_person_mobile, gst_number, supply_state, security_amount, shiping_charges, quotation_type, brand, model_name, processor, generation, ram, storage, gpu, screen_size, quantity, main_quantity, rate, locking_period, battery_charger_warranty, technical_warranty, remark, status, token, pdf_path, status_updated_by_id, status_updated_by_name, created_by, created_at, updated_at, source_lead_id, entity_code, security_type) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.schema_migrations (name, applied_at) FROM stdin;
000_schema_migrations.sql	2026-06-11 14:20:07.485124+00
001_user_teams.sql	2026-06-11 14:20:08.034094+00
002_order_items_qc_passed.sql	2026-06-11 14:20:08.584292+00
003_stage_categories_ttspl_id.sql	2026-06-11 14:20:09.131136+00
004_add_qc_tables.sql	2026-06-11 14:20:09.681447+00
005_order_item_level_logistics.sql	2026-06-11 14:20:10.23653+00
006_inventory_erp_sync.sql	2026-06-11 14:20:10.786034+00
008_replace_repeat_with_callback.sql	2026-06-11 14:20:11.922156+00
009_lead_remarks.sql	2026-06-11 14:20:12.477852+00
010_add_order_teams.sql	2026-06-11 14:20:13.021997+00
011_add_proposed_delivery_date.sql	2026-06-11 14:20:13.570429+00
013_warehouse_team.sql	2026-06-11 14:20:14.11672+00
014_stage_categories_ttspl_id.sql	2026-06-11 14:20:14.662491+00
015_hardware_software_team.sql	2026-06-11 14:20:15.214888+00
017_apple_generation_laptop_catalog.sql	2026-06-11 14:20:16.040191+00
018_order_items_qc_sales_checklist.sql	2026-06-11 14:20:16.591452+00
019_lead_stage_demo.sql	2026-06-11 14:20:17.142193+00
020_order_type_normalize.sql	2026-06-11 14:20:17.686547+00
022_orders_qc_timing.sql	2026-06-11 14:20:18.510053+00
023_tickets_serial_repair_cycles.sql	2026-06-11 14:20:19.05981+00
024_existing_customer_inventory.sql	2026-06-11 14:20:19.611808+00
025_support_module.sql	2026-06-11 14:20:20.170897+00
026_support_redesign.sql	2026-06-11 14:20:20.722645+00
027_support_v2.sql	2026-06-11 14:20:21.275002+00
028_support_user_roles.sql	2026-06-11 14:20:21.826591+00
029_rbac_system.sql	2026-06-11 14:20:22.379263+00
029_support_v3.sql	2026-06-11 14:20:22.932821+00
030_lead_quotation_accept.sql	2026-06-11 14:20:23.478764+00
031_support_ticket_category.sql	2026-06-11 14:20:24.027196+00
032_vendor_management.sql	2026-06-11 14:20:24.595629+00
033_vendor_po_bills.sql	2026-06-11 14:20:25.146054+00
034_vendor_spo_bills_and_parts_catalog.sql	2026-06-11 14:20:25.695951+00
035_vendor_spare_grn_serial.sql	2026-06-11 14:20:26.251118+00
036_vendor_serial_ttspl_and_rental.sql	2026-06-11 14:20:26.799773+00
037_vendor_serial_inventory_meta.sql	2026-06-11 14:20:27.354569+00
038_inventory_management_laravel_views.sql	2026-06-11 14:20:27.910144+00
040_rbac_roles_module.sql	2026-06-11 14:20:28.461477+00
041_application_sections.sql	2026-06-11 14:20:29.026171+00
042_sales_management_module.sql	2026-06-11 14:20:29.5846+00
043_operation_management_extras.sql	2026-06-11 14:20:30.131746+00
044_quotation_demo_type.sql	2026-06-11 14:20:30.682154+00
045_customer_management_module.sql	2026-06-11 14:20:31.230824+00
046_qc_check_parity.sql	2026-06-11 14:20:31.793924+00
047_vendor_product_details.sql	2026-06-11 14:20:32.348675+00
048_delivery_register_management.sql	2026-06-11 14:20:33.170542+00
049_delivery_technicians_laravel_parity.sql	2026-06-11 14:20:33.720415+00
050_technicians_bucket_list.sql	2026-06-11 14:20:34.272639+00
051_grn_ticket_flow.sql	2026-06-11 14:20:34.823725+00
052_phase1_vendor_procurement.sql	2026-06-11 14:20:35.374552+00
053_vendor_billing_tables.sql	2026-06-11 14:20:35.930757+00
054_vendor_invoice_upload.sql	2026-06-11 14:20:36.481347+00
055_vendor_portal_sessions.sql	2026-06-11 14:20:37.02844+00
078_clean_and_reseed.sql	2026-06-14 11:57:00.158718+00
079_dc_status_in_transit.sql	2026-06-14 11:59:44.185069+00
090_prepaid_billing.sql	2026-06-20 03:28:47.868471+00
091_return_lifecycle.sql	2026-06-20 03:28:55.222321+00
seed_prorata_test_apr_may	2026-06-20 03:29:09.234005+00
093_return_dc_flow.sql	2026-06-20 07:34:42.623168+00
094_dispatch_qc_and_cancel_status.sql	2026-06-20 13:26:56.745752+00
095_qc_stage_dispatch.sql	2026-06-20 14:06:22.73176+00
096_support_v3_columns.sql	2026-06-20 14:06:36.024017+00
097_support_phase18.sql	2026-06-20 17:54:41.552268+00
098_support_parts_bucket.sql	2026-06-20 20:17:09.308342+00
099_support_parts_reassign.sql	2026-06-20 21:25:06.827835+00
100_pickup_flow_redesign.sql	2026-06-21 20:42:31.128364+00
101_pickup_backfill.sql	2026-06-21 20:42:47.327322+00
102_return_dc_tracking_esign.sql	2026-06-21 21:26:48.94508+00
104_asset_configuration.sql	2026-06-22 12:36:30.633526+00
105_asset_configuration_vendor_seed.sql	2026-06-22 12:36:35.23615+00
106_support_delivery_technician_permissions.sql	2026-06-22 12:36:40.29737+00
\.


--
-- Data for Name: sm_courier_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sm_courier_details (id, courier_name, awb_number, dc_number, created_at) FROM stdin;
\.


--
-- Data for Name: sm_document_sequences; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sm_document_sequences (doc_type, last_value, prefix, updated_at) FROM stdin;
invoice_gorefurbo	0	GINV-	2026-06-12 21:54:37.988812+00
quote_rentfoxxy	2	EST-	2026-06-12 21:54:37.988812+00
quote_gorefurbo	1	GEST-	2026-06-12 21:54:37.988812+00
so_rentfoxxy	3	SO-	2026-06-12 21:54:37.988812+00
so_gorefurbo	1	GSO-	2026-06-12 21:54:37.988812+00
customer_invoice	2	INV-	2026-06-11 21:17:47.998082+00
support_ticket	2	TKT-	2026-06-12 08:16:37.067058+00
support_part_request	6	SPR-	2026-06-21 08:14:02.361277+00
support_part_challan	6	SPC-	2026-06-21 08:14:11.113768+00
credit_note	7	CN-	2026-06-11 21:17:47.998082+00
vendor_debit_note	4	DN-	2026-06-11 14:20:35.65036+00
dc_rentfoxxy	9	DC-	2026-06-22 07:53:33.934154+00
vendor_bill	3	VB-	2026-06-11 14:20:35.65036+00
invoice_rentfoxxy	16	INV-	2026-06-12 21:54:37.988812+00
part_request	3	PRQ-	2026-06-20 09:56:35.801619+00
dc_gorefurbo	2	GDC-	2026-06-20 11:40:26.442743+00
part_instance	7	PRT-	2026-06-21 08:04:00.241+00
return_dc	13	RDC	2026-06-22 08:37:26.704834+00
quotation	39	EST-	2026-06-22 12:38:28.492888+00
delivery_challan	93	DC-	2026-06-22 12:38:46.348699+00
sales_order	59	SO-	2026-06-22 13:20:15.365173+00
\.


--
-- Data for Name: spare_parts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.spare_parts (id, name, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: stage_checklists; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stage_checklists (checklist_id, stage_id, checklist_items, created_at) FROM stdin;
\.


--
-- Data for Name: stage_transition_rules; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stage_transition_rules (rule_id, from_stage_name, to_stage_name, condition, is_backward, notes) FROM stdin;
1	Floor Manager	Diagnosis	\N	f	Auto on assign
2	Diagnosis	Assembly & Software	no_chip_no_body	f	Normal flow
3	Diagnosis	Chip Level Repair	chip_required	f	Chip issue found
4	Diagnosis	Body & Paint	body_required	f	Body issue only
5	Chip Level Repair	Assembly & Software	\N	f	After chip repair
6	Body & Paint	Assembly & Software	\N	f	After body work
7	Assembly & Software	Final Testing	\N	f	Normal flow
8	Final Testing	QC1	\N	f	Normal flow
9	QC1	QC2	qc1_passed	f	QC1 passed
10	QC1	Assembly & Software	qc1_failed	t	QC1 failed — back to tech
11	QC2	Inventory	qc2_passed	f	QC2 passed — inventory ready
12	QC2	QC1	qc2_failed	t	QC2 failed — back to QC1
\.


--
-- Data for Name: stages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stages (stage_id, stage_name, stage_order, team_id, stage_category, description, created_at) FROM stdin;
1	Floor Manager	1	1	\N	Receive laptop and create initial ticket	2026-06-11 14:20:06.887554+00
3	Chip Level Repair	3	3	\N	Motherboard and chip-level repairs	2026-06-11 14:20:06.887554+00
4	Dismantle	4	4	\N	Parts tagging and removal	2026-06-11 14:20:06.887554+00
5	Procurement	5	5	\N	Source required parts	2026-06-11 14:20:06.887554+00
6	Body & Paint	6	6	\N	Body repair and paint work	2026-06-11 14:20:06.887554+00
11	Inventory	11	11	\N	Add to final inventory	2026-06-11 14:20:06.887554+00
9	QC1	9	9	QC Team	First quality check - 50+ points	2026-06-11 14:20:06.887554+00
10	QC2	10	10	QC Team	Second quality check - final verification	2026-06-11 14:20:06.887554+00
2	Diagnosis	2	14	Hardware & Software	Full hardware and cosmetic diagnosis	2026-06-11 14:20:06.887554+00
7	Assembly & Software	7	14	Hardware & Software	Repair, replacement, and software installation	2026-06-11 14:20:06.887554+00
8	Final Testing	8	14	Hardware & Software	Final system validation and defect resolution	2026-06-11 14:20:06.887554+00
12	Dispatch QC	10	92	QC Team	Final QC before Sales Order dispatch. Only for sales_order_qc tickets.	2026-06-20 13:26:56.745752+00
\.


--
-- Data for Name: support_challan_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_challan_items (id, challan_id, part_request_id, part_id, instance_id, prt_id, part_name, quantity, unit_cost, returned_qty, return_status, created_at) FROM stdin;
\.


--
-- Data for Name: support_issue_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_issue_categories (id, name, active, sort_order, created_at) FROM stdin;
1	Hardware / performance	t	10	2026-06-11 14:20:19.885915+00
2	Display / keyboard / touchpad	t	20	2026-06-11 14:20:19.885915+00
3	Battery / charging	t	30	2026-06-11 14:20:19.885915+00
4	Software / OS	t	40	2026-06-11 14:20:19.885915+00
5	Network / Wi-Fi	t	50	2026-06-11 14:20:19.885915+00
6	Pickup / return logistics	t	60	2026-06-11 14:20:19.885915+00
7	Other	t	99	2026-06-11 14:20:19.885915+00
\.


--
-- Data for Name: support_part_challans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_part_challans (id, challan_number, support_ticket_id, ttspl_id, issued_to, issued_by, issued_at, status, tech_esign_url, tech_esign_at, tech_esign_name, wh_esign_url, wh_esign_at, wh_esign_name, pdf_path, return_pdf_path, notes, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: support_part_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_part_requests (id, request_number, support_ticket_id, support_item_id, ttspl_id, serial_number, requested_by, assigned_to_tech, part_id, quantity, reason, status, instance_id, challan_id, approved_by, approved_at, issued_at, used_at, return_requested_at, returned_at, returned_to, rejection_reason, notes, created_at, updated_at, reassign_to_ticket_id, reassign_to_item_id, reassign_to_ttspl_id, reassign_to_serial, reassign_reason, reassign_requested_at, reassign_requested_by) FROM stdin;
\.


--
-- Data for Name: support_replacement_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_replacement_orders (id, ticket_id, item_id, source_item_id, old_customer_inventory_id, new_customer_inventory_id, old_machine_serial, new_machine_serial, status, created_by, notes, created_at, dispatched_at, delivered_at, inventory_updated_at, complaint_item_id, pickup_item_id, dispatch_method, courier_name, awb_number, delivery_otp_code, delivery_otp_verified_at, warehouse_otp_code, warehouse_otp_verified_at, flagged_at, approved_at, out_for_delivery_at, pickup_completed_at, sales_order_number, dc_number, delivery_person_id, pickup_assigned_to, pickup_pod_path, new_dc_number) FROM stdin;
\.


--
-- Data for Name: support_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_settings (key, value, updated_at) FROM stdin;
auto_close_enabled	true	2026-06-11 14:20:20.447384+00
overdue_threshold_hours	48	2026-06-11 14:20:20.447384+00
msr91_enabled	false	2026-06-11 14:20:20.447384+00
\.


--
-- Data for Name: support_ticket_item_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_ticket_item_audit (id, item_id, ticket_id, user_id, action, detail, created_at) FROM stdin;
\.


--
-- Data for Name: support_ticket_item_comments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_ticket_item_comments (id, item_id, user_id, author_role, body, created_at) FROM stdin;
\.


--
-- Data for Name: support_ticket_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_ticket_items (id, ticket_id, customer_inventory_id, serial_number, unique_serial_number, brand, model, ram, storage, generation, item_type, issue_category_id, issue_category_label, remarks, assigned_to, status, otp_code, otp_verified_at, pod_image_path, work_done_at, loan_machine_serial, loan_delivered_at, pickup_scheduled_at, resolved_at, created_at, updated_at, visited_at, picked_up_at, replacement_flagged_by, replacement_flag_reason, replacement_approved_by, replacement_approved_at, source_item_id, current_step, outcome, outcome_set_by, outcome_set_at, pod_uploaded_at, warehouse_otp_code, warehouse_otp_verified_at, pickup_method, pickup_assigned_to, pickup_courier_name, pickup_awb, pickup_completed_at, visited_lat, visited_lng, ttspl_id, ttspl_verified, ttspl_verified_at, ttspl_verified_by, reached_warehouse_at, warehouse_received_by, floor_ticket_id, proof_of_completion_path, pickup_type, customer_otp_code, customer_otp_sent_at, customer_otp_verified_at, warehouse_received_at, warehouse_esign_url, warehouse_esign_at, warehouse_esign_by, porter_tracking_id, porter_order_id, return_dc_number, technician_esign_url, technician_esign_at, technician_esign_by) FROM stdin;
\.


--
-- Data for Name: support_tickets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_tickets (id, customer_id, customer_name, customer_phone, status, created_by, closed_by, closed_at, created_at, updated_at, last_activity_at, priority, top_level_remarks, ticket_phone_override, ticket_alt_phone, ticket_email, ticket_address, created_by_name, ticket_category, return_dc_number, complaint_type, serial_number, unique_number, delivery_person_id, assigned_parts, replaced_parts, ttspl_id, dc_number, sales_order_number, customer_portal_ticket, portal_customer_id, pickup_address) FROM stdin;
\.


--
-- Data for Name: teams; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.teams (team_id, team_name, manager_id, created_at) FROM stdin;
1	Warehouse Team	\N	2026-06-11 14:20:06.887554+00
2	Diagnose Team	\N	2026-06-11 14:20:06.887554+00
3	Chip Level Repair Team	\N	2026-06-11 14:20:06.887554+00
4	Dismantle Team	\N	2026-06-11 14:20:06.887554+00
5	Procurement Team	\N	2026-06-11 14:20:06.887554+00
6	Vendor (Body & Paint)	\N	2026-06-11 14:20:06.887554+00
7	Assembly & Software Team	\N	2026-06-11 14:20:06.887554+00
8	Testing Team	\N	2026-06-11 14:20:06.887554+00
9	QC1 Team	\N	2026-06-11 14:20:06.887554+00
10	QC2 Team	\N	2026-06-11 14:20:06.887554+00
11	Inventory Team	\N	2026-06-11 14:20:06.887554+00
12	QC Team	\N	2026-06-11 14:20:12.750449+00
13	Dispatch Team	\N	2026-06-11 14:20:12.750449+00
14	Hardware & Software	\N	2026-06-11 14:20:14.938186+00
85	Hardware & Software	\N	2026-06-12 14:27:50.186732+00
86	QC1 Team	\N	2026-06-12 14:27:50.186732+00
87	QC2 Team	\N	2026-06-12 14:27:50.186732+00
88	Chip Level Repair Team	\N	2026-06-12 14:27:50.186732+00
89	Body & Paint Team	\N	2026-06-12 14:27:50.186732+00
90	Inventory Team	\N	2026-06-12 14:27:50.186732+00
91	Warehouse Team	\N	2026-06-12 14:27:50.186732+00
92	Dispatch QC Team	\N	2026-06-20 13:26:56.745752+00
\.


--
-- Data for Name: ticket_checklist_progress; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ticket_checklist_progress (id, ticket_id, stage_id, checklist_data, completed_by, completed_at) FROM stdin;
\.


--
-- Data for Name: ticket_part_blocks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ticket_part_blocks (block_id, ticket_id, request_id, blocked_at, unblocked_at, is_active) FROM stdin;
\.


--
-- Data for Name: ticket_parts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ticket_parts (id, ticket_id, part_id, quantity_used, notes, added_at, unit_cost, is_upgrade) FROM stdin;
\.


--
-- Data for Name: ticket_services; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ticket_services (service_id, ticket_id, service_type, cost, added_by, created_at) FROM stdin;
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tickets (ticket_id, serial_number, ttspl_id, machine_number, brand, model, processor, ram, storage, status, priority, current_stage_id, assigned_team_id, assigned_user_id, initial_condition, final_grade, initial_cost, created_at, updated_at, completed_at, vendor_serial_id, ticket_type, qc_fail_count, qc1_failed_at, qc2_failed_at, qc1_fail_reason, qc2_fail_reason, qc1_passed_at, qc2_passed_at, body_paint_required, chip_repair_required, highlighted, highlighted_reason, floor_manager_qc_failed, floor_manager_qc_failed_at, floor_manager_qc_fail_reason, return_to_vendor_dc_number, sales_order_id, sales_order_number, open_part_requests) FROM stdin;
\.


--
-- Data for Name: ttspl_audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ttspl_audit_log (log_id, ttspl_id, vendor_serial_id, event_type, description, metadata, actor_user_id, actor_name, created_at) FROM stdin;
\.


--
-- Data for Name: ttspl_config_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ttspl_config_history (history_id, ttspl_id, vendor_serial_id, ticket_id, changed_by, change_type, field_name, old_value, new_value, notes, part_used_id, part_cost, created_at) FROM stdin;
\.


--
-- Data for Name: user_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_permissions (id, user_id, section, can_view, can_create, can_edit, can_delete, granted_by, granted_at) FROM stdin;
1	16	inventory_management	f	\N	\N	\N	2	2026-06-15 17:44:35.442775
2	16	inventory	f	\N	\N	\N	2	2026-06-15 17:44:42.056955
3	16	sales_orders_doc	\N	\N	\N	t	2	2026-06-16 04:21:13.764217
4	5	delivery_register_management	t	t	t	\N	2	2026-06-18 20:07:59.946949
5	5	dispatch_ops	t	t	t	\N	2	2026-06-18 20:08:16.451422
\.


--
-- Data for Name: user_teams; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_teams (user_id, team_id) FROM stdin;
6	14
7	14
8	9
9	10
5	14
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (user_id, name, email, password_hash, role, team_id, active, barcode, permissions, created_at, updated_at, status, user_type, approved_by, approved_at, rejection_reason, company_name, gst_number, mobile_no, last_login, last_login_ip, deactivated_at, deactivated_by, deactivation_reason, profile_photo_url, designation, department, employee_id, joining_date, notes) FROM stdin;
1	Super Admin	superadmin@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	super_admin	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000001	\N	\N	\N	\N	\N	\N	Super Administrator	\N	\N	\N	\N
3	Raj Sharma	manager@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	manager	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000003	\N	\N	\N	\N	\N	\N	Operations Manager	\N	\N	\N	\N
10	Deepak Joshi	procurement@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	procurement	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-14 11:57:00.158718+00	active	internal	\N	\N	\N	\N	\N	9900000010	\N	\N	\N	\N	\N	\N	Procurement Executive	\N	\N	\N	\N
7	Suresh Verma	senior.tech@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	team_lead	14	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-22 05:58:26.454152+00	active	internal	\N	\N	\N	\N	\N	9900000007	2026-06-22 05:58:26.454152+00	::ffff:127.0.0.1	\N	\N	\N	\N	Senior Technician	\N	\N	\N	\N
13	Anikesh	accounts@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	accounts	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-17 07:22:04.640064+00	active	internal	\N	\N	\N	\N	\N	9900000013	\N	\N	\N	\N	\N	\N	Accounts Manager	\N	\N	\N	\N
16	sales team	pankajyadav762@gmail.com	$2a$10$RkOKd3hn.MPzav2uyg0AveQjg5WWbFYG9.O/c7UOZ2xFmHeA68DTO	sales	\N	t	\N	{}	2026-06-15 17:36:52.426597+00	2026-06-15 17:37:40.614656+00	active	internal	\N	\N	\N	\N	\N	8076473811	2026-06-15 17:37:40.614656+00	::ffff:127.0.0.1	\N	\N	\N	\N	team	sales	\N	\N	\N
14	Manish	support.lead@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	support_lead	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-21 08:21:18.374493+00	active	internal	\N	\N	\N	\N	\N	9900000014	2026-06-21 08:21:18.374493+00	::ffff:127.0.0.1	\N	\N	\N	\N	Support Lead	\N	\N	\N	\N
11	Bhagwati	warehouse@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	warehouse	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-17 12:19:47.526536+00	active	internal	\N	\N	\N	\N	\N	9900000011	2026-06-17 12:19:47.526536+00	::ffff:127.0.0.1	\N	\N	\N	\N	Warehouse Supervisor	\N	\N	\N	\N
12	Amit Kaur	dispatch@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	dispatch	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-22 06:43:31.188184+00	active	internal	\N	\N	\N	\N	\N	9900000012	2026-06-22 06:43:31.188184+00	::ffff:127.0.0.1	\N	\N	\N	\N	Dispatch Executive	\N	\N	\N	\N
9	Richin	qc2@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	qc	10	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-22 07:44:47.215235+00	active	internal	\N	\N	\N	\N	\N	9900000009	2026-06-22 07:44:47.215235+00	::ffff:127.0.0.1	\N	\N	\N	\N	Senior QC Inspector	\N	\N	\N	\N
8	Noor	qc@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	qc	9	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-22 07:46:18.654988+00	active	internal	\N	\N	\N	\N	\N	9900000008	2026-06-22 07:46:18.654988+00	::ffff:127.0.0.1	\N	\N	\N	\N	QC Inspector	\N	\N	\N	\N
5	Zeeshan	floor.manager@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	floor_manager	14	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-22 05:43:54.055905+00	active	internal	\N	\N	\N	\N	\N	9900000005	2026-06-22 05:43:54.055905+00	::ffff:127.0.0.1	\N	\N	\N	\N	Floor Manager	\N	\N	\N	\N
17	Jotis	dispatch_qc@rentfoxxy.com	$2a$10$IdNQtra.AlzMq5yPDg5/Bexwz4hxLtDncPbIUXFcyXZYTV0TC20Qm	dispatch_qc	\N	t	\N	{qc_access}	2026-06-22 07:38:20.075192+00	2026-06-22 07:50:31.385346+00	active	internal	\N	\N	\N	\N	\N	\N	2026-06-22 07:50:31.385346+00	::ffff:127.0.0.1	\N	\N	\N	\N	\N	\N	\N	\N	\N
6	Ravi Kumar	technician@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	team_member	14	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-20 13:10:36.645257+00	active	internal	\N	\N	\N	\N	\N	9900000006	2026-06-20 13:10:36.645257+00	::ffff:127.0.0.1	\N	\N	\N	\N	Hardware Technician	\N	\N	\N	\N
2	Admin User	admin@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	admin	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-22 12:47:04.760717+00	active	internal	\N	\N	\N	\N	\N	9900000002	2026-06-22 12:47:04.760717+00	::1	\N	\N	\N	\N	Administrator	\N	\N	\N	\N
15	Rahul Das	support.tech@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	support_tech	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-22 12:48:22.901364+00	active	internal	\N	\N	\N	\N	\N	9900000015	2026-06-22 12:48:22.901364+00	::1	\N	\N	\N	\N	Support Technician	\N	\N	\N	\N
4	Omprakash	sales@rentfoxxy.com	$2b$10$N9qo8uLOickgx2ZMRZoMyO.TQkPsUdP6PdWCZjFVMCVrBZyDqKH/K	sales	\N	t	\N	{}	2026-06-14 11:57:00.158718+00	2026-06-23 04:38:01.809054+00	active	internal	\N	\N	\N	\N	\N	9900000004	2026-06-23 04:38:01.809054+00	::1	\N	\N	\N	\N	Sales Executive	\N	\N	\N	\N
\.


--
-- Data for Name: vendor_audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_audit_logs (log_id, actor_user_id, vendor_id, entity_type, entity_id, action, payload, created_at) FROM stdin;
\.


--
-- Data for Name: vendor_billing; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_billing (billing_id, vendor_id, billing_month, billing_year, status, assigned_to_user_id, totals, detail, file_path, notes, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: vendor_debit_notes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_debit_notes (debit_note_id, debit_note_number, vendor_id, po_id, reason, description, amount, quantity, unit_rate, ttspl_ids, status, adjusted_in_bill_id, created_by, approved_by, created_at, updated_at, serial_id, return_ticket_id, support_ticket_id) FROM stdin;
\.


--
-- Data for Name: vendor_goods_received_notes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_goods_received_notes (grn_id, po_id, meta, created_at, updated_at, deleted_at, spo_id, bill_status, bill_files, bill_name) FROM stdin;
\.


--
-- Data for Name: vendor_inventory_asset_sequence; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_inventory_asset_sequence (id, next_num) FROM stdin;
1	146
\.


--
-- Data for Name: vendor_monthly_bills; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_monthly_bills (bill_id, bill_number, vendor_id, bill_month, bill_year, bill_date, from_date, to_date, line_items, subtotal, gst_amount, debit_note_adjustment, total_payable, status, payment_date, payment_reference, notes, generated_by, approved_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendor_portal_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_portal_sessions (session_id, vendor_id, token, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: vendor_product_details; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_product_details (product_detail_id, po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size, quantity, rate, remarks, total_amount, vendor_locking_period, warranty, parts, status, random_id, old_product_id, old_product_details, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendor_product_inventory; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_product_inventory (id, product_id, serial_id, serial_number, unique_product_serial, product_model_name, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendor_purchase_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_purchase_orders (po_id, purchase_order_number, purchase_order_date, purchase_order_type, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, line_items, assets_details, product_details_legacy_ids, remarks, public_token, status, invoice_created, invoice_path, rental_period, status_updated_by_admin_id, status_updated_by_name, created_at, updated_at, deleted_at, bill_name, bill_files, expected_delivery_date, rejection_reason, submitted_at, approved_at, sent_to_vendor_at, vendor_invoice_number, vendor_invoice_file, vendor_invoice_uploaded_at) FROM stdin;
\.


--
-- Data for Name: vendor_refresh_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_refresh_tokens (id, vendor_id, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: vendor_replaced_products; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_replaced_products (replaced_id, vendor_id, po_id, payload, status, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: vendor_serial_number_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_serial_number_audit (audit_id, po_id, grn_id, old_serial, new_serial, changed_by_user_id, created_at) FROM stdin;
\.


--
-- Data for Name: vendor_serial_numbers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_serial_numbers (serial_id, po_id, grn_id, serial_number, extra, created_at, updated_at, deleted_at, spo_id, inventory_asset_code, rental_start_date, qc_status, inventory_status, remark, current_customer_id, current_dc_number, current_entity, dispatch_mode, dispatched_at, delivered_at, returned_at, rent_start_date, rent_end_date, rent_monthly_rate, status_changed_at, rent_billed_until) FROM stdin;
\.


--
-- Data for Name: vendor_shops; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_shops (shop_id, vendor_id, name, address, contact, image_url, banner_url, created_at, updated_at, deleted_at) FROM stdin;
\.


--
-- Data for Name: vendor_spare_parts_catalog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_spare_parts_catalog (part_id, name, active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendor_spare_parts_purchase_orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_spare_parts_purchase_orders (spo_id, purchase_order_number, purchase_order_date, vendor_id, po_state, is_same_state, sub_total_amount, total_amount, line_items, assets_details, remarks, public_token, status, status_updated_by_admin_id, status_updated_by_name, created_at, updated_at, deleted_at, bill_name, bill_files) FROM stdin;
\.


--
-- Data for Name: vendor_wallets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_wallets (wallet_id, vendor_id, withdrawn, commission_given, total_earning, pending_withdraw, delivery_charge_earned, collected_cash, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendors (vendor_id, status, first_name, last_name, business_name, email, phone, password_hash, address, business_type, registration_date, state, gst_number, brand_code, business_registration_number, tax_identification_number, bank_name, account_number, bank_ifsc_code, account_holder_name, image_url, licenses_url, remember_pass_plain, created_at, updated_at, deleted_at, vendor_portal_password_hash, vendor_portal_last_login, vendor_portal_enabled, po_payment_terms, credit_days, pan_number, msme_number, contact_person_name, contact_person_phone, alternate_phone, city, pincode, logo_url, notes) FROM stdin;
\.


--
-- Data for Name: work_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.work_logs (log_id, ticket_id, user_id, stage_id, start_time, end_time, notes, created_at) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: realtime; Owner: postgres
--

COPY realtime.schema_migrations (version, inserted_at) FROM stdin;
20211116024918	2026-02-03 12:28:55
20211116045059	2026-02-03 12:28:55
20211116050929	2026-02-03 12:28:55
20211116051442	2026-02-03 12:28:55
20211116212300	2026-02-03 12:28:55
20211116213355	2026-02-03 12:28:55
20211116213934	2026-02-03 12:28:55
20211116214523	2026-02-03 12:28:55
20211122062447	2026-02-03 12:28:55
20211124070109	2026-02-03 12:28:55
20211202204204	2026-02-03 12:28:55
20211202204605	2026-02-03 12:28:55
20211210212804	2026-02-03 12:28:55
20211228014915	2026-02-03 12:28:55
20220107221237	2026-02-03 12:28:55
20220228202821	2026-02-03 12:28:55
20220312004840	2026-02-03 12:28:55
20220603231003	2026-02-03 12:28:55
20220603232444	2026-02-03 12:28:55
20220615214548	2026-02-03 12:28:55
20220712093339	2026-02-03 12:28:55
20220908172859	2026-02-03 12:28:55
20220916233421	2026-02-03 12:28:55
20230119133233	2026-02-03 12:28:55
20230128025114	2026-02-03 12:28:55
20230128025212	2026-02-03 12:28:55
20230227211149	2026-02-03 12:28:55
20230228184745	2026-02-03 12:28:55
20230308225145	2026-02-03 12:28:55
20230328144023	2026-02-03 12:28:55
20231018144023	2026-02-03 12:28:55
20231204144023	2026-02-03 12:28:55
20231204144024	2026-02-03 12:28:55
20231204144025	2026-02-03 12:28:55
20240108234812	2026-02-03 12:28:55
20240109165339	2026-02-03 12:28:55
20240227174441	2026-02-03 12:28:55
20240311171622	2026-02-03 12:28:55
20240321100241	2026-02-03 12:28:55
20240401105812	2026-02-03 12:28:55
20240418121054	2026-02-03 12:28:55
20240523004032	2026-02-03 12:28:55
20240618124746	2026-02-03 12:28:55
20240801235015	2026-02-03 12:28:55
20240805133720	2026-02-03 12:28:55
20240827160934	2026-02-03 12:28:55
20240919163303	2026-02-03 12:28:55
20240919163305	2026-02-03 12:28:55
20241019105805	2026-02-03 12:28:55
20241030150047	2026-02-03 12:28:55
20241108114728	2026-02-03 12:28:55
20241121104152	2026-02-03 12:28:55
20241130184212	2026-02-03 12:28:55
20241220035512	2026-02-03 12:28:55
20241220123912	2026-02-03 12:28:55
20241224161212	2026-02-03 12:28:55
20250107150512	2026-02-03 12:28:55
20250110162412	2026-02-03 12:28:55
20250123174212	2026-02-03 12:28:55
20250128220012	2026-02-03 12:28:55
20250506224012	2026-02-03 12:28:55
20250523164012	2026-02-03 12:28:55
20250714121412	2026-02-03 12:28:55
20250905041441	2026-02-03 12:28:55
20251103001201	2026-02-03 12:28:55
20251120212548	2026-02-12 09:22:28
20251120215549	2026-02-12 09:22:29
\.


--
-- Data for Name: subscription; Type: TABLE DATA; Schema: realtime; Owner: postgres
--

COPY realtime.subscription (id, subscription_id, entity, filters, claims, created_at, action_filter) FROM stdin;
\.


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.buckets (id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type) FROM stdin;
\.


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.buckets_analytics (name, type, format, created_at, updated_at, id, deleted_at) FROM stdin;
\.


--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.buckets_vectors (id, type, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.migrations (id, name, hash, executed_at) FROM stdin;
0	create-migrations-table	e18db593bcde2aca2a408c4d1100f6abba2195df	2026-02-03 09:52:49.745946
1	initialmigration	6ab16121fbaa08bbd11b712d05f358f9b555d777	2026-02-03 09:52:49.791977
3	pathtoken-column	2cb1b0004b817b29d5b0a971af16bafeede4b70d	2026-02-03 09:52:49.826821
4	add-migrations-rls	427c5b63fe1c5937495d9c635c263ee7a5905058	2026-02-03 09:52:49.841905
5	add-size-functions	79e081a1455b63666c1294a440f8ad4b1e6a7f84	2026-02-03 09:52:49.844472
7	add-rls-to-buckets	e7e7f86adbc51049f341dfe8d30256c1abca17aa	2026-02-03 09:52:49.851024
8	add-public-to-buckets	fd670db39ed65f9d08b01db09d6202503ca2bab3	2026-02-03 09:52:49.854137
11	add-trigger-to-auto-update-updated_at-column	7425bdb14366d1739fa8a18c83100636d74dcaa2	2026-02-03 09:52:49.863841
12	add-automatic-avif-detection-flag	8e92e1266eb29518b6a4c5313ab8f29dd0d08df9	2026-02-03 09:52:49.86728
13	add-bucket-custom-limits	cce962054138135cd9a8c4bcd531598684b25e7d	2026-02-03 09:52:49.871392
14	use-bytes-for-max-size	941c41b346f9802b411f06f30e972ad4744dad27	2026-02-03 09:52:49.875505
15	add-can-insert-object-function	934146bc38ead475f4ef4b555c524ee5d66799e5	2026-02-03 09:52:49.900584
16	add-version	76debf38d3fd07dcfc747ca49096457d95b1221b	2026-02-03 09:52:49.903621
17	drop-owner-foreign-key	f1cbb288f1b7a4c1eb8c38504b80ae2a0153d101	2026-02-03 09:52:49.907023
18	add_owner_id_column_deprecate_owner	e7a511b379110b08e2f214be852c35414749fe66	2026-02-03 09:52:49.909548
19	alter-default-value-objects-id	02e5e22a78626187e00d173dc45f58fa66a4f043	2026-02-03 09:52:49.914425
20	list-objects-with-delimiter	cd694ae708e51ba82bf012bba00caf4f3b6393b7	2026-02-03 09:52:49.918485
21	s3-multipart-uploads	8c804d4a566c40cd1e4cc5b3725a664a9303657f	2026-02-03 09:52:49.923496
22	s3-multipart-uploads-big-ints	9737dc258d2397953c9953d9b86920b8be0cdb73	2026-02-03 09:52:49.934335
23	optimize-search-function	9d7e604cddc4b56a5422dc68c9313f4a1b6f132c	2026-02-03 09:52:49.943151
24	operation-function	8312e37c2bf9e76bbe841aa5fda889206d2bf8aa	2026-02-03 09:52:49.946147
25	custom-metadata	d974c6057c3db1c1f847afa0e291e6165693b990	2026-02-03 09:52:49.949232
37	add-bucket-name-length-trigger	3944135b4e3e8b22d6d4cbb568fe3b0b51df15c1	2026-02-03 09:52:50.020098
44	vector-bucket-type	99c20c0ffd52bb1ff1f32fb992f3b351e3ef8fb3	2026-02-03 09:52:50.053617
45	vector-buckets	049e27196d77a7cb76497a85afae669d8b230953	2026-02-03 09:52:50.057623
46	buckets-objects-grants	fedeb96d60fefd8e02ab3ded9fbde05632f84aed	2026-02-03 09:52:50.083603
47	iceberg-table-metadata	649df56855c24d8b36dd4cc1aeb8251aa9ad42c2	2026-02-03 09:52:50.087943
49	buckets-objects-grants-postgres	072b1195d0d5a2f888af6b2302a1938dd94b8b3d	2026-02-03 09:52:50.104774
2	storage-schema	f6a1fa2c93cbcd16d4e487b362e45fca157a8dbd	2026-02-03 09:52:49.796089
6	change-column-name-in-get-size	ded78e2f1b5d7e616117897e6443a925965b30d2	2026-02-03 09:52:49.847824
9	fix-search-function	af597a1b590c70519b464a4ab3be54490712796b	2026-02-03 09:52:49.857255
10	search-files-search-function	b595f05e92f7e91211af1bbfe9c6a13bb3391e16	2026-02-03 09:52:49.86028
26	objects-prefixes	215cabcb7f78121892a5a2037a09fedf9a1ae322	2026-02-03 09:52:49.952329
27	search-v2	859ba38092ac96eb3964d83bf53ccc0b141663a6	2026-02-03 09:52:49.963224
28	object-bucket-name-sorting	c73a2b5b5d4041e39705814fd3a1b95502d38ce4	2026-02-03 09:52:49.970744
29	create-prefixes	ad2c1207f76703d11a9f9007f821620017a66c21	2026-02-03 09:52:49.976804
30	update-object-levels	2be814ff05c8252fdfdc7cfb4b7f5c7e17f0bed6	2026-02-03 09:52:49.981897
31	objects-level-index	b40367c14c3440ec75f19bbce2d71e914ddd3da0	2026-02-03 09:52:49.988096
32	backward-compatible-index-on-objects	e0c37182b0f7aee3efd823298fb3c76f1042c0f7	2026-02-03 09:52:49.994029
33	backward-compatible-index-on-prefixes	b480e99ed951e0900f033ec4eb34b5bdcb4e3d49	2026-02-03 09:52:50.000238
34	optimize-search-function-v1	ca80a3dc7bfef894df17108785ce29a7fc8ee456	2026-02-03 09:52:50.001891
35	add-insert-trigger-prefixes	458fe0ffd07ec53f5e3ce9df51bfdf4861929ccc	2026-02-03 09:52:50.00623
36	optimise-existing-functions	6ae5fca6af5c55abe95369cd4f93985d1814ca8f	2026-02-03 09:52:50.009472
38	iceberg-catalog-flag-on-buckets	02716b81ceec9705aed84aa1501657095b32e5c5	2026-02-03 09:52:50.023489
39	add-search-v2-sort-support	6706c5f2928846abee18461279799ad12b279b78	2026-02-03 09:52:50.032511
40	fix-prefix-race-conditions-optimized	7ad69982ae2d372b21f48fc4829ae9752c518f6b	2026-02-03 09:52:50.035977
41	add-object-level-update-trigger	07fcf1a22165849b7a029deed059ffcde08d1ae0	2026-02-03 09:52:50.042026
42	rollback-prefix-triggers	771479077764adc09e2ea2043eb627503c034cd4	2026-02-03 09:52:50.045879
43	fix-object-level	84b35d6caca9d937478ad8a797491f38b8c2979f	2026-02-03 09:52:50.050099
48	iceberg-catalog-ids	e0e8b460c609b9999ccd0df9ad14294613eed939	2026-02-03 09:52:50.092105
50	search-v2-optimised	6323ac4f850aa14e7387eb32102869578b5bd478	2026-02-12 09:22:30.250814
51	index-backward-compatible-search	2ee395d433f76e38bcd3856debaf6e0e5b674011	2026-02-12 09:22:30.752024
52	drop-not-used-indexes-and-functions	5cc44c8696749ac11dd0dc37f2a3802075f3a171	2026-02-12 09:22:30.752979
53	drop-index-lower-name	d0cb18777d9e2a98ebe0bc5cc7a42e57ebe41854	2026-02-12 09:22:30.77783
54	drop-index-object-level	6289e048b1472da17c31a7eba1ded625a6457e67	2026-02-12 09:22:30.779127
55	prevent-direct-deletes	262a4798d5e0f2e7c8970232e03ce8be695d5819	2026-02-12 09:22:30.779901
56	fix-optimized-search-function	cb58526ebc23048049fd5bf2fd148d18b04a2073	2026-02-12 09:22:30.785141
\.


--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.objects (id, bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata, version, owner_id, user_metadata) FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at, user_metadata) FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.s3_multipart_uploads_parts (id, upload_id, size, part_number, bucket_id, key, etag, owner_id, version, created_at) FROM stdin;
\.


--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: postgres
--

COPY storage.vector_indexes (id, name, bucket_id, data_type, dimension, distance_metric, metadata_configuration, created_at, updated_at) FROM stdin;
\.


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: postgres
--

SELECT pg_catalog.setval('auth.refresh_tokens_id_seq', 1, false);


--
-- Name: activities_activity_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.activities_activity_id_seq', 1, false);


--
-- Name: allocation_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.allocation_logs_id_seq', 1, false);


--
-- Name: asset_config_brands_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_brands_id_seq', 1, false);


--
-- Name: asset_config_generations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_generations_id_seq', 1, false);


--
-- Name: asset_config_gpu_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_gpu_id_seq', 1, false);


--
-- Name: asset_config_models_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_models_id_seq', 1, false);


--
-- Name: asset_config_processors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_processors_id_seq', 1, false);


--
-- Name: asset_config_ram_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_ram_id_seq', 1, false);


--
-- Name: asset_config_screen_sizes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_screen_sizes_id_seq', 1, false);


--
-- Name: asset_config_storage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_config_storage_id_seq', 1, false);


--
-- Name: chip_level_repairs_repair_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.chip_level_repairs_repair_id_seq', 1, false);


--
-- Name: companies_company_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.companies_company_id_seq', 1, false);


--
-- Name: customer_addresses_customer_address_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_addresses_customer_address_id_seq', 1, false);


--
-- Name: customer_credit_notes_credit_note_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_credit_notes_credit_note_id_seq', 1, false);


--
-- Name: customer_documents_doc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_documents_doc_id_seq', 1, false);


--
-- Name: customer_inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_inventory_id_seq', 1, false);


--
-- Name: customer_invoices_invoice_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_invoices_invoice_id_seq', 1, false);


--
-- Name: customer_portal_sessions_session_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_portal_sessions_session_id_seq', 1, false);


--
-- Name: customer_security_deposits_deposit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_security_deposits_deposit_id_seq', 1, false);


--
-- Name: customers_customer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customers_customer_id_seq', 1, false);


--
-- Name: dc_qc_tickets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dc_qc_tickets_id_seq', 1, false);


--
-- Name: delivery_challan_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.delivery_challan_lines_id_seq', 1, false);


--
-- Name: delivery_technicians_technician_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.delivery_technicians_technician_id_seq', 1, false);


--
-- Name: demo_agreements_demo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.demo_agreements_demo_id_seq', 1, false);


--
-- Name: diagnosis_images_image_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.diagnosis_images_image_id_seq', 1, false);


--
-- Name: diagnosis_parts_required_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.diagnosis_parts_required_id_seq', 1, false);


--
-- Name: diagnosis_results_diagnosis_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.diagnosis_results_diagnosis_id_seq', 1, false);


--
-- Name: einvoice_records_record_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.einvoice_records_record_id_seq', 1, false);


--
-- Name: email_queue_email_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.email_queue_email_id_seq', 1, false);


--
-- Name: eway_bill_records_record_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.eway_bill_records_record_id_seq', 1, false);


--
-- Name: grn_access_attempts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grn_access_attempts_id_seq', 1, false);


--
-- Name: grn_access_number_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grn_access_number_seq', 17, false);


--
-- Name: grn_access_numbers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grn_access_numbers_id_seq', 1, false);


--
-- Name: grn_config_verifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grn_config_verifications_id_seq', 1, false);


--
-- Name: inventory_inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_inventory_id_seq', 1, false);


--
-- Name: inventory_status_transitions_transition_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_status_transitions_transition_id_seq', 1, false);


--
-- Name: inward_outward_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inward_outward_id_seq', 1, false);


--
-- Name: laptop_catalog_catalog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.laptop_catalog_catalog_id_seq', 1, false);


--
-- Name: lead_activities_activity_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_activities_activity_id_seq', 1, true);


--
-- Name: lead_addresses_address_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_addresses_address_id_seq', 1, false);


--
-- Name: lead_assignments_assignment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_assignments_assignment_id_seq', 1, true);


--
-- Name: lead_auto_assign_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_auto_assign_config_id_seq', 1, false);


--
-- Name: lead_company_research_research_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_company_research_research_id_seq', 1, true);


--
-- Name: lead_followup_notifications_notification_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_followup_notifications_notification_id_seq', 1, false);


--
-- Name: lead_import_logs_import_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_import_logs_import_id_seq', 1, false);


--
-- Name: lead_orders_lead_order_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_orders_lead_order_id_seq', 1, false);


--
-- Name: lead_remarks_remark_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lead_remarks_remark_id_seq', 1, false);


--
-- Name: leads_lead_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.leads_lead_id_seq', 1, true);


--
-- Name: order_items_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.order_items_item_id_seq', 1, false);


--
-- Name: orders_order_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.orders_order_id_seq', 1, false);


--
-- Name: part_instances_instance_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.part_instances_instance_id_seq', 1, false);


--
-- Name: part_requests_request_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.part_requests_request_id_seq', 1, false);


--
-- Name: parts_part_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.parts_part_id_seq', 1, false);


--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permission_audit_logs_id_seq', 23, true);


--
-- Name: permission_sections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permission_sections_id_seq', 4984, true);


--
-- Name: photos_photo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.photos_photo_id_seq', 1, false);


--
-- Name: procurement_requests_request_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.procurement_requests_request_id_seq', 1, false);


--
-- Name: qc_photos_photo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.qc_photos_photo_id_seq', 1, false);


--
-- Name: qc_results_qc_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.qc_results_qc_id_seq', 1, false);


--
-- Name: rent_devices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rent_devices_id_seq', 1, false);


--
-- Name: repair_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.repair_logs_id_seq', 1, false);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.role_permissions_id_seq', 23093, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 403, true);


--
-- Name: sales_order_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sales_order_lines_id_seq', 1, false);


--
-- Name: sales_order_payments_payment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sales_order_payments_payment_id_seq', 1, false);


--
-- Name: sales_order_serials_allocation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sales_order_serials_allocation_id_seq', 1, false);


--
-- Name: sales_quotations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sales_quotations_id_seq', 1, false);


--
-- Name: sm_courier_details_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sm_courier_details_id_seq', 1, false);


--
-- Name: spare_parts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.spare_parts_id_seq', 1, true);


--
-- Name: stage_checklists_checklist_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stage_checklists_checklist_id_seq', 1, false);


--
-- Name: stage_transition_rules_rule_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stage_transition_rules_rule_id_seq', 36, true);


--
-- Name: stages_stage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stages_stage_id_seq', 12, true);


--
-- Name: support_challan_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_challan_items_id_seq', 1, false);


--
-- Name: support_issue_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_issue_categories_id_seq', 994, true);


--
-- Name: support_part_challans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_part_challans_id_seq', 1, false);


--
-- Name: support_part_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_part_requests_id_seq', 1, false);


--
-- Name: support_replacement_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_replacement_orders_id_seq', 1, false);


--
-- Name: support_ticket_item_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_ticket_item_audit_id_seq', 1, false);


--
-- Name: support_ticket_item_comments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_ticket_item_comments_id_seq', 1, false);


--
-- Name: support_ticket_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_ticket_items_id_seq', 1, false);


--
-- Name: support_tickets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_tickets_id_seq', 1, false);


--
-- Name: teams_team_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.teams_team_id_seq', 92, true);


--
-- Name: ticket_checklist_progress_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ticket_checklist_progress_id_seq', 1, false);


--
-- Name: ticket_part_blocks_block_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ticket_part_blocks_block_id_seq', 1, false);


--
-- Name: ticket_parts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ticket_parts_id_seq', 1, false);


--
-- Name: ticket_services_service_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ticket_services_service_id_seq', 1, false);


--
-- Name: tickets_ticket_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tickets_ticket_id_seq', 1, false);


--
-- Name: ttspl_audit_log_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ttspl_audit_log_log_id_seq', 1, false);


--
-- Name: ttspl_config_history_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ttspl_config_history_history_id_seq', 1, false);


--
-- Name: user_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_permissions_id_seq', 5, true);


--
-- Name: users_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_user_id_seq', 17, true);


--
-- Name: vendor_audit_logs_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_audit_logs_log_id_seq', 1, false);


--
-- Name: vendor_billing_billing_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_billing_billing_id_seq', 1, false);


--
-- Name: vendor_debit_notes_debit_note_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_debit_notes_debit_note_id_seq', 1, false);


--
-- Name: vendor_goods_received_notes_grn_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_goods_received_notes_grn_id_seq', 1, false);


--
-- Name: vendor_monthly_bills_bill_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_monthly_bills_bill_id_seq', 1, false);


--
-- Name: vendor_portal_sessions_session_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_portal_sessions_session_id_seq', 1, false);


--
-- Name: vendor_product_details_product_detail_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_product_details_product_detail_id_seq', 1, false);


--
-- Name: vendor_product_inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_product_inventory_id_seq', 1, false);


--
-- Name: vendor_purchase_orders_po_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_purchase_orders_po_id_seq', 1, false);


--
-- Name: vendor_refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_refresh_tokens_id_seq', 1, false);


--
-- Name: vendor_replaced_products_replaced_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_replaced_products_replaced_id_seq', 1, false);


--
-- Name: vendor_serial_number_audit_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_serial_number_audit_audit_id_seq', 1, false);


--
-- Name: vendor_serial_numbers_serial_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_serial_numbers_serial_id_seq', 1, false);


--
-- Name: vendor_shops_shop_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_shops_shop_id_seq', 1, false);


--
-- Name: vendor_spare_parts_catalog_part_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_spare_parts_catalog_part_id_seq', 1, false);


--
-- Name: vendor_spare_parts_purchase_orders_spo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_spare_parts_purchase_orders_spo_id_seq', 1, false);


--
-- Name: vendor_wallets_wallet_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_wallets_wallet_id_seq', 1, false);


--
-- Name: vendors_vendor_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendors_vendor_id_seq', 1, false);


--
-- Name: work_logs_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.work_logs_log_id_seq', 1, false);


--
-- Name: subscription_id_seq; Type: SEQUENCE SET; Schema: realtime; Owner: postgres
--

SELECT pg_catalog.setval('realtime.subscription_id_seq', 1, false);


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
-- Name: asset_config_brands asset_config_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_brands
    ADD CONSTRAINT asset_config_brands_pkey PRIMARY KEY (id);


--
-- Name: asset_config_generations asset_config_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_generations
    ADD CONSTRAINT asset_config_generations_pkey PRIMARY KEY (id);


--
-- Name: asset_config_gpu asset_config_gpu_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_gpu
    ADD CONSTRAINT asset_config_gpu_pkey PRIMARY KEY (id);


--
-- Name: asset_config_models asset_config_models_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_models
    ADD CONSTRAINT asset_config_models_pkey PRIMARY KEY (id);


--
-- Name: asset_config_processors asset_config_processors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_processors
    ADD CONSTRAINT asset_config_processors_pkey PRIMARY KEY (id);


--
-- Name: asset_config_ram asset_config_ram_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_ram
    ADD CONSTRAINT asset_config_ram_pkey PRIMARY KEY (id);


--
-- Name: asset_config_screen_sizes asset_config_screen_sizes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_screen_sizes
    ADD CONSTRAINT asset_config_screen_sizes_pkey PRIMARY KEY (id);


--
-- Name: asset_config_storage asset_config_storage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_storage
    ADD CONSTRAINT asset_config_storage_pkey PRIMARY KEY (id);


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
-- Name: companies companies_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_code_key UNIQUE (code);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (company_id);


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
-- Name: customer_credit_notes customer_credit_notes_credit_note_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_credit_note_number_key UNIQUE (credit_note_number);


--
-- Name: customer_credit_notes customer_credit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_pkey PRIMARY KEY (credit_note_id);


--
-- Name: customer_documents customer_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_pkey PRIMARY KEY (doc_id);


--
-- Name: customer_inventory customer_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_inventory
    ADD CONSTRAINT customer_inventory_pkey PRIMARY KEY (id);


--
-- Name: customer_invoices customer_invoices_customer_id_invoice_month_invoice_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_customer_id_invoice_month_invoice_year_key UNIQUE (customer_id, invoice_month, invoice_year);


--
-- Name: customer_invoices customer_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: customer_invoices customer_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_pkey PRIMARY KEY (invoice_id);


--
-- Name: customer_portal_sessions customer_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: customer_portal_sessions customer_portal_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_token_key UNIQUE (token);


--
-- Name: customer_security_deposits customer_security_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_security_deposits
    ADD CONSTRAINT customer_security_deposits_pkey PRIMARY KEY (deposit_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (customer_id);


--
-- Name: dc_qc_tickets dc_qc_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_qc_tickets
    ADD CONSTRAINT dc_qc_tickets_pkey PRIMARY KEY (id);


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
-- Name: demo_agreements demo_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_pkey PRIMARY KEY (demo_id);


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
-- Name: einvoice_records einvoice_records_irn_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_irn_key UNIQUE (irn);


--
-- Name: einvoice_records einvoice_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_pkey PRIMARY KEY (record_id);


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
-- Name: eway_bill_records eway_bill_records_ewb_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.eway_bill_records
    ADD CONSTRAINT eway_bill_records_ewb_number_key UNIQUE (ewb_number);


--
-- Name: eway_bill_records eway_bill_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.eway_bill_records
    ADD CONSTRAINT eway_bill_records_pkey PRIMARY KEY (record_id);


--
-- Name: existing_customer existing_customer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.existing_customer
    ADD CONSTRAINT existing_customer_pkey PRIMARY KEY (customer_id);


--
-- Name: grn_access_attempts grn_access_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_access_attempts
    ADD CONSTRAINT grn_access_attempts_pkey PRIMARY KEY (id);


--
-- Name: grn_access_numbers grn_access_numbers_access_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_access_numbers
    ADD CONSTRAINT grn_access_numbers_access_number_key UNIQUE (access_number);


--
-- Name: grn_access_numbers grn_access_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_access_numbers
    ADD CONSTRAINT grn_access_numbers_pkey PRIMARY KEY (id);


--
-- Name: grn_config_verifications grn_config_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_config_verifications
    ADD CONSTRAINT grn_config_verifications_pkey PRIMARY KEY (id);


--
-- Name: grn_serial_capture_tokens grn_serial_capture_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_serial_capture_tokens
    ADD CONSTRAINT grn_serial_capture_tokens_pkey PRIMARY KEY (token_id);


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
-- Name: inventory_status_transitions inventory_status_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_status_transitions
    ADD CONSTRAINT inventory_status_transitions_pkey PRIMARY KEY (transition_id);


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
-- Name: lead_import_logs lead_import_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_import_logs
    ADD CONSTRAINT lead_import_logs_pkey PRIMARY KEY (import_id);


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
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (order_id);


--
-- Name: part_instances part_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_instances
    ADD CONSTRAINT part_instances_pkey PRIMARY KEY (instance_id);


--
-- Name: part_instances part_instances_prt_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_instances
    ADD CONSTRAINT part_instances_prt_id_key UNIQUE (prt_id);


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
-- Name: sales_order_payments sales_order_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_payments
    ADD CONSTRAINT sales_order_payments_pkey PRIMARY KEY (payment_id);


--
-- Name: sales_order_serials sales_order_serials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_serials
    ADD CONSTRAINT sales_order_serials_pkey PRIMARY KEY (allocation_id);


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
-- Name: stage_transition_rules stage_transition_rules_from_stage_name_to_stage_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_transition_rules
    ADD CONSTRAINT stage_transition_rules_from_stage_name_to_stage_name_key UNIQUE (from_stage_name, to_stage_name);


--
-- Name: stage_transition_rules stage_transition_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stage_transition_rules
    ADD CONSTRAINT stage_transition_rules_pkey PRIMARY KEY (rule_id);


--
-- Name: stages stages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stages
    ADD CONSTRAINT stages_pkey PRIMARY KEY (stage_id);


--
-- Name: support_challan_items support_challan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_challan_items
    ADD CONSTRAINT support_challan_items_pkey PRIMARY KEY (id);


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
-- Name: support_part_challans support_part_challans_challan_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_challans
    ADD CONSTRAINT support_part_challans_challan_number_key UNIQUE (challan_number);


--
-- Name: support_part_challans support_part_challans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_challans
    ADD CONSTRAINT support_part_challans_pkey PRIMARY KEY (id);


--
-- Name: support_part_requests support_part_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_pkey PRIMARY KEY (id);


--
-- Name: support_part_requests support_part_requests_request_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_request_number_key UNIQUE (request_number);


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
-- Name: ticket_part_blocks ticket_part_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_part_blocks
    ADD CONSTRAINT ticket_part_blocks_pkey PRIMARY KEY (block_id);


--
-- Name: ticket_part_blocks ticket_part_blocks_ticket_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_part_blocks
    ADD CONSTRAINT ticket_part_blocks_ticket_id_request_id_key UNIQUE (ticket_id, request_id);


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
-- Name: ttspl_audit_log ttspl_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_audit_log
    ADD CONSTRAINT ttspl_audit_log_pkey PRIMARY KEY (log_id);


--
-- Name: ttspl_config_history ttspl_config_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_pkey PRIMARY KEY (history_id);


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
-- Name: vendor_debit_notes vendor_debit_notes_debit_note_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_debit_note_number_key UNIQUE (debit_note_number);


--
-- Name: vendor_debit_notes vendor_debit_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_pkey PRIMARY KEY (debit_note_id);


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
-- Name: vendor_monthly_bills vendor_monthly_bills_bill_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_bill_number_key UNIQUE (bill_number);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_pkey PRIMARY KEY (bill_id);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_vendor_id_bill_month_bill_year_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_vendor_id_bill_month_bill_year_key UNIQUE (vendor_id, bill_month, bill_year);


--
-- Name: vendor_portal_sessions vendor_portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_portal_sessions
    ADD CONSTRAINT vendor_portal_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: vendor_portal_sessions vendor_portal_sessions_token_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_portal_sessions
    ADD CONSTRAINT vendor_portal_sessions_token_key UNIQUE (token);


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
-- Name: customers_source_lead_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX customers_source_lead_id_key ON public.customers USING btree (source_lead_id) WHERE (source_lead_id IS NOT NULL);


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
-- Name: idx_asset_config_generations_processor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_asset_config_generations_processor ON public.asset_config_generations USING btree (processor_id);


--
-- Name: idx_asset_config_models_brand; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_asset_config_models_brand ON public.asset_config_models USING btree (brand_id);


--
-- Name: idx_credit_notes_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_credit_notes_customer ON public.customer_credit_notes USING btree (customer_id);


--
-- Name: idx_credit_notes_return_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_credit_notes_return_ticket ON public.customer_credit_notes USING btree (return_ticket_id);


--
-- Name: idx_customer_addresses_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_addresses_customer_id ON public.customer_addresses USING btree (customer_id);


--
-- Name: idx_customer_docs_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_docs_customer ON public.customer_documents USING btree (customer_id);


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
-- Name: idx_customer_invoices_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_invoices_customer ON public.customer_invoices USING btree (customer_id);


--
-- Name: idx_customer_invoices_month_year; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_invoices_month_year ON public.customer_invoices USING btree (invoice_year, invoice_month);


--
-- Name: idx_customer_invoices_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_invoices_status ON public.customer_invoices USING btree (status);


--
-- Name: idx_customer_portal_sessions_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_portal_sessions_customer ON public.customer_portal_sessions USING btree (customer_id);


--
-- Name: idx_customer_portal_sessions_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customer_portal_sessions_expires ON public.customer_portal_sessions USING btree (expires_at);


--
-- Name: idx_customers_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_status ON public.customers USING btree (status);


--
-- Name: idx_customers_updated_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_updated_at ON public.customers USING btree (updated_at DESC);


--
-- Name: idx_dc_qc_tickets_dc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dc_qc_tickets_dc ON public.dc_qc_tickets USING btree (dc_number);


--
-- Name: idx_dcl_delivery_person; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dcl_delivery_person ON public.delivery_challan_lines USING btree (delivery_person_id);


--
-- Name: idx_dcl_movement; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dcl_movement ON public.delivery_challan_lines USING btree (movement_type);


--
-- Name: idx_dcl_status2; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dcl_status2 ON public.delivery_challan_lines USING btree (status);


--
-- Name: idx_dcl_support_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_dcl_support_ticket ON public.delivery_challan_lines USING btree (support_ticket_id);


--
-- Name: idx_debit_notes_return_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_debit_notes_return_ticket ON public.vendor_debit_notes USING btree (return_ticket_id);


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
-- Name: idx_demo_agreements_decision; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_demo_agreements_decision ON public.demo_agreements USING btree (decision, decision_due_at);


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
-- Name: idx_einvoice_dc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_einvoice_dc ON public.einvoice_records USING btree (dc_number);


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
-- Name: idx_grn_access_attempts_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_access_attempts_created ON public.grn_access_attempts USING btree (created_at DESC);


--
-- Name: idx_grn_access_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_access_status ON public.grn_access_numbers USING btree (status);


--
-- Name: idx_grn_access_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_access_token ON public.grn_access_numbers USING btree (capture_token);


--
-- Name: idx_grn_capture_tokens_po; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_capture_tokens_po ON public.grn_serial_capture_tokens USING btree (po_id);


--
-- Name: idx_grn_capture_tokens_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_capture_tokens_status ON public.grn_serial_capture_tokens USING btree (status) WHERE (status = 'pending'::text);


--
-- Name: idx_grn_config_verif_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_config_verif_created ON public.grn_config_verifications USING btree (created_at DESC);


--
-- Name: idx_grn_config_verif_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grn_config_verif_token ON public.grn_config_verifications USING btree (token_id);


--
-- Name: idx_inv_status_trans_serial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_status_trans_serial ON public.inventory_status_transitions USING btree (serial_id);


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
-- Name: idx_orders_status_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_status_created ON public.orders USING btree (status, created_at DESC);


--
-- Name: idx_part_instances_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_instances_part_id ON public.part_instances USING btree (part_id);


--
-- Name: idx_part_instances_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_instances_status ON public.part_instances USING btree (status);


--
-- Name: idx_part_instances_ttspl; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_part_instances_ttspl ON public.part_instances USING btree (installed_ttspl_id);


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
-- Name: idx_sales_quotations_lead; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_quotations_lead ON public.sales_quotations USING btree (source_lead_id) WHERE (source_lead_id IS NOT NULL);


--
-- Name: idx_sales_quotations_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_quotations_number ON public.sales_quotations USING btree (quotation_number);


--
-- Name: idx_sales_quotations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_quotations_status ON public.sales_quotations USING btree (status);


--
-- Name: idx_sci_challan; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sci_challan ON public.support_challan_items USING btree (challan_id);


--
-- Name: idx_so_payments_so; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_so_payments_so ON public.sales_order_payments USING btree (sales_order_number);


--
-- Name: idx_sol_delivery_address; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sol_delivery_address ON public.sales_order_lines USING btree (id) WHERE (delivery_address IS NOT NULL);


--
-- Name: idx_sos_line; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sos_line ON public.sales_order_serials USING btree (line_id);


--
-- Name: idx_sos_so; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sos_so ON public.sales_order_serials USING btree (sales_order_number);


--
-- Name: idx_sos_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sos_ticket ON public.sales_order_serials USING btree (qc_ticket_id);


--
-- Name: idx_spc_tech; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_spc_tech ON public.support_part_challans USING btree (issued_to);


--
-- Name: idx_spc_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_spc_ticket ON public.support_part_challans USING btree (support_ticket_id);


--
-- Name: idx_spr_reassign_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_spr_reassign_pending ON public.support_part_requests USING btree (reassign_requested_at) WHERE (reassign_requested_at IS NOT NULL);


--
-- Name: idx_spr_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_spr_status ON public.support_part_requests USING btree (status);


--
-- Name: idx_spr_tech; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_spr_tech ON public.support_part_requests USING btree (assigned_to_tech);


--
-- Name: idx_spr_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_spr_ticket ON public.support_part_requests USING btree (support_ticket_id);


--
-- Name: idx_stages_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_stages_category ON public.stages USING btree (stage_category);


--
-- Name: idx_sti_pickup_bucket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sti_pickup_bucket ON public.support_ticket_items USING btree (pickup_assigned_to) WHERE ((item_type)::text = 'pickup'::text);


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
-- Name: idx_tickets_vendor_serial_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tickets_vendor_serial_id ON public.tickets USING btree (vendor_serial_id) WHERE (vendor_serial_id IS NOT NULL);


--
-- Name: idx_ttspl_audit_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ttspl_audit_created ON public.ttspl_audit_log USING btree (created_at DESC);


--
-- Name: idx_ttspl_audit_ttspl; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ttspl_audit_ttspl ON public.ttspl_audit_log USING btree (ttspl_id);


--
-- Name: idx_ttspl_config_history_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ttspl_config_history_ticket ON public.ttspl_config_history USING btree (ticket_id);


--
-- Name: idx_ttspl_config_history_ttspl; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ttspl_config_history_ttspl ON public.ttspl_config_history USING btree (ttspl_id);


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
-- Name: idx_vendor_portal_sessions_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_portal_sessions_expires ON public.vendor_portal_sessions USING btree (expires_at);


--
-- Name: idx_vendor_portal_sessions_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendor_portal_sessions_vendor ON public.vendor_portal_sessions USING btree (vendor_id);


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
-- Name: idx_vgrn_bill_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vgrn_bill_status ON public.vendor_goods_received_notes USING btree (bill_status) WHERE (deleted_at IS NULL);


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
-- Name: idx_vpo_status_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vpo_status_workflow ON public.vendor_purchase_orders USING btree (status) WHERE (deleted_at IS NULL);


--
-- Name: idx_vpo_vendor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vpo_vendor ON public.vendor_purchase_orders USING btree (vendor_id);


--
-- Name: idx_vsn_current_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vsn_current_customer ON public.vendor_serial_numbers USING btree (current_customer_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_vsn_status_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vsn_status_entity ON public.vendor_serial_numbers USING btree (inventory_status, current_entity) WHERE (deleted_at IS NULL);


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
-- Name: uq_asset_config_brands_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_brands_name ON public.asset_config_brands USING btree (lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_asset_config_generations_proc_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_generations_proc_name ON public.asset_config_generations USING btree (processor_id, lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_asset_config_gpu_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_gpu_name ON public.asset_config_gpu USING btree (lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_asset_config_models_brand_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_models_brand_name ON public.asset_config_models USING btree (brand_id, lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_asset_config_processors_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_processors_name ON public.asset_config_processors USING btree (lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_asset_config_ram_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_ram_name ON public.asset_config_ram USING btree (lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_asset_config_screen_sizes_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_screen_sizes_name ON public.asset_config_screen_sizes USING btree (lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_asset_config_storage_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_asset_config_storage_name ON public.asset_config_storage USING btree (lower(TRIM(BOTH FROM name))) WHERE (deleted_at IS NULL);


--
-- Name: uq_customer_inventory_line; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_customer_inventory_line ON public.customer_inventory USING btree (customer_id, asset_kind, asset_bucket, COALESCE((delivery_challan_id)::text, ''::text), COALESCE(erp_serial_id, ''::character varying), COALESCE(unique_serial_number, ''::character varying), COALESCE(serial_number, ''::character varying));


--
-- Name: uq_sos_serial_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_sos_serial_active ON public.sales_order_serials USING btree (serial_id) WHERE ((status)::text = 'attached'::text);


--
-- Name: uq_tickets_serial_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_tickets_serial_open ON public.tickets USING btree (serial_number) WHERE ((status)::text = ANY (ARRAY[('in_progress'::character varying)::text, ('on_hold'::character varying)::text]));


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
-- Name: lead_activities trg_lead_last_activity; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_lead_last_activity AFTER INSERT ON public.lead_activities FOR EACH ROW EXECUTE FUNCTION public.update_lead_last_activity();


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
-- Name: asset_config_brands asset_config_brands_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_brands
    ADD CONSTRAINT asset_config_brands_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_brands asset_config_brands_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_brands
    ADD CONSTRAINT asset_config_brands_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_generations asset_config_generations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_generations
    ADD CONSTRAINT asset_config_generations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_generations asset_config_generations_processor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_generations
    ADD CONSTRAINT asset_config_generations_processor_id_fkey FOREIGN KEY (processor_id) REFERENCES public.asset_config_processors(id);


--
-- Name: asset_config_generations asset_config_generations_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_generations
    ADD CONSTRAINT asset_config_generations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_gpu asset_config_gpu_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_gpu
    ADD CONSTRAINT asset_config_gpu_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_gpu asset_config_gpu_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_gpu
    ADD CONSTRAINT asset_config_gpu_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_models asset_config_models_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_models
    ADD CONSTRAINT asset_config_models_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.asset_config_brands(id);


--
-- Name: asset_config_models asset_config_models_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_models
    ADD CONSTRAINT asset_config_models_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_models asset_config_models_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_models
    ADD CONSTRAINT asset_config_models_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_processors asset_config_processors_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_processors
    ADD CONSTRAINT asset_config_processors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_processors asset_config_processors_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_processors
    ADD CONSTRAINT asset_config_processors_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_ram asset_config_ram_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_ram
    ADD CONSTRAINT asset_config_ram_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_ram asset_config_ram_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_ram
    ADD CONSTRAINT asset_config_ram_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_screen_sizes asset_config_screen_sizes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_screen_sizes
    ADD CONSTRAINT asset_config_screen_sizes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_screen_sizes asset_config_screen_sizes_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_screen_sizes
    ADD CONSTRAINT asset_config_screen_sizes_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_storage asset_config_storage_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_storage
    ADD CONSTRAINT asset_config_storage_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: asset_config_storage asset_config_storage_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_config_storage
    ADD CONSTRAINT asset_config_storage_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(user_id);


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
-- Name: customer_addresses customer_addresses_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: customer_credit_notes customer_credit_notes_applied_in_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_applied_in_invoice_id_fkey FOREIGN KEY (applied_in_invoice_id) REFERENCES public.customer_invoices(invoice_id);


--
-- Name: customer_credit_notes customer_credit_notes_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: customer_credit_notes customer_credit_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: customer_credit_notes customer_credit_notes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: customer_credit_notes customer_credit_notes_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_credit_notes
    ADD CONSTRAINT customer_credit_notes_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.customer_invoices(invoice_id);


--
-- Name: customer_documents customer_documents_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: customer_documents customer_documents_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(lead_id) ON DELETE SET NULL;


--
-- Name: customer_documents customer_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_documents
    ADD CONSTRAINT customer_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id);


--
-- Name: customer_inventory customer_inventory_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_inventory
    ADD CONSTRAINT customer_inventory_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.existing_customer(customer_id) ON DELETE CASCADE;


--
-- Name: customer_invoices customer_invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: customer_invoices customer_invoices_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_invoices
    ADD CONSTRAINT customer_invoices_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(user_id);


--
-- Name: customer_portal_sessions customer_portal_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_portal_sessions
    ADD CONSTRAINT customer_portal_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: customer_security_deposits customer_security_deposits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_security_deposits
    ADD CONSTRAINT customer_security_deposits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: customer_security_deposits customer_security_deposits_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_security_deposits
    ADD CONSTRAINT customer_security_deposits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: customers customers_kyc_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_kyc_verified_by_fkey FOREIGN KEY (kyc_verified_by) REFERENCES public.users(user_id);


--
-- Name: customers customers_onboarded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_onboarded_by_fkey FOREIGN KEY (onboarded_by) REFERENCES public.users(user_id);


--
-- Name: customers customers_source_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(lead_id) ON DELETE SET NULL;


--
-- Name: dc_qc_tickets dc_qc_tickets_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_qc_tickets
    ADD CONSTRAINT dc_qc_tickets_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


--
-- Name: dc_qc_tickets dc_qc_tickets_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.dc_qc_tickets
    ADD CONSTRAINT dc_qc_tickets_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


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
-- Name: delivery_challan_lines delivery_challan_lines_delivered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_delivered_by_fkey FOREIGN KEY (delivered_by) REFERENCES public.users(user_id);


--
-- Name: delivery_challan_lines delivery_challan_lines_invoice_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_invoice_sent_by_fkey FOREIGN KEY (invoice_sent_by) REFERENCES public.users(user_id);


--
-- Name: delivery_challan_lines delivery_challan_lines_pod_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_pod_submitted_by_fkey FOREIGN KEY (pod_submitted_by) REFERENCES public.users(user_id);


--
-- Name: delivery_challan_lines delivery_challan_lines_pre_dispatch_qc_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_challan_lines
    ADD CONSTRAINT delivery_challan_lines_pre_dispatch_qc_ticket_id_fkey FOREIGN KEY (pre_dispatch_qc_ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: delivery_technicians delivery_technicians_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.delivery_technicians
    ADD CONSTRAINT delivery_technicians_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: demo_agreements demo_agreements_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: demo_agreements demo_agreements_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(user_id);


--
-- Name: demo_agreements demo_agreements_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_agreements
    ADD CONSTRAINT demo_agreements_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


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
-- Name: einvoice_records einvoice_records_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: einvoice_records einvoice_records_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(user_id);


--
-- Name: einvoice_records einvoice_records_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.einvoice_records
    ADD CONSTRAINT einvoice_records_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.customer_invoices(invoice_id);


--
-- Name: eway_bill_records eway_bill_records_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.eway_bill_records
    ADD CONSTRAINT eway_bill_records_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(user_id);


--
-- Name: support_part_requests fk_spr_challan; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT fk_spr_challan FOREIGN KEY (challan_id) REFERENCES public.support_part_challans(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: grn_access_attempts grn_access_attempts_access_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_access_attempts
    ADD CONSTRAINT grn_access_attempts_access_id_fkey FOREIGN KEY (access_id) REFERENCES public.grn_access_numbers(id) ON DELETE SET NULL;


--
-- Name: grn_access_numbers grn_access_numbers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_access_numbers
    ADD CONSTRAINT grn_access_numbers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: grn_config_verifications grn_config_verifications_token_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_config_verifications
    ADD CONSTRAINT grn_config_verifications_token_id_fkey FOREIGN KEY (token_id) REFERENCES public.grn_serial_capture_tokens(token_id);


--
-- Name: grn_serial_capture_tokens grn_serial_capture_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_serial_capture_tokens
    ADD CONSTRAINT grn_serial_capture_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: grn_serial_capture_tokens grn_serial_capture_tokens_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grn_serial_capture_tokens
    ADD CONSTRAINT grn_serial_capture_tokens_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id);


--
-- Name: inventory_status_transitions inventory_status_transitions_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_status_transitions
    ADD CONSTRAINT inventory_status_transitions_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id);


--
-- Name: inventory_status_transitions inventory_status_transitions_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_status_transitions
    ADD CONSTRAINT inventory_status_transitions_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id) ON DELETE CASCADE;


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
-- Name: lead_import_logs lead_import_logs_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lead_import_logs
    ADD CONSTRAINT lead_import_logs_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.users(user_id);


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
-- Name: leads leads_converted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_by_fkey FOREIGN KEY (converted_by) REFERENCES public.users(user_id);


--
-- Name: leads leads_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: leads leads_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.leads(lead_id);


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
-- Name: orders orders_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.users(user_id);


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: orders orders_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(user_id);


--
-- Name: part_instances part_instances_installed_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_instances
    ADD CONSTRAINT part_instances_installed_ticket_id_fkey FOREIGN KEY (installed_ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: part_instances part_instances_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_instances
    ADD CONSTRAINT part_instances_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(part_id);


--
-- Name: part_instances part_instances_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_instances
    ADD CONSTRAINT part_instances_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.users(user_id);


--
-- Name: part_instances part_instances_spo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_instances
    ADD CONSTRAINT part_instances_spo_id_fkey FOREIGN KEY (spo_id) REFERENCES public.vendor_spare_parts_purchase_orders(spo_id);


--
-- Name: part_requests part_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_attached_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_attached_by_fkey FOREIGN KEY (attached_by) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_escalated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_escalated_by_fkey FOREIGN KEY (escalated_by) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.part_instances(instance_id);


--
-- Name: part_requests part_requests_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(part_id);


--
-- Name: part_requests part_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(user_id);


--
-- Name: part_requests part_requests_spo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.part_requests
    ADD CONSTRAINT part_requests_spo_id_fkey FOREIGN KEY (spo_id) REFERENCES public.vendor_spare_parts_purchase_orders(spo_id);


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
-- Name: sales_order_payments sales_order_payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_payments
    ADD CONSTRAINT sales_order_payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: sales_order_payments sales_order_payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_payments
    ADD CONSTRAINT sales_order_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(user_id);


--
-- Name: sales_order_serials sales_order_serials_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_serials
    ADD CONSTRAINT sales_order_serials_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: sales_order_serials sales_order_serials_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_order_serials
    ADD CONSTRAINT sales_order_serials_serial_id_fkey FOREIGN KEY (serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


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
-- Name: sales_quotations sales_quotations_source_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_quotations
    ADD CONSTRAINT sales_quotations_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES public.leads(lead_id);


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
-- Name: support_challan_items support_challan_items_challan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_challan_items
    ADD CONSTRAINT support_challan_items_challan_id_fkey FOREIGN KEY (challan_id) REFERENCES public.support_part_challans(id);


--
-- Name: support_challan_items support_challan_items_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_challan_items
    ADD CONSTRAINT support_challan_items_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.part_instances(instance_id);


--
-- Name: support_challan_items support_challan_items_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_challan_items
    ADD CONSTRAINT support_challan_items_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(part_id);


--
-- Name: support_challan_items support_challan_items_part_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_challan_items
    ADD CONSTRAINT support_challan_items_part_request_id_fkey FOREIGN KEY (part_request_id) REFERENCES public.support_part_requests(id);


--
-- Name: support_part_challans support_part_challans_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_challans
    ADD CONSTRAINT support_part_challans_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(user_id);


--
-- Name: support_part_challans support_part_challans_issued_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_challans
    ADD CONSTRAINT support_part_challans_issued_to_fkey FOREIGN KEY (issued_to) REFERENCES public.users(user_id);


--
-- Name: support_part_challans support_part_challans_support_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_challans
    ADD CONSTRAINT support_part_challans_support_ticket_id_fkey FOREIGN KEY (support_ticket_id) REFERENCES public.support_tickets(id);


--
-- Name: support_part_requests support_part_requests_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: support_part_requests support_part_requests_assigned_to_tech_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_assigned_to_tech_fkey FOREIGN KEY (assigned_to_tech) REFERENCES public.users(user_id);


--
-- Name: support_part_requests support_part_requests_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.part_instances(instance_id);


--
-- Name: support_part_requests support_part_requests_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(part_id);


--
-- Name: support_part_requests support_part_requests_reassign_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_reassign_requested_by_fkey FOREIGN KEY (reassign_requested_by) REFERENCES public.users(user_id);


--
-- Name: support_part_requests support_part_requests_reassign_to_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_reassign_to_item_id_fkey FOREIGN KEY (reassign_to_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_part_requests support_part_requests_reassign_to_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_reassign_to_ticket_id_fkey FOREIGN KEY (reassign_to_ticket_id) REFERENCES public.support_tickets(id);


--
-- Name: support_part_requests support_part_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(user_id);


--
-- Name: support_part_requests support_part_requests_returned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_returned_to_fkey FOREIGN KEY (returned_to) REFERENCES public.users(user_id);


--
-- Name: support_part_requests support_part_requests_support_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_support_item_id_fkey FOREIGN KEY (support_item_id) REFERENCES public.support_ticket_items(id);


--
-- Name: support_part_requests support_part_requests_support_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_part_requests
    ADD CONSTRAINT support_part_requests_support_ticket_id_fkey FOREIGN KEY (support_ticket_id) REFERENCES public.support_tickets(id);


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
-- Name: support_replacement_orders support_replacement_orders_pickup_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_replacement_orders
    ADD CONSTRAINT support_replacement_orders_pickup_assigned_to_fkey FOREIGN KEY (pickup_assigned_to) REFERENCES public.users(user_id);


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
-- Name: support_ticket_items support_ticket_items_floor_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_floor_ticket_id_fkey FOREIGN KEY (floor_ticket_id) REFERENCES public.tickets(ticket_id);


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
-- Name: support_ticket_items support_ticket_items_ttspl_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_ttspl_verified_by_fkey FOREIGN KEY (ttspl_verified_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_warehouse_esign_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_warehouse_esign_by_fkey FOREIGN KEY (warehouse_esign_by) REFERENCES public.users(user_id);


--
-- Name: support_ticket_items support_ticket_items_warehouse_received_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_ticket_items
    ADD CONSTRAINT support_ticket_items_warehouse_received_by_fkey FOREIGN KEY (warehouse_received_by) REFERENCES public.users(user_id);


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
-- Name: support_tickets support_tickets_portal_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_portal_customer_id_fkey FOREIGN KEY (portal_customer_id) REFERENCES public.customers(customer_id);


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
-- Name: ticket_part_blocks ticket_part_blocks_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_part_blocks
    ADD CONSTRAINT ticket_part_blocks_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.part_requests(request_id);


--
-- Name: ticket_part_blocks ticket_part_blocks_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_part_blocks
    ADD CONSTRAINT ticket_part_blocks_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


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
-- Name: tickets tickets_vendor_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_vendor_serial_id_fkey FOREIGN KEY (vendor_serial_id) REFERENCES public.vendor_serial_numbers(serial_id) ON DELETE SET NULL;


--
-- Name: ttspl_audit_log ttspl_audit_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_audit_log
    ADD CONSTRAINT ttspl_audit_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(user_id);


--
-- Name: ttspl_audit_log ttspl_audit_log_vendor_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_audit_log
    ADD CONSTRAINT ttspl_audit_log_vendor_serial_id_fkey FOREIGN KEY (vendor_serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


--
-- Name: ttspl_config_history ttspl_config_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(user_id);


--
-- Name: ttspl_config_history ttspl_config_history_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(ticket_id);


--
-- Name: ttspl_config_history ttspl_config_history_vendor_serial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ttspl_config_history
    ADD CONSTRAINT ttspl_config_history_vendor_serial_id_fkey FOREIGN KEY (vendor_serial_id) REFERENCES public.vendor_serial_numbers(serial_id);


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
-- Name: users users_deactivated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES public.users(user_id);


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
-- Name: vendor_debit_notes vendor_debit_notes_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: vendor_debit_notes vendor_debit_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(user_id);


--
-- Name: vendor_debit_notes vendor_debit_notes_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.vendor_purchase_orders(po_id);


--
-- Name: vendor_debit_notes vendor_debit_notes_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_debit_notes
    ADD CONSTRAINT vendor_debit_notes_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


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
-- Name: vendor_monthly_bills vendor_monthly_bills_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(user_id);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES public.users(user_id);


--
-- Name: vendor_monthly_bills vendor_monthly_bills_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id);


--
-- Name: vendor_portal_sessions vendor_portal_sessions_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_portal_sessions
    ADD CONSTRAINT vendor_portal_sessions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(vendor_id) ON DELETE CASCADE;


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
-- Name: vendor_serial_numbers vendor_serial_numbers_current_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_serial_numbers
    ADD CONSTRAINT vendor_serial_numbers_current_customer_id_fkey FOREIGN KEY (current_customer_id) REFERENCES public.customers(customer_id);


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
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


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
-- PostgreSQL database dump complete
--

\unrestrict bQQsHhG2wAeOlCcKo56hlAOnPVzQKZX58FZcRUGsYeDY6bCccBF5ygpeV1xOTC8

