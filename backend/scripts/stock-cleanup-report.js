#!/usr/bin/env node
/**
 * ST-D4 — Stock data clean-up, step 1: the REPORT (read-only).
 *
 * Writes one CSV per problem, each row with the evidence, a proposed fix in
 * plain words, a machine-readable fix_code and a confidence. Nothing is
 * changed: every query runs inside a READ ONLY transaction.
 *
 *   node scripts/stock-cleanup-report.js [--out <dir>] [--tag QA-2026-09-27]
 *
 * Step 2 (after review) is scripts/apply-stock-cleanup.js, which reads these
 * CSVs back. Run this again against live at promotion (--tag LIVE-<date>).
 *
 * Laptops = vendor_serial_numbers with deleted_at IS NULL AND po_id IS NOT NULL
 * AND spo_id IS NULL (spo_id rows are parts).
 *
 *   1 rented-no-customer       rented laptops with current_customer_id NULL
 *   2 in-stock-not-qc-passed   in_stock laptops whose qc_status is not passed
 *   3 not-deployed-with-customer  in_stock / returned / in_repair / scrapped /
 *                              qc_failed still pointing at a customer or DC
 *   4 scrapped-no-history      scrapped with no transition to 'scrapped', and
 *                              scrapped laptops with open floor tickets
 *   5 ready-no-tag-or-slot     QC-passed available laptops with no tag / slot
 *   6 vendor-kept-not-scrap    scrapped by the old "vendor replacement —
 *                              original unit scrapped" logic
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(__dirname, '..', '..', 'claude', 'reports')));
const TAG = arg('--tag', `QA-${new Date().toISOString().slice(0, 10)}`);

const LAPTOP = `v.deleted_at IS NULL AND v.po_id IS NOT NULL AND v.spo_id IS NULL`;
const TT = `upper(COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id'))`;

// Every serial listed on every challan line, as (dc line, TTSPL, serial).
// dcl.serial_number is a JSON array of "serial_id|serial|TTSPL" strings
// (a few old ones read "id|serial|1283/TTSPL1814"); part-return challans list
// part objects, so they are left out.
const DC_SERIALS = `
  SELECT d.id, d.dc_number, d.customer_id, d.customer_name, d.entity_code, d.movement_type AS mt, d.status,
         d.original_dc_number, d.sales_order_number,
         COALESCE(d.delivered_at, d.delivery_completed_at, d.date_and_time, d.created_at) AS dt,
         upper(substring(e FROM 'TTSPL\\d+')) AS tt, upper(split_part(e, '|', 2)) AS sn,
         COALESCE(d.rejected_serial_numbers::text ILIKE '%' || e || '%', false) AS rej
    FROM delivery_challan_lines d, jsonb_array_elements_text(d.serial_number) e
   WHERE jsonb_typeof(d.serial_number) = 'array' AND COALESCE(d.dc_purpose, '') <> 'part_return'`;

const d10 = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '');
const csvCell = (v) => {
  const s = v == null ? '' : (v instanceof Date ? v.toISOString() : String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function writeCsv(n, slug, head, rows) {
  const file = path.join(OUT, `stock-cleanup-${n}-${slug}-${TAG}.csv`);
  const out = [head.join(',')];
  for (const r of rows) out.push(head.map((h) => csvCell(r[h])).join(','));
  fs.writeFileSync(file, `${out.join('\n')}\n`);
  const by = {};
  for (const r of rows) {
    const k = `${r.fix_code} [${r.confidence}]`;
    by[k] = (by[k] || 0) + 1;
  }
  console.log(`${path.basename(file)}: ${rows.length} rows`);
  for (const [k, v] of Object.entries(by).sort()) console.log(`   ${k}: ${v}`);
  return file;
}

const COMMON_HEAD = ['serial_id', 'ttspl_id', 'serial_number'];
const TAIL_HEAD = ['evidence', 'proposed_fix', 'fix_code', 'confidence'];

// ── 1. Rented, no customer ─────────────────────────────────────────────────
async function problem1(db) {
  const { rows } = await db.query(`
    WITH v AS (
      SELECT v.serial_id, v.serial_number, ${TT} AS tt, upper(v.serial_number) AS sn, v.inventory_status, v.qc_status,
             v.current_customer_id, v.current_dc_number, v.current_entity, v.rent_start_date, v.rent_monthly_rate,
             v.extra->>'status' AS erp_status, v.extra->>'action_status' AS erp_action
        FROM vendor_serial_numbers v
       WHERE ${LAPTOP} AND v.inventory_status = 'rented' AND v.current_customer_id IS NULL),
    m AS (SELECT DISTINCT ON (v.serial_id, d.id) v.serial_id, d.* FROM v JOIN (${DC_SERIALS}) d
            ON (d.tt = v.tt OR (v.sn <> '' AND d.sn = v.sn))),
    lo AS (SELECT DISTINCT ON (serial_id) * FROM m WHERE mt = 'outbound' AND status = 'delivered' AND NOT rej ORDER BY serial_id, dt DESC, id DESC),
    lr AS (SELECT DISTINCT ON (serial_id) * FROM m WHERE mt = 'return' AND status = 'delivered' ORDER BY serial_id, dt DESC, id DESC),
    op AS (SELECT DISTINCT ON (serial_id) * FROM m WHERE status NOT IN ('delivered', 'cancelled', 'rejected') ORDER BY serial_id, dt DESC, id DESC),
    sos AS (SELECT DISTINCT ON (v.serial_id) v.serial_id, s.sales_order_number, s.status, l.customer_id, l.quotation_type
              FROM v JOIN sales_order_serials s ON s.serial_id = v.serial_id LEFT JOIN sales_order_lines l ON l.id = s.line_id
             WHERE s.status <> 'removed' ORDER BY v.serial_id, s.created_at DESC, s.allocation_id DESC),
    sup AS (SELECT DISTINCT ON (v.serial_id) v.serial_id, st.id, st.customer_id, st.status, st.top_level_remarks, i.pickup_type
              FROM v JOIN support_ticket_items i
                ON (upper(i.ttspl_id) = v.tt OR upper(i.unique_serial_number) = v.tt OR (v.sn <> '' AND upper(i.serial_number) = v.sn))
              JOIN support_tickets st ON st.id = i.ticket_id
             ORDER BY v.serial_id, st.created_at DESC),
    tr AS (SELECT DISTINCT ON (t.serial_id) t.serial_id, t.customer_id, t.to_status, t.created_at
             FROM inventory_status_transitions t JOIN v USING (serial_id)
            WHERE t.customer_id IS NOT NULL ORDER BY t.serial_id, t.created_at DESC),
    canon AS (SELECT DISTINCT ON (t.serial_id) t.serial_id, t.from_status, t.reason, t.created_at
                FROM inventory_status_transitions t JOIN v USING (serial_id)
               WHERE t.to_status = 'rented' ORDER BY t.serial_id, t.created_at DESC)
    SELECT v.*,
           lo.dc_number lo_dc, lo.customer_id lo_cust, lo.customer_name lo_cname, lo.entity_code lo_entity, lo.dt lo_dt, lo.sales_order_number lo_so,
           (SELECT string_agg(DISTINCT sl.quotation_type, '/') FROM sales_order_lines sl
             WHERE sl.sales_order_number = lo.sales_order_number AND sl.customer_id = lo.customer_id) lo_qtype,
           lr.dc_number lr_dc, lr.customer_id lr_cust, lr.dt lr_dt, lr.original_dc_number lr_orig,
           op.dc_number op_dc, op.status op_status, op.mt op_mt, op.customer_id op_cust,
           sos.sales_order_number sos_so, sos.status sos_status, sos.customer_id sos_cust, sos.quotation_type sos_qtype,
           sup.id sup_id, sup.customer_id sup_cust, sup.status sup_status, sup.top_level_remarks sup_remark, sup.pickup_type sup_pickup,
           tr.customer_id tr_cust, tr.to_status tr_to, tr.created_at tr_dt,
           canon.from_status canon_from, canon.reason canon_reason, canon.created_at canon_at,
           c.company_name lo_company
      FROM v LEFT JOIN lo USING (serial_id) LEFT JOIN lr USING (serial_id) LEFT JOIN op USING (serial_id)
      LEFT JOIN sos USING (serial_id) LEFT JOIN sup USING (serial_id) LEFT JOIN tr USING (serial_id)
      LEFT JOIN canon USING (serial_id)
      LEFT JOIN customers c ON c.customer_id = lo.customer_id
     ORDER BY v.serial_id`);

  const out = rows.map((r) => {
    const ev = [];
    ev.push(`last status change: ${r.canon_from || '?'} -> rented "${r.canon_reason || ''}" ${d10(r.canon_at)}`);
    ev.push(`ERP status ${r.erp_status || '-'} / last ERP action ${r.erp_action || '-'}`);
    if (r.lo_dc) ev.push(`last delivered outbound ${r.lo_dc} ${d10(r.lo_dt)} to customer ${r.lo_cust} (${r.lo_company || r.lo_cname || ''}), SO ${r.lo_so || '-'} type ${r.lo_qtype || '?'}, entity ${r.lo_entity || '-'}`);
    else ev.push('no delivered outbound challan lists this laptop');
    if (r.lr_dc) ev.push(`last delivered return ${r.lr_dc} ${d10(r.lr_dt)} from customer ${r.lr_cust} (return of ${r.lr_orig || '?'})`);
    if (r.op_dc) ev.push(`open challan ${r.op_dc} (${r.op_mt}, ${r.op_status}) customer ${r.op_cust}`);
    if (r.sos_so) ev.push(`sales-order serial ${r.sos_so} (${r.sos_status}) customer ${r.sos_cust} type ${r.sos_qtype}`);
    if (r.sup_id) ev.push(`support ticket #${r.sup_id} (${r.sup_status}, ${r.sup_pickup || 'n/a'}) customer ${r.sup_cust}: "${String(r.sup_remark || '').replace(/^\[TICKET-\d+\]\s*/, '').slice(0, 60)}"`);
    if (r.tr_cust) ev.push(`transition ${r.tr_to} ${d10(r.tr_dt)} had customer ${r.tr_cust}`);

    const base = {
      serial_id: r.serial_id, ttspl_id: r.tt, serial_number: r.serial_number,
      current_status: r.inventory_status, current_customer_id: r.current_customer_id, current_dc_number: r.current_dc_number,
      current_entity: r.current_entity, qc_status: r.qc_status, rent_start_date: d10(r.rent_start_date), rent_monthly_rate: r.rent_monthly_rate,
      erp_status: r.erp_status, erp_action: r.erp_action,
      last_outbound_dc: r.lo_dc, last_outbound_customer: r.lo_cust, last_outbound_type: r.lo_qtype, last_outbound_date: d10(r.lo_dt),
      last_return_dc: r.lr_dc, last_return_customer: r.lr_cust, last_return_date: d10(r.lr_dt), last_return_of: r.lr_orig,
      so_serial: r.sos_so ? `${r.sos_so}/${r.sos_status}/cust ${r.sos_cust}` : '',
      support_ticket: r.sup_id ? `#${r.sup_id}/${r.sup_status}/cust ${r.sup_cust}` : '',
      new_status: '', new_customer_id: '', new_customer_name: '', new_dc_number: '', new_entity: '', new_date: '',
    };

    const review = (why) => ({ ...base, evidence: ev.join('; '), proposed_fix: `Review manually: ${why}`, fix_code: 'REVIEW', confidence: 'low' });

    if (!r.lo_dc) return review('no delivered challan shows who has it. Check the laptop physically and the support ticket / transitions listed.');
    if (r.op_dc) return review(`it came back (${r.lr_dc || 'return'}) and is on open challan ${r.op_dc} — probably in the warehouse, not rented. Decide returned / reserved with dispatch.`);

    const isSale = /sale/.test(r.lo_qtype || '') || (r.lo_entity === 'gorefurbo');
    const loDay = d10(r.lo_dt);
    const lrDay = d10(r.lr_dt);
    // A return is "of the sale" when it points at the sale challan, or it is from the same
    // customer within 3 days of the sale (the old way of doing a sale-in-place: sale DC +
    // paper return DC + a support ticket "lost by customer").
    const nearSale = r.lr_dc && Math.abs(new Date(r.lr_dt) - new Date(r.lo_dt)) <= 3 * 86400000;
    const returnOfSale = r.lr_dc && (r.lr_orig === r.lo_dc || (String(r.lr_cust) === String(r.lo_cust) && nearSale));
    const returnAfterSale = r.lr_dc && !returnOfSale && lrDay > loDay;

    if (returnAfterSale) return review(`a return (${r.lr_dc} ${lrDay}) is dated after the last outbound ${r.lo_dc} ${loDay} — may be in the warehouse.`);

    const soAgrees = !r.sos_so || String(r.sos_cust) === String(r.lo_cust);
    const lostSale = /lost|sale/i.test(r.sup_remark || '');

    const fix = {
      ...base,
      new_customer_id: r.lo_cust, new_customer_name: r.lo_company || r.lo_cname || '', new_dc_number: r.lo_dc,
      new_entity: r.lo_entity || '', new_date: loDay,
    };
    if (isSale) {
      fix.new_status = 'sold';
      let conf = 'high';
      const why = [];
      if (!soAgrees) { conf = 'medium'; why.push(`the sales-order serial row says customer ${r.sos_cust}, the challan says ${r.lo_cust} (SO number reused)`); }
      if (returnOfSale && !lostSale) { conf = 'medium'; why.push(`a same-customer return ${r.lr_dc} sits next to the sale and the support ticket does not say "lost"/"sale"`); }
      if (r.lo_qtype && !/sale/.test(r.lo_qtype)) { conf = 'medium'; why.push(`SO type ${r.lo_qtype} on a ${r.lo_entity} challan`); }
      return {
        ...fix,
        evidence: ev.join('; ') + (why.length ? `; CAUTION: ${why.join('; ')}` : ''),
        proposed_fix: returnOfSale
          ? `Sold in place to ${fix.new_customer_name} (customer ${r.lo_cust}) on ${r.lo_dc} ${loDay}: the customer kept/lost it, the return challan ${r.lr_dc} was paperwork. Set status rented -> sold, customer, DC ${r.lo_dc}, entity ${r.lo_entity}.`
          : `Sold to ${fix.new_customer_name} (customer ${r.lo_cust}) on ${r.lo_dc} ${loDay}. Set status rented -> sold, customer, DC ${r.lo_dc}, entity ${r.lo_entity}.`,
        fix_code: 'TO_SOLD',
        confidence: conf,
      };
    }
    fix.new_status = 'rented';
    return {
      ...fix,
      evidence: ev.join('; '),
      proposed_fix: `Still rented to ${fix.new_customer_name} (customer ${r.lo_cust}) on ${r.lo_dc} ${loDay}. Restore customer, DC and entity (status stays rented). Billing: no rent start / rate on the laptop — set on the customer billing screen.`,
      fix_code: 'SET_CUSTOMER',
      confidence: soAgrees ? 'high' : 'medium',
    };
  });

  return writeCsv(1, 'rented-no-customer', [
    ...COMMON_HEAD, 'current_status', 'current_customer_id', 'current_dc_number', 'current_entity', 'qc_status',
    'rent_start_date', 'rent_monthly_rate', 'erp_status', 'erp_action',
    'last_outbound_dc', 'last_outbound_customer', 'last_outbound_type', 'last_outbound_date',
    'last_return_dc', 'last_return_customer', 'last_return_date', 'last_return_of', 'so_serial', 'support_ticket',
    'new_status', 'new_customer_id', 'new_customer_name', 'new_dc_number', 'new_entity', 'new_date', ...TAIL_HEAD,
  ], out);
}

