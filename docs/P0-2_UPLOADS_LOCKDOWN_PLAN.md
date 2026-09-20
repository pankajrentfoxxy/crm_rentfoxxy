# P0-2 — Locking down `/uploads`

**Status:** planned, not implemented. Deliberately deferred from the P0 batch because
it is the only P0 that can break working features, and it needs its own test pass.

## The problem

`backend/server.js:77-79` mounts `express.static` on `/uploads` twice with no auth
middleware:

```js
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
```

Measured on the production box:

| | |
|---|---|
| Files reachable anonymously | **14,267** |
| Total size | **1.3 GB** (`backend/uploads`) + 508 KB (repo-root `uploads`) |
| Folders | 24 under `backend/uploads`, plus `delivery-man` and `pod_files` at repo root |

Contents include customer KYC (GST certificates, PAN, signed agreements), delivery proofs
and customer e-signatures, customer invoices, e-way bills and e-invoices, vendor bills,
and delivery-staff identity documents.

Filenames are predictable — `${Date.now()}_${originalName}`, `pod_${dcNumber}_${Date.now()}.jpg`,
`esign_${dcNumber}_${Date.now()}.ext` — and document numbers are sequential, so the
namespace is enumerable. Any link ever pasted into an email or WhatsApp is permanently
public.

Exactly one folder is already protected, which establishes both the precedent and the
pattern to follow (`server.js:71-76`):

```js
app.use('/uploads/vendor-repair', (_req, res) => {
  res.status(403).json({ success: false, message: 'Download this VRDC from the CRM using the Dispatch PDF button.' });
});
```

## Why this was not done in the same batch as the other P0s

Deleting the static mounts is one line. Making that safe is not:

- **35 files** across the backend, the CRM frontend and both portals build or consume
  `/uploads/...` URLs — **39 call sites**.
- Links are also embedded in **generated PDFs** and in **emails already sent**. Those
  cannot be rewritten. Any already-delivered link will 404 the moment the mount is removed.
- Four different actor types with four different auth mechanisms (internal JWT, customer
  portal opaque session, vendor portal JWT + session row, technician JWT) need to reach
  different subsets of these files. A single `authMiddleware` in front of `/uploads` would
  lock the portals out.
- Six unauthenticated public capture flows (`routes/*Public.js`) upload into these folders
  and may read back what they just wrote.

A blunt fix therefore trades a confidentiality bug for a visible outage.

## Proposed approach

### Phase 1 — stop the bleeding on the worst folders (small, shippable alone)

Extend the `vendor-repair` 403 pattern to the folders whose contents are personal or
statutory, and which have the fewest link consumers:

- `customer-documents` (KYC: GST certificate, PAN, agreements) — 1 file
- `pod` (delivery proofs + customer e-signatures) — 584 files
- `customer-invoices` — 626 files

Before flipping each one, grep for its consumers and route them through the authenticated
download endpoint first. Ship folder by folder, not all at once.

### Phase 2 — one authenticated download route

Add `GET /api/files/:folder/:filename` that:

1. resolves the caller through whichever of the four auth mechanisms applies;
2. maps `:folder` to an ownership rule (a customer may read a POD only for their own DC; a
   vendor only their own bills; internal users via the existing section permission matrix);
3. rejects any `:filename` containing a path separator or `..`, and resolves the final path
   with `path.resolve` asserting it stays inside the folder root;
4. streams with `res.sendFile`.

Ownership rules are the real work here — they are per-folder and there are 26 folders.
Write them as an explicit table, not as a default-allow.

### Phase 3 — signed expiring URLs for links that must be shareable

For anything that legitimately goes into an email or a WhatsApp message (customer invoice
PDFs, e-way bills), issue an HMAC-signed URL with a short expiry rather than a permanent
public path. Keep the signing key in `.env` alongside `JWT_SECRET`.

### Phase 4 — remove the static mounts

Only once Phases 2 and 3 cover every one of the 39 call sites. Keep a temporary
access log on the static mount beforehand to catch consumers the grep missed — some
links live in PDFs and inboxes that no grep can reach.

## Verification checklist

- [ ] Anonymous `curl` of one file per folder returns 401/403, not 200
- [ ] A logged-in internal user can still open every document they could before
- [ ] Customer portal can open its own invoices and PODs, and **not** another customer's
- [ ] Vendor portal can open its own bills, and **not** another vendor's
- [ ] Technician flows and the six public capture flows still work
- [ ] Generated PDFs contain signed URLs, not raw `/uploads` paths
- [ ] Path traversal (`../`, encoded separators) is rejected

## Estimate

Phase 1 is roughly half a day. Phases 2–4 are several days, dominated by writing and
testing the per-folder ownership rules — not by the routing code.
