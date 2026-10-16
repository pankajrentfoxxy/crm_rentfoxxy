/**
 * Charger with / without, per laptop, on every laptop challan (migration 430).
 *
 *   DC / Replacement DC — derived from the Dispatch QC charger record (PRT IDs);
 *                         frozen when the gate dispatches the challan
 *   Service DC          — set on the challan; defaults to how it came back on its Return DC
 *   Return DC           — what we sent (PRT IDs); collected with / without at the
 *                         pickup; scanned in (or "none") at warehouse receive
 *   Repair DC (VRDC)    — set when the challan is made, editable on its page
 */
const charger = require('./dispatchChargerService');

const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
const up = (v) => String(v || '').trim().toUpperCase();

async function challanKind(db, dcNumber) {
  const v = await db.query('SELECT 1 FROM vendor_repair_delivery_challans WHERE dc_number = $1 LIMIT 1', [dcNumber]);
  if (v.rows.length) return 'vrdc';
  const r = await db.query(
    `SELECT movement_type, dc_purpose FROM delivery_challan_lines WHERE dc_number = $1 LIMIT 1`,
    [dcNumber]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.movement_type === 'return') return row.dc_purpose === 'part_return' ? null : 'rdc';
  if (row.movement_type === 'outbound') return row.dc_purpose === 'service_return' ? 'sdc' : 'dc';
  return null;
}

function parseDcSerials(raw) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list.map((s) => {
    const parts = String(s || '').split('|');
    return parts.length >= 3 ? { serial_number: parts[1] || null, ttspl_id: parts[2] || null } : { serial_number: parts[0] || null, ttspl_id: null };
  });
}

/** The laptops on a challan: [{ asset_code, ttspl_id, serial_number, item_id?, return_dc_number? }]. */
async function challanUnits(db, dcNumber, kind) {
  let rows = [];
  if (kind === 'vrdc') {
    rows = (await db.query(
      `SELECT ttspl_id, serial_number FROM vendor_repair_dc_items WHERE dc_number = $1 ORDER BY 1`,
      [dcNumber]
    )).rows;
  } else if (kind === 'rdc' || kind === 'sdc') {
    rows = (await db.query(
      `SELECT id AS item_id, COALESCE(NULLIF(ttspl_id, ''), unique_serial_number) AS ttspl_id, serial_number, return_dc_number,
              warehouse_received_at, gate_inward_at
         FROM support_ticket_items
        WHERE item_type = 'pickup' AND ${kind === 'rdc' ? 'return_dc_number' : 'service_dc_number'} = $1
          AND COALESCE(status, '') <> 'cancelled'
        ORDER BY id`,
      [dcNumber]
    )).rows;
  } else if (kind === 'dc') {
    const lines = (await db.query('SELECT serial_number FROM delivery_challan_lines WHERE dc_number = $1', [dcNumber])).rows;
    rows = lines.flatMap((l) => parseDcSerials(l.serial_number));
  }
  const seen = new Set();
  return rows
    .map((r) => ({ ...r, asset_code: up(r.ttspl_id || r.serial_number) }))
    .filter((r) => r.asset_code && !seen.has(r.asset_code) && seen.add(r.asset_code));
}

/** What went out with the laptop, from its Dispatch QC charger record. */
async function sentKit(db, ttspl) {
  if (!ttspl) return null;
  const row = await charger.findActiveByTtspl(db, ttspl);
  if (!row) return null;
  if (row.disposition === 'already_with_customer') return { charger: 'without', note: 'Customer already had a charger' };
  if (row.disposition !== 'attach' || !['attached', 'dispatched', 'returned'].includes(row.status)) return null;
  const pub = charger.publicRequest(row);
  return { charger: 'with', adapter: pub.adapter_label || pub.charger_label || null, cable: pub.cable_label || null, row };
}

const markOut = (m) => (m ? {
  charger: m.charger, adapter: m.adapter_code, cable: m.cable_code, matched: m.matched, note: m.note,
  source: m.source, at: m.recorded_at, by: m.recorded_by_name || null,
} : null);