// ── 2. In stock, QC not passed ─────────────────────────────────────────────
async function problem2(db) {
  const { rows } = await db.query(`
    WITH s AS (
      SELECT v.serial_id, ${TT} AS tt, v.serial_number, upper(v.serial_number) sn, v.inventory_status, v.qc_status, v.grn_id,
             v.extra->>'status' erp_status, v.extra->>'status2' erp_status2, v.extra->>'action_status' erp_action,
             v.extra->>'intake_source' intake_source, v.warehouse_carret, v.warehouse_carret_slot, v.extra->>'inventory_tag' tag,
             v.created_at
        FROM vendor_serial_numbers v
       WHERE ${LAPTOP} AND v.inventory_status = 'in_stock' AND v.qc_status IS DISTINCT FROM 'passed'),
    opn AS (SELECT DISTINCT ON (s.serial_id) s.serial_id, t.ticket_id, t.status, st.stage_name, t.ticket_type, t.qc1_passed_at, t.qc2_passed_at, t.updated_at
              FROM s JOIN tickets t ON t.vendor_serial_id = s.serial_id LEFT JOIN stages st ON st.stage_id = t.current_stage_id
             WHERE t.status NOT IN ('completed', 'cancelled') ORDER BY s.serial_id, t.ticket_id DESC),
    done AS (SELECT DISTINCT ON (s.serial_id) s.serial_id, t.ticket_id, t.completed_at, t.qc1_passed_at, t.qc2_passed_at, st.stage_name
               FROM s JOIN tickets t ON t.vendor_serial_id = s.serial_id LEFT JOIN stages st ON st.stage_id = t.current_stage_id
              WHERE t.status = 'completed' ORDER BY s.serial_id, t.completed_at DESC NULLS LAST, t.ticket_id DESC),
    lt AS (SELECT DISTINCT ON (t.serial_id) t.serial_id, t.from_status, t.to_status, t.reason, t.created_at
             FROM inventory_status_transitions t JOIN s USING (serial_id) ORDER BY t.serial_id, t.created_at DESC, t.transition_id DESC),
    wasout AS (SELECT t.serial_id, max(t.created_at) at FROM inventory_status_transitions t JOIN s USING (serial_id)
                WHERE t.to_status IN ('rented', 'sold', 'on_demo') GROUP BY 1),
    m AS (SELECT DISTINCT ON (s.serial_id, d.id) s.serial_id, d.* FROM s JOIN (${DC_SERIALS}) d
            ON (d.tt = s.tt OR (s.sn <> '' AND d.sn = s.sn)) WHERE d.status = 'delivered' AND NOT d.rej),
    ldc AS (SELECT DISTINCT ON (serial_id) * FROM m ORDER BY serial_id, dt DESC, id DESC),
    att AS (SELECT s.serial_id, string_agg(o.sales_order_number, ' ') sos FROM s JOIN sales_order_serials o ON o.serial_id = s.serial_id
             WHERE o.status = 'attached' GROUP BY 1)
    SELECT s.*, g.created_at grn_at,
           opn.ticket_id o_id, opn.status o_status, opn.stage_name o_stage, opn.ticket_type o_type, opn.qc1_passed_at o_qc1, opn.qc2_passed_at o_qc2,
           done.ticket_id c_id, done.completed_at c_at, done.qc1_passed_at c_qc1, done.qc2_passed_at c_qc2, done.stage_name c_stage,
           lt.from_status lt_from, lt.to_status lt_to, lt.reason lt_reason, lt.created_at lt_at,
           wasout.at wasout_at, ldc.dc_number l_dc, ldc.mt l_mt, ldc.dt l_dt, ldc.customer_id l_cust, att.sos
      FROM s LEFT JOIN vendor_goods_received_notes g ON g.grn_id = s.grn_id
      LEFT JOIN opn USING (serial_id) LEFT JOIN done USING (serial_id) LEFT JOIN lt USING (serial_id)
      LEFT JOIN wasout USING (serial_id) LEFT JOIN ldc USING (serial_id) LEFT JOIN att USING (serial_id)
     ORDER BY s.serial_id`);

  const out = rows.map((r) => {
    const ev = [];
    ev.push(`GRN ${r.grn_id || '-'} ${d10(r.grn_at)}${r.intake_source ? ` (intake ${r.intake_source})` : ''}`);
    ev.push(`ERP status ${r.erp_status || '-'}${r.erp_status2 ? `/${r.erp_status2}` : ''}, last ERP action ${r.erp_action || '-'}`);
    if (r.o_id) ev.push(`OPEN floor ticket #${r.o_id} ${r.o_status} at ${r.o_stage || '?'} (${r.o_type || ''})${r.o_qc2 ? `, QC2 passed ${d10(r.o_qc2)}` : ''}`);
    if (r.c_id) ev.push(`last completed ticket #${r.c_id} ${d10(r.c_at)} at ${r.c_stage || '?'}${r.c_qc2 ? `, QC2 passed ${d10(r.c_qc2)}` : r.c_qc1 ? `, QC1 passed ${d10(r.c_qc1)}` : ', no QC pass recorded'}`);
    if (r.lt_to) ev.push(`last transition ${r.lt_from || 'new'} -> ${r.lt_to} ${d10(r.lt_at)} "${String(r.lt_reason || '').slice(0, 70)}"`);
    else ev.push('no status transition recorded (ERP import)');
    if (r.wasout_at) ev.push(`was with a customer (last ${d10(r.wasout_at)})`);
    if (r.l_dc) ev.push(`last delivered challan ${r.l_dc} (${r.l_mt}) ${d10(r.l_dt)} customer ${r.l_cust}`);
    if (r.sos) ev.push(`ATTACHED to ${r.sos}`);
    const base = {
      serial_id: r.serial_id, ttspl_id: r.tt, serial_number: r.serial_number, current_status: r.inventory_status,
      qc_status: r.qc_status, grn_id: r.grn_id, grn_date: d10(r.grn_at), erp_status: r.erp_status, erp_action: r.erp_action,
      open_ticket: r.o_id ? `#${r.o_id} ${r.o_status} @ ${r.o_stage || '?'}` : '', open_ticket_id: r.o_id || '',
      last_completed_ticket: r.c_id ? `#${r.c_id} ${d10(r.c_at)}` : '',
      last_transition: r.lt_to ? `${r.lt_from || 'new'}->${r.lt_to} ${d10(r.lt_at)}` : '',
      last_delivered_dc: r.l_dc ? `${r.l_dc} ${r.l_mt} ${d10(r.l_dt)}` : '', attached_so: r.sos || '',
      carret_slot: r.warehouse_carret != null ? `${r.warehouse_carret}-${r.warehouse_carret_slot ?? ''}` : '', tag: r.tag || '',
      new_qc_status: '', new_status: '',
    };
    const done = (o) => ({ ...base, evidence: ev.join('; '), ...o });

    // An open floor ticket: the laptop is being worked on and must not be sellable.
    if (r.o_id) {
      if (r.o_stage === 'Inventory') {
        const passed = r.o_qc2 || r.o_qc1;
        return done(passed
          ? { new_qc_status: 'passed', proposed_fix: `Ticket #${r.o_id} reached Inventory with a QC pass (${d10(r.o_qc2 || r.o_qc1)}) but was never closed. Mark QC passed (then tag + slot on Ready stock); floor clean-up PD10 closes the ticket.`, fix_code: 'MARK_PASSED', confidence: 'medium' }
          : { proposed_fix: `Ticket #${r.o_id} is at Inventory with no QC pass recorded — floor manager to confirm whether it passed.`, fix_code: 'REVIEW', confidence: 'low' });
      }
      return done({
        new_status: 'in_repair',
        proposed_fix: r.o_stage === 'Pending Inventory'
          ? `Already on the floor — passed QC2 and waiting to be scanned into a slot (ticket #${r.o_id}). Set in_repair until it is received (receipt marks it passed).`
          : `Already on the floor — set in_repair (ticket #${r.o_id} at ${r.o_stage || '?'}). Same as PD10 floor clean-up TO_IN_REPAIR.`,
        fix_code: 'TO_IN_REPAIR',
        confidence: r.sos ? 'medium' : 'high',
      });
    }
    // No open ticket.
    if (r.l_mt === 'outbound') {
      return done({ proposed_fix: `Last delivered challan ${r.l_dc} is OUTBOUND to customer ${r.l_cust} with no return after it — the laptop may still be at the customer. Check physically before QC.`, fix_code: 'REVIEW', confidence: 'low' });
    }
    const cQc = r.c_qc2 || r.c_qc1;
    const cAfterOut = !r.l_dt || (r.c_at && new Date(r.c_at) > new Date(r.l_dt));
    if (r.c_id && cQc && cAfterOut) {
      return done({
        new_qc_status: 'passed',
        proposed_fix: `Completed floor ticket #${r.c_id} passed QC on ${d10(cQc)}${r.l_dc ? ` after it came back (${r.l_dc})` : ''} and nothing happened since. Mark QC passed (then tag + slot on Ready stock).`,
        fix_code: 'MARK_PASSED',
        confidence: 'medium',
      });
    }
    if (r.qc_status === 'qc_pending') {
      return done({ proposed_fix: 'Waiting for QC. Stays in stock as QC Pending (no data change); leaves sales-order stock once asset_available is QC-passed only.', fix_code: 'QC_PENDING_NO_ACTION', confidence: 'high' });
    }
    return done({
      new_qc_status: 'qc_pending',
      proposed_fix: `qc_status "${r.qc_status}" means "on the floor (QC process)" but there is no open floor ticket — nobody is working on it. Send to QC Pending (qc_status -> qc_pending, stays in_stock) so QC picks it up.`,
      fix_code: 'SET_QC_PENDING',
      confidence: 'high',
    });
  });

  return writeCsv(2, 'in-stock-not-qc-passed', [
    ...COMMON_HEAD, 'current_status', 'qc_status', 'grn_id', 'grn_date', 'erp_status', 'erp_action', 'open_ticket', 'open_ticket_id',
    'last_completed_ticket', 'last_transition', 'last_delivered_dc', 'attached_so', 'carret_slot', 'tag',
    'new_status', 'new_qc_status', ...TAIL_HEAD,
  ], out);
}

