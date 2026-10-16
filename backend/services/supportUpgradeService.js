/**
 * Customer upgrades on a support ticket (migration 434, 16 Oct 2026).
 *
 *   laptop — a better laptop: a replacement order at the new rent and config;
 *            the old laptop comes back on the replacement's return pickup.
 *   parts  — RAM and/or SSD sent and fitted at the customer, nothing comes back.
 *            Support records the new configuration and rent; "Apply" (once the
 *            part is fitted) updates the laptop's configuration and rent.
 *
 * The new rent applies from the next billing period — no proration (user
 * decision): prepaid from the day after what is already billed, postpaid from
 * the first of next month.
 */
const replacementFlow = require('./supportReplacementFlowService');
const { logConfigChange } = require('./ttsplAuditService');
const productionAssetService = require('./productionAssetService');

const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const ymd = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const CONFIG_KEYS = ['brand', 'model', 'processor', 'generation', 'ram', 'storage'];

/** When a rent change made today starts to bill. */
async function nextBillingStart(db, serialId, customerId) {
  const cust = (await db.query(`SELECT COALESCE(billing_type, 'prepaid') AS t FROM customers WHERE customer_id = $1`, [customerId])).rows[0];
  const today = new Date();
  if (String(cust?.t || 'prepaid').toLowerCase() === 'postpaid') {
    const ist = new Date(today.getTime() + 330 * 60000);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  }
  const v = serialId ? (await db.query('SELECT rent_billed_until FROM vendor_serial_numbers WHERE serial_id = $1', [serialId])).rows[0] : null;
  if (v?.rent_billed_until) {
    const next = new Date(new Date(v.rent_billed_until).getTime() + 86400000);
    if (ymd(next) > ymd(today)) return ymd(next);
  }
  return ymd(today);
}

/** The laptop's configuration and rent today, for the upgrade drawer. */
async function upgradeContext(db, itemId) {
  const item = (await db.query('SELECT i.*, t.customer_id FROM support_ticket_items i JOIN support_tickets t ON t.id = i.ticket_id WHERE i.id = $1', [itemId])).rows[0];
  if (!item) throw httpError('Item not found', 404);
  if (item.item_type !== 'complaint') throw httpError('Upgrades start from a laptop on the ticket');
  const cfg = await replacementFlow.resolveConfigFromComplaint(db, item, item.customer_id);
  const isSale = Boolean(cfg.sale_line);
  return {
    item_id: item.id,
    ttspl_id: item.ttspl_id || item.unique_serial_number || null,
    serial_id: cfg.old_serial_id,
    customer_id: item.customer_id,
    config: Object.fromEntries(CONFIG_KEYS.map((k) => [k, cfg[k] || ''])),
    monthly_rate: cfg.monthly_rate != null ? Number(cfg.monthly_rate) : null,
    is_sale: isSale,
    effective_from: cfg.old_serial_id ? await nextBillingStart(db, cfg.old_serial_id, item.customer_id) : null,
  };
}

async function listForTicket(db, ticketId) {
  return (await db.query(
    `SELECT u.*, cu.name AS created_by_name, au.name AS applied_by_name
       FROM support_upgrades u
       LEFT JOIN users cu ON cu.user_id = u.created_by
       LEFT JOIN users au ON au.user_id = u.applied_by
      WHERE u.ticket_id = $1 ORDER BY u.upgrade_id`,
    [ticketId]
  )).rows;
}

/** RAM / SSD upgrade: record what changes and the new rent (pending until the part is fitted). */
async function createPartsUpgrade(db, { itemId, ram, storage, newRate, notes, user }) {
  const ctx = await upgradeContext(db, itemId);
  if (ctx.is_sale) throw httpError('This laptop was sold — there is no rent to change. Raise the part as a chargeable part instead.');
  if (!ctx.serial_id) throw httpError('This laptop is not on record with the customer');
  const newConfig = {};
  if (String(ram || '').trim()) newConfig.ram = String(ram).trim();
  if (String(storage || '').trim()) newConfig.storage = String(storage).trim();
  if (!Object.keys(newConfig).length) throw httpError('Enter the new RAM and/or SSD');
  const rate = Number(newRate);
  if (!(rate > 0)) throw httpError('Enter the new monthly rent');
  const open = (await db.query(`SELECT 1 FROM support_upgrades WHERE item_id = $1 AND status = 'pending'`, [itemId])).rows[0];
  if (open) throw httpError('An upgrade is already waiting on this laptop', 409);
  const item = (await db.query('SELECT ticket_id FROM support_ticket_items WHERE id = $1', [itemId])).rows[0];
  const r = await db.query(
    `INSERT INTO support_upgrades (ticket_id, item_id, serial_id, customer_id, kind, old_config, new_config, old_rate, new_rate, notes, created_by)
     VALUES ($1, $2, $3, $4, 'parts', $5::jsonb, $6::jsonb, $7, $8, $9, $10) RETURNING *`,
    [item.ticket_id, itemId, ctx.serial_id, ctx.customer_id, JSON.stringify(ctx.config), JSON.stringify(newConfig),
      ctx.monthly_rate, rate, String(notes || '').trim() || null, user?.user_id || null]
  );
  return r.rows[0];
}

