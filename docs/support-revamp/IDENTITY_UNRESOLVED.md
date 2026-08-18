# Unresolved delivery identity

Not generated against production from this machine. After Docker applies migration `210_support_v2_identity.sql`, run:

```bash
cd backend
node scripts/report-identity-unresolved.js
```

That overwrites this file with every `delivery_challan_lines` row whose `delivery_person_id` matched neither `users.user_id` nor a `delivery_technicians.technician_id` that already has `user_id`.

`delivery_person_id` stays until Phase 11. New support-v2 code reads `assigned_user_id` only.