// ── 3. Not deployed but still pointing at a customer / DC ─────────────────
async function problem3(db) {
  const { rows } = await db.query(`
    WITH s AS (
      SELECT v.serial_id, ${TT} tt, v.serial_number, upper(v.serial_number) sn, v.inventory_status, v.qc_status, v.current_customer_id,
             v.current_dc_number, v.current_entity, v.returned_at, v.status_changed_at, v.warehouse_carret, v.warehouse_carret_slot
        FROM vendor_serial_numbers v
       WHERE ${LAPTOP} AND v.inventory_status IN ('in_stock', 'returned', 'in_repair', 'scrapped', 'qc_failed')
         AND (v.current_customer_id IS NOT NULL OR v.current_dc_number IS NOT NULL)),
    dc AS (SELECT DISTINCT ON (s.serial_id) s.serial_id, d.movement_type, d.status, d.customer_id,
                  COALESCE(d.delivered_at, d.delivery_completed_at, d.date_and_time, d.created_at) dt
             FROM s JOIN delivery_challan_lines d ON d.dc_number = s.current_dc_number ORDER BY s.serial_id, d.id DESC),
    m AS (SELECT DISTINCT ON (s.serial_id, d.id) s.serial_id, d.* FROM s JOIN (${DC_SERIALS}) d
            ON (d.tt = s.tt OR (s.sn <> '' AND d.sn = s.sn)) WHERE d.mt = 'return' AND d.status = 'delivered'),
    lr AS (SELECT DISTINCT ON (serial_id) * FROM m ORDER BY serial_id, dt DESC, id DESC),
    sup AS (SELECT s.serial_id,
                   string_agg(DISTINCT i.status || ':' || COALESCE(i.pickup_type, i.item_type), ' ') FILTER (WHERE i.status NOT IN ('resolved', 'cancelled', 'closed', 'inventory_updated')) open_items,
                   bool_or(i.status = 'inventory_updated' AND COALESCE(i.pickup_type, '') <> 'repair') ret_processed,
                   bool_or(i.status NOT IN ('resolved', 'cancelled', 'closed', 'inventory_updated') AND COALESCE(i.pickup_type, CASE WHEN i.source_item_id IS NOT NULL THEN 'repair' END) = 'repair') open_repair
              FROM s JOIN support_ticket_items i ON (upper(i.ttspl_id) = s.tt OR upper(i.unique_serial_number) = s.tt OR (s.sn <> '' AND upper(i.serial_number) = s.sn))
             GROUP BY 1),
    vr AS (SELECT s.serial_id, i.item_status, d.status dstat FROM s JOIN vendor_repair_dc_items i ON i.dc_number = s.current_dc_number AND i.serial_id = s.serial_id
             JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number)
    SELECT s.*, dc.movement_type dc_mt, dc.status dc_status, dc.customer_id dc_cust, dc.dt dc_dt,
           lr.dc_number lr_dc, lr.dt lr_dt, sup.open_items, sup.ret_processed, sup.open_repair, vr.item_status vr_item, vr.dstat vr_status
      FROM s LEFT JOIN dc USING (serial_id) LEFT JOIN lr USING (serial_id) LEFT JOIN sup USING (serial_id) LEFT JOIN vr USING (serial_id)
     ORDER BY s.inventory_status, s.serial_id`);

  const CSV6 = new Set(); // filled from problem 6 so a laptop is fixed in one place only
  const p6 = await db.query(`SELECT v.serial_id FROM vendor_serial_numbers v JOIN vendor_repair_dc_items i ON i.serial_id = v.serial_id
                              WHERE ${LAPTOP} AND v.inventory_status = 'scrapped' AND i.item_status = 'replacement_received'`);
  p6.rows.forEach((x) => CSV6.add(x.serial_id));

  const out = rows.map((r) => {
    const ev = [];
    if (r.current_dc_number) ev.push(`current DC ${r.current_dc_number}${r.dc_mt ? ` (${r.dc_mt}, ${r.dc_status}, customer ${r.dc_cust}, ${d10(r.dc_dt)})` : r.vr_item ? ` (vendor repair item ${r.vr_item}, challan ${r.vr_status})` : ' (not found in challans)'}`);
    if (r.lr_dc) ev.push(`last delivered return ${r.lr_dc} ${d10(r.lr_dt)}`);
    if (r.ret_processed) ev.push('support return pickup processed into inventory');
    if (r.open_items) ev.push(`OPEN support items: ${r.open_items}`);
    ev.push(`status changed ${d10(r.status_changed_at) || '?'}`);
    const cameBack = r.ret_processed || (r.lr_dc && (!r.dc_dt || new Date(r.lr_dt) >= new Date(r.dc_dt)));
    const base = {
      serial_id: r.serial_id, ttspl_id: r.tt, serial_number: r.serial_number, current_status: r.inventory_status, qc_status: r.qc_status,
      current_customer_id: r.current_customer_id, current_dc_number: r.current_dc_number, current_entity: r.current_entity,
      carret_slot: r.warehouse_carret != null ? `${r.warehouse_carret}-${r.warehouse_carret_slot ?? ''}` : '',
    };
    const done = (o) => ({ ...base, evidence: ev.join('; '), ...o });

    if (r.inventory_status === 'returned') {
      return done({
        proposed_fix: `Keep. "returned" = back from the customer, not yet processed by the warehouse: markReturned keeps the customer and DC on purpose — the return credit note (createReturnCreditNote) and the return floor ticket read current_customer_id, and customer billing counts returned units per customer. They are cleared when the laptop goes back to stock (transitionAsset -> in_stock).${r.current_customer_id ? '' : ' (This one has a DC but no customer — the credit note cannot find the customer; see list 1 logic if needed.)'}`,
        fix_code: 'KEEP_RETURNED', confidence: 'high',
      });
    }
    if (CSV6.has(r.serial_id)) {
      return done({ proposed_fix: 'Not scrap — the vendor kept it (see CSV 6, returned_to_vendor keeps the vendor repair DC).', fix_code: 'SEE_CSV6', confidence: 'high' });
    }
    if (r.inventory_status === 'in_repair' && /^VRDC/.test(r.current_dc_number || '')) {
      if (r.current_customer_id && !r.open_repair) {
        return done({ proposed_fix: `Out at the vendor on ${r.current_dc_number} — keep the DC (it is the vendor repair challan) but clear the customer: it is our laptop, not a customer's repair.`, fix_code: 'CLEAR_CUSTOMER', confidence: 'medium' });
      }
      return done({ proposed_fix: `Keep. In repair at the vendor: current_dc_number is the vendor repair challan ${r.current_dc_number} (set by the vendor repair dispatch). Cleared when it comes back.`, fix_code: 'KEEP_VENDOR_REPAIR_DC', confidence: 'high' });
    }
    if (r.open_repair) {
      return done({ proposed_fix: 'Review: an open support REPAIR pickup exists — this may be the customer\'s laptop in for repair (due back on a Service DC). Do not clear until support confirms.', fix_code: 'REVIEW', confidence: 'low' });
    }
    if (r.dc_mt === 'outbound' && !['delivered', 'cancelled', 'rejected'].includes(r.dc_status)) {
      return done({ proposed_fix: `Review: ${r.current_dc_number} is still open (${r.dc_status}) — clearing it would detach the laptop from a live challan.`, fix_code: 'REVIEW', confidence: 'low' });
    }
    const what = r.inventory_status === 'scrapped' ? 'Scrapped is terminal — it belongs to no customer or challan' : `${r.inventory_status.replace(/_/g, ' ')} — not with a customer`;
    return done({
      proposed_fix: `${what}. Clear current_customer_id and current_dc_number${r.inventory_status === 'in_stock' ? ' and current_entity (what transitionAsset -> in_stock does)' : ''}.`,
      fix_code: 'CLEAR_CUSTOMER_DC',
      confidence: cameBack ? 'high' : 'medium',
    });
  });

  return writeCsv(3, 'not-deployed-with-customer', [
    ...COMMON_HEAD, 'current_status', 'qc_status', 'current_customer_id', 'current_dc_number', 'current_entity', 'carret_slot', ...TAIL_HEAD,
  ], out);
}