/** Record the dated rent change and move the laptop's live rent to it. */
async function changeRent(db, { serialId, customerId, oldRate, newRate, reason, upgradeId, user }) {
  const from = await nextBillingStart(db, serialId, customerId);
  await db.query(
    `INSERT INTO rent_rate_changes (serial_id, customer_id, old_rate, new_rate, effective_from, reason, source, upgrade_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'support_upgrade', $7, $8)`,
    [serialId, customerId, oldRate, newRate, from, reason, upgradeId, user?.user_id || null]
  );
  await db.query('UPDATE vendor_serial_numbers SET rent_monthly_rate = $2, updated_at = NOW() WHERE serial_id = $1', [serialId, newRate]);
  const v = (await db.query(`SELECT COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl, serial_number FROM vendor_serial_numbers WHERE serial_id = $1`, [serialId])).rows[0];
  // customer_asset_activity: billing treats a logged rent_monthly_rate change as deliberate.
  await db.query(
    `INSERT INTO customer_asset_activity (customer_id, vendor_serial_id, ttspl_id, serial_number, action, description, changes, actor_user_id)
     VALUES ($1, $2, $3, $4, 'rent_changed', $5, $6::jsonb, $7)`,
    [customerId, serialId, v?.ttspl || null, v?.serial_number || null, `Rent ${oldRate ?? '—'} → ${newRate} from ${from} (${reason})`,
      JSON.stringify([{ field: 'rent_monthly_rate', from: oldRate, to: newRate, effective_from: from }]), user?.user_id || null]
  );
  return from;
}

/** The part is fitted: update the laptop's configuration and rent. */
async function applyPartsUpgrade(db, { upgradeId, user }) {
  const u = (await db.query('SELECT * FROM support_upgrades WHERE upgrade_id = $1 FOR UPDATE', [upgradeId])).rows[0];
  if (!u) throw httpError('Upgrade not found', 404);
  if (u.kind !== 'parts') throw httpError('A laptop upgrade completes with its replacement order');
  if (u.status !== 'pending') throw httpError(`This upgrade is ${u.status}`, 409);
  const v = (await db.query(`SELECT serial_id, serial_number, COALESCE(inventory_asset_code, extra->>'ttspl_id') AS ttspl FROM vendor_serial_numbers WHERE serial_id = $1`, [u.serial_id])).rows[0];
  if (!v) throw httpError('The laptop is not on record');
  const pa = await productionAssetService.getByVendorSerial(db, v.serial_id);
  for (const [field, value] of Object.entries(u.new_config || {})) {
    const prev = (u.old_config || {})[field] || '';
    await logConfigChange({
      ttsplId: v.ttspl, vendorSerialId: v.serial_id, ticketId: null, changedBy: user?.user_id || null,
      changeType: 'upgrade', fieldName: field, oldValue: prev, newValue: value,
      notes: `Customer upgrade on support ticket #${u.ticket_id} (${prev || '—'} → ${value})`, db,
    });
    if (pa?.production_asset_id) {
      await productionAssetService.updateConfig(db, pa.production_asset_id, { [field]: value }, user?.user_id || null, 'Customer upgrade');
    } else {
      await db.query(
        `UPDATE vendor_serial_numbers SET extra = jsonb_set(COALESCE(extra, '{}'::jsonb), $1, $2::jsonb), updated_at = NOW() WHERE serial_id = $3`,
        [`{${field}}`, JSON.stringify(value), v.serial_id]
      );
    }
    if (v.serial_number) {
      await db.query(`UPDATE inventory SET ${field === 'ram' ? 'ram' : 'storage'} = $1, updated_at = NOW() WHERE LOWER(serial_number) = LOWER($2)`, [value, v.serial_number]);
    }
  }
  await require('./laptopConfigService').recordConfirmation(db, {
    serialId: v.serial_id, ttsplId: v.ttspl || null, source: 'part_fit', config: u.new_config, userId: user?.user_id || null,
    notes: `Customer upgrade fitted (support ticket #${u.ticket_id})`,
  });
  const from = await changeRent(db, {
    serialId: v.serial_id, customerId: u.customer_id, oldRate: u.old_rate, newRate: Number(u.new_rate),
    reason: `Upgrade on support ticket #${u.ticket_id}`, upgradeId: u.upgrade_id, user,
  });
  await db.query(
    `UPDATE support_upgrades SET status = 'applied', applied_by = $2, applied_at = NOW(), effective_from = $3 WHERE upgrade_id = $1`,
    [upgradeId, user?.user_id || null, from]
  );
  // The ticket's laptop shows its new configuration.
  const set = Object.entries(u.new_config || {}).filter(([k]) => ['ram', 'storage'].includes(k));
  if (set.length) {
    await db.query(
      `UPDATE support_ticket_items SET ${set.map(([k], i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
      [u.item_id, ...set.map(([, val]) => val)]
    );
  }
  return { effective_from: from };
}

async function cancelUpgrade(db, { upgradeId, reason }) {
  const u = (await db.query('SELECT * FROM support_upgrades WHERE upgrade_id = $1 FOR UPDATE', [upgradeId])).rows[0];
  if (!u) throw httpError('Upgrade not found', 404);
  if (u.status !== 'pending') throw httpError(`This upgrade is ${u.status}`, 409);
  await db.query(`UPDATE support_upgrades SET status = 'cancelled', cancelled_reason = $2 WHERE upgrade_id = $1`, [upgradeId, reason || null]);
}

/** Laptop upgrade: the replacement's config and rent override the old laptop's. */
function applyLaptopOverride(cfg, upgrade) {
  if (!upgrade) return cfg;
  const out = { ...cfg };
  for (const k of CONFIG_KEYS) if (String(upgrade[k] || '').trim()) out[k] = String(upgrade[k]).trim();
  if (Number(upgrade.monthly_rate) > 0) out.monthly_rate = Number(upgrade.monthly_rate);
  return out;
}

module.exports = {
  CONFIG_KEYS, nextBillingStart, upgradeContext, listForTicket, createPartsUpgrade, applyPartsUpgrade, cancelUpgrade, applyLaptopOverride,
};
