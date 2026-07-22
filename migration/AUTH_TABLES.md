# CRM Authentication & Authorization Tables

> **Policy:** These tables are **protected**. Migration scripts must **NOT** truncate, bulk-delete, or overwrite them.  
> ERP OAuth/Sanctum data is **never** imported into CRM auth.

---

## 1. Protection Rules

| Rule | Description |
| --- | --- |
| **No truncate** | Never `TRUNCATE` any table in this document |
| **No RBAC reset** | Never replace `roles`, `role_permissions`, or `permission_sections` from ERP |
| **No permission overwrite** | Never `UPDATE` `user_permissions` or `role_permissions` from ERP |
| **Additive users only** | ERP admins may be **inserted** into `public.users` only if email is not already present |
| **Map, don’t replace** | If ERP admin email matches CRM user → record mapping in `erp_id_map`; do not change CRM password/role |
| **auth.* untouched** | Entire `auth` schema is out of scope (Supabase/GoTrue) |

---

## 2. `auth` Schema (21 tables) — DO NOT MIGRATE

These tables belong to the CRM platform auth layer (Supabase-compatible). **No read, write, truncate, or delete** during ERP migration.

| Table | Purpose | Migration Action |
| --- | --- | --- |
| `auth.users` | Platform auth identities | **SKIP** |
| `auth.identities` | Linked identity providers | **SKIP** |
| `auth.sessions` | Active login sessions | **SKIP** |
| `auth.refresh_tokens` | JWT refresh tokens | **SKIP** |
| `auth.audit_log_entries` | Auth audit trail | **SKIP** |
| `auth.flow_state` | PKCE / OAuth flow state | **SKIP** |
| `auth.mfa_factors` | MFA enrollment | **SKIP** |
| `auth.mfa_challenges` | MFA challenge state | **SKIP** |
| `auth.mfa_amr_claims` | MFA authentication method refs | **SKIP** |
| `auth.oauth_clients` | OAuth client registry | **SKIP** |
| `auth.oauth_authorizations` | OAuth authorization codes | **SKIP** |
| `auth.oauth_consents` | OAuth user consents | **SKIP** |
| `auth.oauth_client_states` | OAuth CSRF state | **SKIP** |
| `auth.one_time_tokens` | OTP / magic-link tokens | **SKIP** |
| `auth.custom_oauth_providers` | Custom SSO providers | **SKIP** |
| `auth.saml_providers` | SAML IdP config | **SKIP** |
| `auth.saml_relay_states` | SAML relay state | **SKIP** |
| `auth.sso_providers` | SSO provider registry | **SKIP** |
| `auth.sso_domains` | SSO domain allowlist | **SKIP** |
| `auth.instances` | Auth instance metadata | **SKIP** |
| `auth.schema_migrations` | Auth internal migrations | **SKIP** |

**Source in dump:** `crm_backup.sql` — `auth` schema section  
**ERP equivalents (ignored):** `oauth_*`, `personal_access_tokens`, `password_resets`, `sessions`

---

## 3. CRM RBAC Tables (`public`) — PRESERVE AS-IS

These define the CRM’s production role and permission model (migrations `029_rbac_system.sql`, `040_rbac_roles_module.sql`, `072_phase10_user_role_management.sql`).

| Table | Columns (key) | Migration Action |
| --- | --- | --- |
| `public.users` | `user_id`, `email`, `password_hash`, `role`, `team_id`, `permissions[]`, `status`, `user_type` | **PRESERVE** existing rows; **additive INSERT** for unmatched ERP admins only |
| `public.roles` | `id`, `name`, `display_name`, `is_system_role` | **PRESERVE** — do not import ERP `admin_roles` / `roles` |
| `public.role_permissions` | `role`, `section`, `can_view`, `can_create`, … | **PRESERVE** — CRM permission matrix is authoritative |
| `public.user_permissions` | `user_id`, per-section overrides | **PRESERVE** — never overwrite from ERP `new_user_permissions` |
| `public.teams` | `team_id`, `name`, `type` | **PRESERVE** — do not import ERP `team_members` as team definitions |
| `public.user_teams` | `user_id`, `team_id` | **PRESERVE** — existing team assignments stay |
| `public.permission_sections` | `section`, `sort_order` | **PRESERVE** — do not import ERP `new_modules` / `sub_modules` |
| `public.permission_audit_logs` | RBAC change audit | **PRESERVE** — append-only; do not import ERP audit |