// ── 4. Scrapped with no history; scrapped with open floor tickets ─────────
async function problem4(db) {
  const { rows } = await db.query(`
    WITH s AS (
      SELECT v.serial_id, ${TT} tt, v.serial_number, v.inventory_status, v.qc_status, v.created_at, v.status_changed_at,
             v.extra->>'dead_marked_at' dead_marked_at, v.extra->>'asset_movement_at' asset_movement_at,
             v.extra->>'asset_movement_by' asset_movement_by, v.extra->>'intake_source' intake_source, v.extra->>'status' erp_status
        FROM vendor_serial_numbers v
       WHERE ${LAPTOP} AND v.inventory_status = 'scrapped'
         AND NOT EXISTS (SELECT 1 FROM inventory_status_transitions t WHERE t.serial_id = v.serial_id AND t.to_status = 'scrapped')),
    aud AS (SELECT DISTINCT ON (s.serial_id) s.serial_id, a.created_at, a.actor_user_id, a.actor_name, a.metadata
              FROM s JOIN ttspl_audit_log a ON a.ttspl_id = s.tt AND a.description ILIKE 'Moved to Dead Laptop%'
             ORDER BY s.serial_id, a.created_at DESC),
    vr AS (SELECT s.serial_id, i.dc_number, i.item_status FROM s JOIN vendor_repair_dc_items i ON i.serial_id = s.serial_id AND i.item_status = 'replacement_received')
    SELECT s.*, aud.created_at aud_at, aud.actor_user_id aud_by, aud.metadata aud_meta, vr.dc_number vr_dc
      FROM s LEFT JOIN aud USING (serial_id) LEFT JOIN vr USING (serial_id) ORDER BY s.serial_id`);

  const out = rows.map((r) => {
    const base = {
      serial_id: r.serial_id, ttspl_id: r.tt, serial_number: r.serial_number, current_status: r.inventory_status, qc_status: r.qc_status,
      ticket_id: '', ticket_status: '', ticket_stage: '', backfill_date: '', backfill_actor_user_id: '', backfill_source: '',
    };
    if (r.vr_dc) {
      return { ...base, evidence: `vendor repair ${r.vr_dc}: item replacement_received — the vendor kept it and sent a replacement`, proposed_fix: 'Do not back-fill "scrapped": it is not scrap, the vendor kept it. Fixed in CSV 6 (returned_to_vendor).', fix_code: 'SEE_CSV6', confidence: 'high' };
    }
    let when; let by = ''; let src; let conf = 'high';
    if (r.aud_at) { when = r.aud_at; by = r.aud_by || ''; src = `ttspl_audit_log "Moved to Dead Laptop" (Asset Movement)${r.aud_meta?.from_qc_status ? `, qc was ${r.aud_meta.from_qc_status}` : ''}`; }
    else if (r.dead_marked_at) { when = r.dead_marked_at; by = r.asset_movement_by || ''; src = 'extra.dead_marked_at'; }
    else if (r.asset_movement_at) { when = r.asset_movement_at; by = r.asset_movement_by || ''; src = 'extra.asset_movement_at'; }
    else if (r.status_changed_at) { when = r.status_changed_at; src = 'status_changed_at'; }
    else if (r.intake_source === 'dead_laptop_csv_import') { when = r.created_at; src = 'created as dead by dead_laptop_csv_import (row created_at)'; }
    else { when = r.created_at; src = 'row created_at (no better date)'; conf = 'medium'; }
    return {
      ...base, backfill_date: new Date(when).toISOString(), backfill_actor_user_id: by, backfill_source: src,
      evidence: `no inventory_status_transitions row to scrapped; qc ${r.qc_status}, ERP status ${r.erp_status || '-'}; best date ${d10(when)} from ${src}`,
      proposed_fix: `Back-fill one audit row: -> scrapped at ${d10(when)}, reason "Backfill: scrapped before audit" (no status change).`,
      fix_code: 'BACKFILL_SCRAP_AUDIT', confidence: conf,
    };
  });

  const tk = await db.query(`
    SELECT v.serial_id, ${TT} tt, v.serial_number, v.inventory_status, v.qc_status, t.ticket_id, t.status, st.stage_name, t.ticket_type,
           t.created_at, t.updated_at, t.diagnosis_failed_reason
      FROM vendor_serial_numbers v JOIN tickets t ON t.vendor_serial_id = v.serial_id LEFT JOIN stages st ON st.stage_id = t.current_stage_id
     WHERE ${LAPTOP} AND v.inventory_status = 'scrapped' AND t.status IN ('in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair')
     ORDER BY t.ticket_id`);
  for (const r of tk.rows) {
    out.push({
      serial_id: r.serial_id, ttspl_id: r.tt, serial_number: r.serial_number, current_status: r.inventory_status, qc_status: r.qc_status,
      ticket_id: r.ticket_id, ticket_status: r.status, ticket_stage: r.stage_name || '', backfill_date: '', backfill_actor_user_id: '', backfill_source: '',
      evidence: `laptop scrapped; floor ticket #${r.ticket_id} (${r.ticket_type}) still ${r.status} at ${r.stage_name || '?'} since ${d10(r.updated_at)}${r.diagnosis_failed_reason ? `: "${String(r.diagnosis_failed_reason).slice(0, 60)}"` : ''}`,
      proposed_fix: `Cancel floor ticket #${r.ticket_id} (the laptop is scrapped). Same as PD10 floor clean-up CLOSE.`,
      fix_code: 'CANCEL_TICKET', confidence: 'high',
    });
  }
  return writeCsv(4, 'scrapped-no-history', [
    ...COMMON_HEAD, 'current_status', 'qc_status', 'ticket_id', 'ticket_status', 'ticket_stage',
    'backfill_date', 'backfill_actor_user_id', 'backfill_source', ...TAIL_HEAD,
  ], out);
}