async function getChallanChargers(db, dcNumber) {
  const kind = await challanKind(db, dcNumber);
  if (!kind) return null;
  const units = await challanUnits(db, dcNumber, kind);
  const marks = (await db.query(
    `SELECT m.*, u.name AS recorded_by_name FROM challan_charger_marks m LEFT JOIN users u ON u.user_id = m.recorded_by
      WHERE m.dc_number = $1`,
    [dcNumber]
  )).rows;
  const markFor = (asset, stage) => marks.find((m) => m.asset_code === asset && m.stage === stage) || null;

  const out = [];
  for (const u of units) {
    const unit = {
      asset_code: u.asset_code, ttspl_id: u.ttspl_id || null, serial_number: u.serial_number || null,
      item_id: u.item_id || null, warehouse_received_at: u.warehouse_received_at || null, gate_inward_at: u.gate_inward_at || null,
    };
    if (kind === 'dc' || kind === 'rdc') {
      const dm = kind === 'rdc' ? null : markFor(u.asset_code, 'dispatch');
      // A frozen mark keeps the charger sent at the time.
      const sent = dm ? null : await sentKit(db, u.ttspl_id);
      if (kind === 'dc') {
        unit.dispatch = dm ? markOut(dm) : (sent ? { charger: sent.charger, adapter: sent.adapter, cable: sent.cable, note: sent.note, derived: true } : null);
      } else {
        const wm = markFor(u.asset_code, 'warehouse');
        const cm = markFor(u.asset_code, 'collected');
        const frozen = wm || cm;
        unit.sent = frozen && (frozen.sent_adapter || frozen.sent_cable)
          ? { charger: 'with', adapter: frozen.sent_adapter, cable: frozen.sent_cable }
          : (sent ? { charger: sent.charger, adapter: sent.adapter, cable: sent.cable, note: sent.note } : null);
        unit.collected = markOut(cm);
        unit.warehouse = markOut(wm);
      }
    } else if (kind === 'sdc') {
      const dm = markFor(u.asset_code, 'dispatch');
      if (dm) unit.dispatch = markOut(dm);
      else if (u.return_dc_number) {
        // Goes back the way it came in.
        const back = (await db.query(
          `SELECT * FROM challan_charger_marks WHERE dc_number = $1 AND asset_code = $2 AND stage IN ('warehouse', 'collected')
            ORDER BY CASE stage WHEN 'warehouse' THEN 0 ELSE 1 END LIMIT 1`,
          [u.return_dc_number, u.asset_code]
        )).rows[0];
        unit.dispatch = back ? { charger: back.charger, adapter: back.adapter_code, cable: back.cable_code, derived: true, note: `As received on ${u.return_dc_number}` } : null;
      } else unit.dispatch = null;
    } else {
      unit.dispatch = markOut(markFor(u.asset_code, 'dispatch'));
    }
    out.push(unit);
  }
  return { kind, dc_number: dcNumber, units: out };
}

/**
 * Record with / without for one laptop.
 *   stage 'dispatch' — dc, sdc, vrdc
 *   stage 'collected' / 'warehouse' — rdc. With a charger we sent, "with" must
 *   scan that charger (and its cable); "without" needs a reason.
 */
async function setMark(db, { dcNumber, assetCode, stage, charger: chg, adapterScan, cableScan, note, user, source }) {
  const kind = await challanKind(db, dcNumber);
  if (!kind) throw httpError('Challan not found', 404);
  if (!['with', 'without'].includes(chg)) throw httpError('Choose with charger or without charger.');
  const okStage = kind === 'rdc' ? ['collected', 'warehouse'] : ['dispatch'];
  if (!okStage.includes(stage)) throw httpError(`That step is not on a ${kind.toUpperCase()}.`);
  const units = await challanUnits(db, dcNumber, kind);
  const unit = units.find((u) => u.asset_code === up(assetCode) || up(u.serial_number) === up(assetCode));
  if (!unit) throw httpError(`${assetCode} is not on ${dcNumber}.`, 404);
  const why = String(note || '').trim();
  const adapter = charger.normalizeCode(adapterScan) || null;
  const cable = charger.normalizeCode(cableScan) || null;

  let sentAdapter = null; let sentCable = null; let matched = null;
  if (kind === 'rdc') {
    if (stage === 'warehouse') {
      const prev = (await db.query(
        `SELECT 1 FROM challan_charger_marks WHERE dc_number = $1 AND asset_code = $2 AND stage = 'warehouse'`, [dcNumber, unit.asset_code]
      )).rows[0];
      if (prev && unit.warehouse_received_at) throw httpError('Already received at the warehouse.', 409);
    }
    const sent = await sentKit(db, unit.ttspl_id);
    if (sent?.charger === 'with') {
      sentAdapter = sent.adapter; sentCable = sent.cable;
      if (chg === 'with') {
        const units2 = sent.row.units || [];
        const a = units2.find((x) => x.kit_role === 'adapter') || units2[0];
        const c = units2.find((x) => x.kit_role === 'cable');
        const hit = (u, code) => Boolean(u && code && [u.prt_id, u.asset_code, u.serial_number].some((v) => charger.normalizeCode(v) === code));
        if (!adapter) throw httpError(`Scan the charger (${sentAdapter}).`);
        if (!hit(a, adapter) && !charger.chargerMatchesScan(sent.row, adapter)) throw httpError(`Not the charger we sent — expected ${sentAdapter}.`);
        if (c) {
          if (!cable) throw httpError(`Scan the power cable (${sentCable}).`);
          if (!hit(c, cable)) throw httpError(`Not the cable we sent — expected ${sentCable}.`);
        }
        matched = true;
      } else if (why.length < 3) {
        throw httpError(`We sent ${[sentAdapter, sentCable].filter(Boolean).join(' + ')} — say why it is not here.`);
      }
    }
  }

  await db.query(
    `INSERT INTO challan_charger_marks (doc_kind, dc_number, asset_code, stage, charger, adapter_code, cable_code,
       sent_adapter, sent_cable, matched, note, source, recorded_by, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (dc_number, asset_code, stage) DO UPDATE SET
       charger = EXCLUDED.charger, adapter_code = EXCLUDED.adapter_code, cable_code = EXCLUDED.cable_code,
       sent_adapter = COALESCE(EXCLUDED.sent_adapter, challan_charger_marks.sent_adapter),
       sent_cable = COALESCE(EXCLUDED.sent_cable, challan_charger_marks.sent_cable),
       matched = EXCLUDED.matched, note = EXCLUDED.note, source = EXCLUDED.source,
       recorded_by = EXCLUDED.recorded_by, recorded_at = NOW()`,
    [kind, dcNumber, unit.asset_code, stage, chg, chg === 'with' ? adapter : null, chg === 'with' ? cable : null,
      sentAdapter, sentCable, matched, why || null, source || 'manual', user?.user_id || null]
  );
  return { kind, asset_code: unit.asset_code, charger: chg, matched };
}