### `public.users` — ERP Admin Mapping (additive)

When ERP `admins` must be linked:

```
FOR EACH erp_admin:
  IF EXISTS crm.users WHERE LOWER(email) = LOWER(erp_admin.email):
    erp_id_map('users', erp_admin.id) → existing user_id
    -- DO NOT UPDATE password_hash, role, permissions, team_id, status
  ELSE:
    INSERT users (name, email, password_hash, role, ...)
    -- role: map ERP admin_role_id → nearest CRM role enum (default: team_member)
    -- DO NOT auto-grant permissions; admin must assign via CRM UI
    erp_id_map('users', erp_admin.id) → new user_id
```

**Never:**
- `TRUNCATE users`
- `DELETE FROM users`
- `UPDATE users SET role = …` for existing CRM users
- Import ERP `roles_modules` into `role_permissions`

---

## 4. Portal & Session Tables — PRESERVE

| Table | Purpose | Migration Action |
| --- | --- | --- |
| `public.customer_portal_sessions` | Customer portal login sessions | **PRESERVE** |
| `public.vendor_portal_sessions` | Vendor portal sessions | **PRESERVE** |
| `public.vendor_refresh_tokens` | Vendor JWT refresh tokens | **PRESERVE** |

---

## 5. FK Remapping for Business Data

Business tables migrated from ERP often reference `user_id` (created_by, assigned_to, etc.).

**Rule:** Resolve via `erp_id_map` entity=`users`:

```sql
SELECT crm_id FROM erp_id_map
 WHERE entity = 'users' AND erp_id = :erp_admin_id
```

If no mapping exists:
1. Try match CRM user by email from ERP `admins`
2. If still missing → `NULL` or designated system user (manual decision); **never** auto-create with admin role

---

## 6. ERP Tables Related to Auth (source only — not imported into RBAC)

| ERP Table | CRM Target | Action |
| --- | --- | --- |
| `admins` | `public.users` | Additive user insert + `erp_id_map` only |
| `admin_roles` | — | **SKIP** — CRM `roles` preserved |
| `roles` | — | **SKIP** |
| `roles_modules` | — | **SKIP** |
| `role_permissions` | — | **SKIP** |
| `new_modules` | — | **SKIP** |
| `new_user_permissions` | — | **SKIP** |
| `team_members` | — | **SKIP** (preserve `user_teams`) |
| `users` (ERP front-end) | — | **SKIP** unless explicitly mapped to customers |

---

## 7. Verification Queries (post-migration)

```sql
-- CRM user count must not decrease
SELECT COUNT(*) FROM users;

-- RBAC tables row counts unchanged from baseline
SELECT 'roles', COUNT(*) FROM roles
UNION ALL SELECT 'role_permissions', COUNT(*) FROM role_permissions
UNION ALL SELECT 'user_permissions', COUNT(*) FROM user_permissions
UNION ALL SELECT 'teams', COUNT(*) FROM teams
UNION ALL SELECT 'user_teams', COUNT(*) FROM user_teams;

-- No ERP overwrite of existing user passwords (spot check)
-- Compare baseline hash for known CRM admin emails
```

---

## 8. Reference

- Canonical list: `migration/lib/preserve.js` → `AUTH_PROTECTED`
- Validation: `migration/validate-migration.js --baseline` (capture RBAC counts before migration)
