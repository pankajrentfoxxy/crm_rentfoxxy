# P0-2 — Locking down `/uploads`

**Status:** Phases 1 and 2 implemented. Controlled at runtime by `UPLOADS_AUTH_MODE`.

## The problem

Both `/uploads` mounts in `server.js` were plain `express.static` with no auth:

| | |
|---|---|
| Files reachable anonymously | **14,433** |
| Total size | **1.3 GB** |
| Largest folders | `pod` 644M (delivery proofs + customer e-signatures), `sales-documents` 185M, `support` 142M, `customer-invoices` 83M |
| Also exposed | `customer-documents` (KYC: GST certificate, PAN, agreements), `sale-dc-compliance` (e-way bills, e-invoices), `delivery-man` (staff identity documents) |

Filenames are predictable — `${Date.now()}_${originalName}`, `pod_${dcNumber}_${Date.now()}.jpg`,
`esign_${dcNumber}_${Date.now()}.ext` — and document numbers are sequential, so the
namespace is enumerable.

## What an earlier version of this plan got wrong

The first draft called this a multi-day project and claimed a fix would break links
already sitting in sent emails and generated PDFs. **Both claims were wrong**, and they
were the reason the work was deferred. Checked against the running system:

| Assumption | Reality |
|---|---|
| nginx serves the files from disk | **No.** `location /uploads/` proxies to `127.0.0.1:5001`, so Express controls access. |
| Customer and vendor portals serve `/uploads` | **No such block** on either domain. |
| The portals link to `/uploads` | **Zero references** in `customer-portal/src` and `vendor-portal/src`. They already use authenticated API routes. |
| Emails link to uploaded PDFs | **No.** `emailDocument` attaches the file (`attachments: [{ path }]`). Nothing to break. |
| Public capture flows read uploads | **No references.** |
| Four actor types need different subsets | Only the internal CRM consumes `/uploads` — 17 frontend files. |

## The one real constraint

The CRM builds absolute URLs and uses them as `<img src>` / `<a href>`:

```js
return `${origin}/uploads/${path.replace(/^\//, '')}`;
```

Browser-initiated requests never carry an `Authorization` header — the bearer token lives
in `sessionStorage` and is attached by axios only. Requiring the header would break every
image and document link in the CRM. That single fact dictates the design.

## The implementation

`middleware/uploadsAuth.js`, mounted ahead of both static mounts. It accepts three
credentials, in order:

1. **`uploads_tk` cookie** — HttpOnly, Secure, SameSite=Lax, `Path=/uploads`, HMAC-signed
   with `JWT_SECRET`. The browser sends it automatically, so no frontend change was
   needed. Issued and refreshed by `authMiddleware` on **every authenticated API call**,
   not only at login, so users already signed in never had to sign in again.
2. **`Authorization: Bearer`** — programmatic callers.
3. **`?exp=…&sig=…` signed URL** — for handing a single file to someone outside the CRM.
   No current flow needs it, but it is the supported way to add one without reopening the
   tree. Use `signedUploadUrl(relativePath, ttlSeconds, origin)`.

Cookie TTL is **2 hours**. The cookie is verified by HMAC alone — checking
`users.token_version` per request would mean a DB round trip per image, and one page can
load dozens — so the TTL is what bounds how long a revoked user keeps file access. It
refreshes on every API call, so active users never notice.

### `UPLOADS_AUTH_MODE`

| Value | Behaviour |
|---|---|
| `off` | No checking. Pre-P0-2 behaviour. |
| `grace` | Anonymous requests are **logged but still served** (`[uploadsAuth][grace]`). The observation window. |
| `enforce` | Anonymous requests get **403**. |

The mode is read per request, so switching needs only a `pm2 restart` — no deploy, and
reverting is immediate if anything unexpected surfaces.

## Verified

On a throwaway instance on port 5099, production untouched:

```
grace    anonymous                 200 + warning logged
enforce  anonymous                 403
enforce  cookie only (browser)     200
enforce  bearer token              200
enforce  valid signed URL          200
enforce  tampered signature        403
enforce  expired signature         403
enforce  /uploads/vendor-repair    403   (pre-existing VRDC guard intact)
         ../.env and 3 traversal variants   404
         directory listing                  404
```

## Still open — Phase 3 (optional)

Any signed-in CRM user can fetch any file. That is "any employee" rather than "anyone on
the internet", which was the urgent part, but it is not least-privilege. Per-folder
ownership rules are worth adding for `customer-documents` (KYC) and `pod` (customer
e-signatures). Write them as an explicit allow table, not a default-allow.