// ── 5. Ready stock without tag or slot (list only) ─────────────────────────
async function problem5(db) {
  const { rows } = await db.query(`
    SELECT v.serial_id, ${TT} tt, v.serial_number, v.inventory_status, v.qc_status, v.extra->>'inventory_tag' tag,
           v.warehouse_carret, v.warehouse_carret_slot, v.status_changed_at, v.extra->>'model' model
      FROM asset_available a JOIN vendor_serial_numbers v ON v.serial_id = a.serial_id
     WHERE ${LAPTOP} AND v.qc_status = 'passed'
       AND (NULLIF(TRIM(v.extra->>'inventory_tag'), '') IS NULL OR v.warehouse_carret IS NULL OR v.warehouse_carret_slot IS NULL)
     ORDER BY v.serial_id`);
  const out = rows.map((r) => {
    const miss = [];
    if (!String(r.tag || '').trim()) miss.push('tag');
    if (r.warehouse_carret == null || r.warehouse_carret_slot == null) miss.push('carret slot');
    return {
      serial_id: r.serial_id, ttspl_id: r.tt, serial_number: r.serial_number, current_status: r.inventory_status, qc_status: r.qc_status,
      model: r.model, tag: r.tag || '', carret: r.warehouse_carret ?? '', slot: r.warehouse_carret_slot ?? '',
      evidence: `QC passed and available (asset_available); missing ${miss.join(' + ')}; in stock since ${d10(r.status_changed_at) || '?'}`,
      proposed_fix: 'Warehouse to tag (Rent / Sell / Both) and slot it on the Ready stock screen.',
      fix_code: 'WAREHOUSE_TAG_SLOT', confidence: 'high',
    };
  });
  return writeCsv(5, 'ready-no-tag-or-slot', [...COMMON_HEAD, 'current_status', 'qc_status', 'model', 'tag', 'carret', 'slot', ...TAIL_HEAD], out);
}