/**
 * Warehouse receive of a Return DC: record the charger check sent with the
 * receive, then refuse while any laptop through the gate has none.
 */
async function applyWarehouseChargerCheck(db, rdcNumber, chargers, user) {
  for (const c of Array.isArray(chargers) ? chargers : []) {
    await setMark(db, {
      dcNumber: rdcNumber, assetCode: c.asset_code, stage: 'warehouse', charger: c.charger,
      adapterScan: c.adapter_scan, cableScan: c.cable_scan, note: c.note, user, source: 'warehouse_receive',
    });
  }
  const st = await getChallanChargers(db, rdcNumber);
  const open = (st?.units || []).filter((u) => u.gate_inward_at && !u.warehouse_received_at && !u.warehouse);
  if (open.length) {
    throw httpError(`Charger check missing for ${open.map((u) => u.asset_code).join(', ')} — scan its charger or mark "No charger" (Return DC page → Receive at warehouse).`, 409);
  }
}

/** Gate dispatch of a DC: keep what went with each laptop, as it was then. */
async function freezeDispatchMarks(db, dcNumber, user) {
  const kind = await challanKind(db, dcNumber);
  if (kind !== 'dc') return 0;
  let n = 0;
  for (const u of await challanUnits(db, dcNumber, kind)) {
    const sent = await sentKit(db, u.ttspl_id);
    if (!sent) continue;
    const r = await db.query(
      `INSERT INTO challan_charger_marks (doc_kind, dc_number, asset_code, stage, charger, adapter_code, cable_code, sent_adapter, sent_cable, note, source, recorded_by)
       VALUES ('dc', $1, $2, 'dispatch', $3, $4, $5, $4, $5, $6, 'dispatch_qc', $7)
       ON CONFLICT (dc_number, asset_code, stage) DO NOTHING`,
      [dcNumber, u.asset_code, sent.charger, sent.adapter || null, sent.cable || null, sent.note || null, user?.user_id || null]
    );
    n += r.rowCount;
  }
  return n;
}

/** "With charger (PRT00123 + PRT00456)" / "Without charger" / null — for PDFs and lists. */
function chargerText(m) {
  if (!m) return null;
  if (m.charger === 'without') return 'Without charger';
  const codes = [m.adapter, m.cable].filter(Boolean).join(' + ');
  return codes ? `With charger (${codes})` : 'With charger';
}

/** asset_code → text, for a challan PDF (best effort: never breaks the PDF). */
async function chargerTextsForPdf(db, dcNumber) {
  try {
    const data = await getChallanChargers(db, dcNumber);
    const map = new Map();
    for (const u of data?.units || []) {
      let t;
      if (data.kind === 'rdc') {
        const recv = u.warehouse || u.collected;
        const sentT = u.sent?.charger === 'with' ? `Charger sent: ${[u.sent.adapter, u.sent.cable].filter(Boolean).join(' + ') || 'yes'}` : null;
        const verb = u.warehouse ? 'Received' : 'Collected';
        t = [sentT, recv ? `${verb} ${recv.charger === 'with' ? 'with' : 'without'} charger` : null].filter(Boolean).join(' · ') || null;
      } else t = chargerText(u.dispatch);
      if (t) {
        map.set(u.asset_code, t);
        if (u.serial_number) map.set(up(u.serial_number), t);
      }
    }
    return map;
  } catch (e) {
    console.error('charger texts for pdf:', e.message);
    return new Map();
  }
}

module.exports = { applyWarehouseChargerCheck, challanKind, challanUnits, getChallanChargers, setMark, freezeDispatchMarks, chargerText, chargerTextsForPdf, sentKit };