// ── 6. Scrapped by the old vendor-replacement logic ────────────────────────
async function problem6(db) {
  const { rows } = await db.query(`
    SELECT v.serial_id, ${TT} tt, v.serial_number, v.inventory_status, v.qc_status, v.current_dc_number, v.vendor_rent_end_date,
           v.extra->>'location' location, v.warehouse_carret, i.dc_number vr_dc, i.item_status, i.receive_mode, i.returned_at,
           i.replacement_ttspl_id, i.replacement_serial_number, i.replacement_dc_number, d.status vr_status,
           (SELECT t.reason FROM inventory_status_transitions t WHERE t.serial_id = v.serial_id AND t.to_status = 'scrapped' ORDER BY t.created_at DESC LIMIT 1) scrap_reason,
           (SELECT r.inventory_status FROM vendor_serial_numbers r WHERE r.serial_id = i.replacement_serial_id) repl_status,
           (SELECT string_agg(o.inventory_asset_code || ' ' || o.inventory_status, ', ') FROM vendor_serial_numbers o
             WHERE o.deleted_at IS NULL AND o.serial_id <> v.serial_id AND v.serial_number LIKE '%#archived-%'
               AND upper(o.serial_number) = upper(split_part(v.serial_number, '#', 1))) reentered_as
      FROM vendor_serial_numbers v
      JOIN vendor_repair_dc_items i ON i.serial_id = v.serial_id AND i.item_status = 'replacement_received'
      JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
     WHERE ${LAPTOP} AND v.inventory_status = 'scrapped'
     ORDER BY v.serial_id`);
  const named = new Set(['TTSPL7544', 'TTSPL7591', 'TTSPL7442']);
  const out = rows.map((r) => ({
    serial_id: r.serial_id, ttspl_id: r.tt, serial_number: r.serial_number, current_status: r.inventory_status, qc_status: r.qc_status,
    current_dc_number: r.current_dc_number, location: r.location, vendor_rent_end_date: d10(r.vendor_rent_end_date),
    vendor_repair_dc: r.vr_dc, replacement_ttspl_id: r.replacement_ttspl_id, replacement_serial: r.replacement_serial_number,
    replacement_dc_number: r.replacement_dc_number, in_task_list: named.has(r.tt) ? 'yes' : 'found',
    new_status: 'returned_to_vendor', new_qc_status: 'returned_to_vendor',
    evidence: [
      `vendor repair ${r.vr_dc} (${r.vr_status}): item ${r.item_status}, receive mode ${r.receive_mode}, ${d10(r.returned_at)}`,
      `replaced by ${r.replacement_ttspl_id} (${r.replacement_serial_number}) on ${r.replacement_dc_number}, replacement now ${r.repl_status || '?'}`,
      r.scrap_reason ? `scrap transition: "${r.scrap_reason}"` : 'scrapped with no transition (old code wrote the column directly)',
      `vendor rent already ended ${d10(r.vendor_rent_end_date)}`,
      r.reentered_as ? `serial archived: the same physical unit re-entered as ${r.reentered_as}` : '',
    ].filter(Boolean).join('; '),
    proposed_fix: `The vendor kept the original and sent a replacement — today's code (vendorRepairDcService, D9) sets returned_to_vendor, not scrapped. Set scrapped -> returned_to_vendor (allowOverride: scrapped is terminal in the state machine, this is a correction), DC ${r.vr_dc}, qc_status returned_to_vendor, extra.location with_vendor + replacement details. Vendor rent end and debit note are not touched (rent already ended).`,
    fix_code: 'TO_RETURNED_TO_VENDOR',
    confidence: 'high',
  }));
  return writeCsv(6, 'vendor-kept-not-scrap', [
    ...COMMON_HEAD, 'current_status', 'qc_status', 'current_dc_number', 'location', 'vendor_rent_end_date', 'vendor_repair_dc',
    'replacement_ttspl_id', 'replacement_serial', 'replacement_dc_number', 'in_task_list', 'new_status', 'new_qc_status', ...TAIL_HEAD,
  ], out);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    for (const fn of [problem1, problem2, problem3, problem4, problem5, problem6]) await fn(db);
    await db.query('ROLLBACK');
  } finally {
    db.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
