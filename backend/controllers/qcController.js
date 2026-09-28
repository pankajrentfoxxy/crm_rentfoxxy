const pool = require('../config/db');
const { assertMayPassQc, assertQc2Matched, overrideFrom } = require('../services/qcGateService');
const { reserveOnQcPass } = require('../services/qcPassReservation');
const {
    pickNextAssigneeForTeam,
    fetchOrderedMemberIds,
    recordAssigneeForTeam
} = require('../services/qcRoundRobinService');
const { syncWorkLogForTicketState } = require('../services/ticketWorkLogService');
const { markVendorSerialReadyForRent } = require('../services/grnTicketService');
const { vacateWarehouseLocation } = require('../services/warehouseLocationService');
const ttsplAuditService = require('../services/ttsplAuditService');
const { logProductionHistory } = require('../services/ticketWorkflowHistoryService');
const { assertTicketNotPartBlocked } = require('../services/ticketPartBlockService');
const { assertReadyForDispatchQc } = require('../services/dispatchChargerService');
const { buildQcFailure, auditEventType } = require('../services/qcFailureService');
const { applyStageMove, StageTransitionRefused } = require('../services/stageTransitionService');

/** The only stages a QC submission can legitimately come from. */
const QC_SUBMITTABLE_STAGES = ['QC1', 'QC2', 'Dispatch QC'];

// QC Checklist Configuration
const QC_CHECKLIST_STRUCTURE = {
    body_physical: {
        body_scratches: { label: 'Body Scratches Available', options: ['YES', 'NO'] },
        physical_damage: { label: 'Physical Damage / Crack Available', options: ['YES', 'NO'] },
        body_screws: { label: 'Body Check for Screws', options: ['YES', 'NO'] },
        ttspl_id: { label: 'TTSPL ID', options: ['YES', 'NO'] },
        body_hinge: { label: 'Body Check for Hinge', options: ['YES', 'NO'] }
    },
    internal_thermal: {
        motherboard_cleaning: { label: 'Motherboard Cleaning & CPU Paste', options: ['YES', 'NO'] },
        heating_test: { label: 'Heating Issues Test', options: ['YES', 'NO'] }
    },
    camera_bios_drivers: {
        camera_recording: { label: 'Camera (Video & Audio) Recording', options: ['YES', 'NO'] },
        bios_check: { label: 'BIOS Check', options: ['YES', 'NO'] },
        required_drivers: { label: 'All Required Drivers', options: ['YES', 'NO'] }
    },
    os_software: {
        ms_office: { label: 'MS Office Installation & Activation', options: ['INSTALLED', 'NOT INSTALLED'] },
        chrome: { label: 'Chrome', options: ['INSTALLED', 'NOT INSTALLED'] },
        ultra_viewer: { label: 'Ultra Viewer', options: ['INSTALLED', 'NOT INSTALLED'] },
        virtual_memory: { label: 'Virtual Memory Set as per RAM', options: ['YES', 'NO'] }
    },
    input_devices: {
        touchpad: { label: 'Touch Pad', options: ['WORKING', 'NOT WORKING'] },
        cursor_speed: { label: 'Cursor Speed Set 80%', options: ['YES', 'NO'] },
        left_click: { label: 'Left Click', options: ['WORKING', 'NOT WORKING'] },
        right_click: { label: 'Right Click', options: ['WORKING', 'NOT WORKING'] },
        scrolling: { label: 'Scrolling', options: ['WORKING', 'NOT WORKING'] },
        keyboard: { label: 'Keyboard', options: ['WORKING', 'NOT WORKING'] },
        keyboard_light: { label: 'Keyboard Light', options: ['YES', 'NO'] }
    },
    ports_connectivity: {
        usb_ports: { label: 'All USB Ports', options: ['WORKING', 'NOT WORKING'] },
        vga_hdmi: { label: 'VGA or HDMI', options: ['WORKING', 'NOT WORKING'] },
        lan_port: { label: 'LAN Port', options: ['WORKING', 'NOT WORKING'] },
        wifi_test: { label: 'WiFi Test (2.4 / 5 GHz)', options: ['WORKING', 'NOT WORKING'] },
        power_adapter: { label: 'Power Adapter & Watt', options: ['WORKING', 'NOT WORKING'] },
        bluetooth: { label: 'Bluetooth Check', options: ['WORKING', 'NOT WORKING'] },
        audio_jack: { label: 'Audio Jack', options: ['YES', 'NO'] }
    },
    display_audio: {
        speaker: { label: 'Speaker', options: ['WORKING', 'NOT WORKING'] },
        screen_resolution: { label: 'Screen Resolution', options: ['PASS', 'FAIL'] },
        refresh_rate: { label: 'Display Adapter Refresh Rate Set', options: ['YES', 'NO'] },
        touch_screen: { label: 'Touch Screen', options: ['YES', 'NO'] }
    },
    power_storage: {
        ssd_health: { label: 'SSD Health', options: ['GOOD', 'AVERAGE', 'BAD'] },
        battery_health: { label: 'Battery Health', options: ['GOOD', 'AVERAGE', 'BAD'] }
    },
    hardware_expandability: {
        expandability: { label: 'Hard Drive, RAM Type & Expandable Possibility', options: ['YES', 'NO'] }
    },
    part_replacement: {
        parts_replaced: { label: 'Any Part Replaced', options: ['YES', 'NO'] }
    }
};

const CHECKLIST_POSITIVE_VALUES = new Set(['YES', 'WORKING', 'INSTALLED', 'PASS', 'GOOD', 'AVERAGE']);

function buildChecklistSummary(checklistData) {
    if (!checklistData) return [];

    const labelMap = Object.values(QC_CHECKLIST_STRUCTURE).reduce((acc, section) => {
        Object.entries(section).forEach(([key, config]) => {
            acc[key] = config.label;
        });
        return acc;
    }, {});

    return Object.entries(checklistData)
        .filter(([, value]) => CHECKLIST_POSITIVE_VALUES.has(value))
        .map(([key]) => labelMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
}

// ── QC grading ────────────────────────────────────────────────────
//
// The questions, their good/bad answers and which answers fail each stage live
// in services/floorChecklists.js, which the form also reads — so the browser
// can no longer predict a pass the server then refuses (it used to check 7
// rules while the server checked 22 for QC2). QC2 is stricter than QC1;
// Dispatch QC keeps the QC1 rules.
const floorChecklists = require('../services/floorChecklists');

function calculateQCResult(checklistData, qcStage = 'QC1') {
    return floorChecklists.qcResult(checklistData, qcStage);
}

// Questions a submission must answer. The old QC form (Old view) predates the
// BitLocker question, so it is held to the questions it has.
function requiredQcItems(checklistVersion) {
    return Number(checklistVersion) >= 2
        ? floorChecklists.QC_ITEMS
        : floorChecklists.QC_ITEMS.filter((it) => !it.since);
}

exports.getFloorChecklists = async (req, res) => {
    try {
        const stages = ['Chip Level Repair', 'Body & Paint', 'Assembly & Software', 'Final Testing'];
        const stageChecklists = {};
        for (const st of stages) stageChecklists[st] = await floorChecklists.stageChecklistItems(pool, st);
        res.json({
            success: true,
            qc: {
                sections: floorChecklists.QC_SECTIONS,
                grades: floorChecklists.QC_GRADES,
                criteria: {
                    QC1: floorChecklists.qcCriteria('QC1'),
                    QC2: floorChecklists.qcCriteria('QC2'),
                    'Dispatch QC': floorChecklists.qcCriteria('Dispatch QC'),
                },
            },
            diagnosis: { sections: floorChecklists.DIAGNOSIS_SECTIONS, outcomes: floorChecklists.DIAGNOSIS_OUTCOMES },
            stages: stageChecklists,
            stageOutcomes: Object.fromEntries(Object.entries(require('./floorBoard.controller').STAGE_OUTCOMES)
                .map(([st, o]) => [st, Object.entries(o).map(([value, v]) => ({ value, label: v.label, needsReason: !!v.needsReason, to: v.to }))])),
        });
    } catch (error) {
        console.error('Floor checklists error:', error);
        res.status(500).json({ success: false, message: 'Could not load the checklists' });
    }
};

// Get QC data for a ticket
exports.getQCData = async (req, res) => {
    const { id } = req.params;
    const { qc_stage } = req.query; // 'QC1' or 'QC2'

    try {
        // Get ticket details for header auto-fill
        const ticketRes = await pool.query(
            `SELECT t.*, i.processor, i.ram as ram_size, i.storage as storage_type 
             FROM tickets t
             LEFT JOIN inventory i ON t.serial_number = i.serial_number
             WHERE t.ticket_id = $1`,
            [id]
        );

        if (ticketRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }

        const ticket = ticketRes.rows[0];

        // Get existing QC result if any
        const qcRes = await pool.query(
            `SELECT * FROM qc_results WHERE ticket_id = $1 AND qc_stage = $2`,
            [id, qc_stage || 'QC1']
        );

        const qcResult = qcRes.rows[0] || null;

        // Get photos if QC exists
        let photos = [];
        if (qcResult) {
            const photoRes = await pool.query(
                `SELECT * FROM qc_photos WHERE qc_id = $1`,
                [qcResult.qc_id]
            );
            photos = photoRes.rows;
        }

        res.json({
            success: true,
            ticket,
            qcResult,
            photos,
            checklistStructure: QC_CHECKLIST_STRUCTURE
        });

    } catch (error) {
        console.error('Get QC data error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Active users eligible for QC2 assignment (QC2 team members, incl. multi-team QC1+QC2)
exports.getQC2Assignees = async (req, res) => {
    try {
        const stageRes = await pool.query(
            `SELECT team_id FROM stages WHERE stage_name = 'QC2' LIMIT 1`
        );
        if (stageRes.rows.length === 0 || stageRes.rows[0].team_id == null) {
            return res.json({ success: true, assignees: [] });
        }
        const teamId = stageRes.rows[0].team_id;
        const result = await pool.query(
            `SELECT DISTINCT u.user_id, u.name, u.email
             FROM users u
             LEFT JOIN user_teams ut ON u.user_id = ut.user_id AND ut.team_id = $1
             WHERE (u.team_id = $1 OR ut.team_id = $1)
               AND COALESCE(u.active, true) = true
             ORDER BY u.name ASC`,
            [teamId]
        );
        res.json({ success: true, assignees: result.rows });
    } catch (error) {
        console.error('Get QC2 assignees error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Save QC draft
exports.saveQC = async (req, res) => {
    const { id } = req.params;
    const { qcStage, header, checklist, grading, remarks, replacedParts } = req.body;
    const userId = req.user.user_id;

    try {
        // Check if QC already exists
        const existing = await pool.query(
            `SELECT qc_id FROM qc_results WHERE ticket_id = $1 AND qc_stage = $2`,
            [id, qcStage]
        );

        if (existing.rows.length > 0) {
            // Update existing — a draft is always unlocked so it reloads on re-entry.
            await pool.query(
                `UPDATE qc_results 
                 SET processor = $1, generation = $2, storage_type = $3, ram_size = $4,
                     checklist_data = $5, final_grade = $6, grade_notes = $7, remarks = $8,
                     parts_replaced = $9, replaced_parts = $10, tested_by = $11, is_locked = false
                 WHERE qc_id = $12`,
                [
                    header.processor, header.generation, header.storage_type, header.ram_size,
                    JSON.stringify(checklist), grading?.final_grade, grading?.grade_notes, remarks,
                    replacedParts && replacedParts.length > 0, JSON.stringify(replacedParts || []),
                    userId, existing.rows[0].qc_id
                ]
            );

            res.json({ success: true, message: 'QC draft saved', qc_id: existing.rows[0].qc_id });
        } else {
            // Insert new
            const result = await pool.query(
                `INSERT INTO qc_results 
                 (ticket_id, qc_stage, processor, generation, storage_type, ram_size, 
                  checklist_data, final_grade, grade_notes, remarks, parts_replaced, 
                  replaced_parts, tested_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 RETURNING qc_id`,
                [
                    id, qcStage, header.processor, header.generation, header.storage_type, header.ram_size,
                    JSON.stringify(checklist), grading?.final_grade, grading?.grade_notes, remarks,
                    replacedParts && replacedParts.length > 0, JSON.stringify(replacedParts || []),
                    userId
                ]
            );

            res.json({ success: true, message: 'QC draft created', qc_id: result.rows[0].qc_id });
        }

    } catch (error) {
        console.error('Save QC error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Submit QC and route ticket
exports.submitQC = async (req, res) => {
    const { id } = req.params;
    const { remarks, replacedParts, signOff, assignToUserId, inventory_tag } = req.body;
    // A "fail it now" submission may come without a checklist, header or grade.
    const checklist = req.body.checklist || {};
    const grading = req.body.grading || { final_grade: null, grade_notes: null };
    const header = req.body.header || {};
    const userId = req.user.user_id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const ticketBeforeRes = await client.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
        const ticketBefore = ticketBeforeRes.rows[0] || null;
        if (!ticketBefore) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Ticket not found' });
        }
        const beforeStageRes = ticketBefore.current_stage_id
          ? await client.query('SELECT stage_name FROM stages WHERE stage_id = $1', [ticketBefore.current_stage_id])
          : { rows: [] };
        const beforeStageName = beforeStageRes.rows[0]?.stage_name || null;

        // Part 5.3 (finding R3) — the stage comes from the TICKET, never from the
        // request body. submitQC used to take req.body.qcStage on trust and never
        // compare it to current_stage_id, so a ticket sitting at Diagnosis could
        // be submitted as a QC2 pass and jump to Pending Inventory.
        const qcStage = beforeStageName;
        if (!QC_SUBMITTABLE_STAGES.includes(qcStage)) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: `This ticket is at "${qcStage || 'an unknown stage'}" — QC can only be submitted from ${QC_SUBMITTABLE_STAGES.join(', ')}.`,
            });
        }
        const claimedStage = req.body.qcStage;
        if (claimedStage && String(claimedStage) !== qcStage) {
            // Not an error: the client is simply out of date. The ticket wins, and
            // the disagreement is worth seeing in the log.
            console.warn(
                `[qc] ticket ${id}: client submitted qcStage="${claimedStage}" but the ticket is at "${qcStage}". Using the ticket.`
            );
        }

        const ticketMetaRes = await client.query(
            `SELECT serial_number, machine_number, vendor_serial_id, ticket_type, ttspl_id, qc_fail_count
               FROM tickets WHERE ticket_id = $1`,
            [id]
        );
        const ticketMeta = ticketMetaRes.rows[0] || {};
        const serialNumber = ticketMeta.serial_number || null;
        const machineNumber = ticketMeta.machine_number || null;

        // "Fail it now" — the inspector can fail without the checklist when the
        // laptop cannot be tested (configuration mismatch, won't start). A
        // failure is always safe to record; it needs a real reason.
        const forceFailReason = String(req.body.force_fail_reason || '').trim();
        if (req.body.force_fail_reason != null && forceFailReason.length < 5) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Say why it fails (at least 5 characters).' });
        }

        // Every question answered with one of its own answers, and a grade —
        // checked here, not only in the browser.
        if (!forceFailReason) {
            const { missing, invalid } = floorChecklists.checkAnswers(requiredQcItems(req.body.checklist_version), checklist);
            if (missing.length || invalid.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    code: 'QC_INCOMPLETE',
                    message: missing.length
                        ? `Answer every question first — ${missing.length} still open.`
                        : `Some answers are not valid for their question (${invalid.join(', ')}).`,
                    missing, invalid,
                });
            }
            if (!floorChecklists.QC_GRADES.some((g) => g.value === grading?.final_grade)) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, code: 'QC_NO_GRADE', message: 'Choose the grade.' });
            }
            const bad = floorChecklists.badAnswers(floorChecklists.QC_ITEMS, checklist);
            if (bad.length && !String(remarks || '').trim()) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, code: 'QC_REMARKS', message: 'Write a remark about the problems you marked.' });
            }
        }

        // Calculate QC result against the criteria for THIS stage (Part 5.4).
        const { result, reasons } = forceFailReason
            ? { result: 'FAIL', reasons: [forceFailReason] }
            : calculateQCResult(checklist, qcStage);

        // Production safety A (PD2, PD3). A pass needs an inspector who did not
        // repair it, and a QC2 pass needs the configuration check to have
        // matched on the server — unless a manager overrides with a reason.
        let qcGate = { kind: 'checklist' };
        if (result === 'PASS' && ['QC1', 'QC2'].includes(qcStage)) {
            try {
                const override = overrideFrom(req.user, req.body.qc_override_reason);
                await assertMayPassQc(client, { ticketId: Number(id), user: req.user, stageName: qcStage });
                if (qcStage === 'QC2') {
                    if (override) qcGate = { kind: 'checklist', override: override.reason };
                    else await assertQc2Matched(client, { ticketId: Number(id) });
                }
            } catch (gateErr) {
                await client.query('ROLLBACK');
                return res.status(gateErr.status || 409).json({ success: false, code: gateErr.code || 'QC_GATE', message: gateErr.message });
            }
        }

        // Save or update QC result
        const qcCheck = await client.query(
            `SELECT qc_id FROM qc_results WHERE ticket_id = $1 AND qc_stage = $2`,
            [id, qcStage]
        );

        let qcId;
        if (qcCheck.rows.length > 0) {
            qcId = qcCheck.rows[0].qc_id;
            await client.query(
                `UPDATE qc_results 
                 SET processor = $1, generation = $2, storage_type = $3, ram_size = $4,
                     checklist_data = $5, final_grade = $6, grade_notes = $7, remarks = $8,
                     parts_replaced = $9, replaced_parts = $10, qc_result = $11, failure_reasons = $12,
                     tested_by = $13, checked_by = $14, qc_date = $15, is_locked = true, submitted_at = CURRENT_TIMESTAMP
                 WHERE qc_id = $16`,
                [
                    header.processor, header.generation, header.storage_type, header.ram_size,
                    JSON.stringify(checklist), grading.final_grade, grading.grade_notes, remarks,
                    replacedParts && replacedParts.length > 0, JSON.stringify(replacedParts || []),
                    result, reasons, userId, signOff?.checked_by || userId, new Date(), qcId
                ]
            );
        } else {
            const insertRes = await client.query(
                `INSERT INTO qc_results 
                 (ticket_id, qc_stage, processor, generation, storage_type, ram_size, 
                  checklist_data, final_grade, grade_notes, remarks, parts_replaced, 
                  replaced_parts, qc_result, failure_reasons, tested_by, checked_by, qc_date, 
                  is_locked, submitted_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true, CURRENT_TIMESTAMP)
                 RETURNING qc_id`,
                [
                    id, qcStage, header.processor, header.generation, header.storage_type, header.ram_size,
                    JSON.stringify(checklist), grading.final_grade, grading.grade_notes, remarks,
                    replacedParts && replacedParts.length > 0, JSON.stringify(replacedParts || []),
                    result, reasons, userId, signOff?.checked_by || userId, new Date()
                ]
            );
            qcId = insertRes.rows[0].qc_id;
        }

        // Append-only history snapshot (does not change QC workflow / unique current row)
        try {
            const { snapshotQcResultToHistory } = require('../services/productionQcReportService');
            await snapshotQcResultToHistory(client, qcId);
        } catch (histErr) {
            console.error('QC history snapshot failed:', histErr.message);
            // Do not fail the QC submit if history table is missing on an unmigrated env
        }

        // Update ticket grade from QC (QC1 and QC2)
        if (grading.final_grade) await client.query(
            `UPDATE tickets SET final_grade = $1 WHERE ticket_id = $2`,
            [grading.final_grade, id]
        );

        if (grading.final_grade && (serialNumber || machineNumber)) {
            await client.query(
                `UPDATE inventory SET grade = $1 WHERE serial_number = $2 OR machine_number = $3`,
                [grading.final_grade, serialNumber, machineNumber]
            );
        }

        // Route ticket based on result.
        //
        // Part 5.4 (R5, R6): a failure is now described by ONE routine, shared
        // with ticketPhase2Controller.moveToStage, so the two entry points
        // produce identical rows. It also decides the destination, because the
        // third failure escalates to the floor manager instead of going round
        // the rework loop again.
        const failure = result === 'FAIL'
            ? buildQcFailure({
                stage: qcStage,
                reason: remarks?.trim() || reasons.join('; '),
                currentFailCount: ticketMeta.qc_fail_count || 0,
              })
            : null;

        let nextStage;
        // Dispatch QC failure has two routes: fix it for the same order (back to
        // Assembly, stays on the order) or take it off the order (Diagnosis).
        const dispatchRemove = failure && qcStage === 'Dispatch QC' && !failure.escalated
            && req.body.dispatch_fail_mode === 'remove';
        if (failure) {
            nextStage = dispatchRemove ? 'Diagnosis' : failure.toStageName;
        } else if (qcStage === 'QC1') {
            // F21: a sales-order laptop goes QC1 -> Dispatch QC, as move-stage
            // already did; this path sent it to QC2.
            nextStage = ticketMeta.ticket_type === 'sales_order_qc' ? 'Dispatch QC' : 'QC2';
        } else {
            // Dispatch QC still goes to Inventory. Floor QC2 goes to Pending Inventory.
            nextStage = qcStage === 'Dispatch QC' ? 'Inventory' : 'Pending Inventory';
        }

        if (ticketBefore?.ticket_id) {
            try {
                await assertTicketNotPartBlocked(client, ticketBefore.ticket_id);
            } catch (blockErr) {
                await client.query('ROLLBACK');
                return res.status(blockErr.status || 409).json({ success: false, message: blockErr.message });
            }
        }

        if (qcStage === 'Dispatch QC') {
            try {
                await assertReadyForDispatchQc(client, Number(id), { requireScan: result === 'PASS' });
            } catch (chargerErr) {
                await client.query('ROLLBACK');
                return res.status(chargerErr.status || 409).json({ success: false, message: chargerErr.message });
            }
        }

        // Get next stage ID
        const stageRes = await client.query(
            `SELECT stage_id, team_id FROM stages WHERE stage_name = $1 LIMIT 1`,
            [nextStage]
        );

        if (stageRes.rows.length > 0) {
            const { stage_id, team_id } = stageRes.rows[0];
            const isCompleted = nextStage === 'Inventory';
            const isPendingInventory = nextStage === 'Pending Inventory';
            let assignedUserId = null;
            if (result === 'PASS' && qcStage === 'QC1') {
                const manualId = assignToUserId != null && assignToUserId !== ''
                    ? parseInt(assignToUserId, 10)
                    : null;
                if (manualId != null && !Number.isNaN(manualId)) {
                    const eligible = await fetchOrderedMemberIds(client, team_id);
                    if (!eligible.includes(manualId)) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            success: false,
                            message: 'Selected assignee is not an active QC2 team member'
                        });
                    }
                    assignedUserId = manualId;
                    try {
                        await recordAssigneeForTeam(client, team_id, manualId);
                    } catch (rrErr) {
                        console.error('QC2 manual assign round-robin sync failed:', rrErr);
                    }
                } else {
                    try {
                        assignedUserId = await pickNextAssigneeForTeam(client, team_id);
                    } catch (rrErr) {
                        console.error('QC2 round-robin assignment failed:', rrErr);
                        assignedUserId = null;
                    }
                }
            } else if (failure && !failure.escalated && qcStage !== 'Dispatch QC') {
                // Going back round the loop needs somebody to go back to. An
                // escalated ticket goes to the floor manager's queue instead, so
                // there is nobody to pre-assign.
                // PD9: naming who fixes it is optional — without a name the
                // ticket waits in that stage's queue, where its team claims it.
                const teamLabel = qcStage === 'QC2' ? 'QC1' : 'Hardware & Software';
                const manualId = assignToUserId != null && assignToUserId !== ''
                    ? parseInt(assignToUserId, 10)
                    : null;
                if (manualId && !Number.isNaN(manualId)) {
                    const eligible = await fetchOrderedMemberIds(client, team_id);
                    if (!eligible.includes(manualId)) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            success: false,
                            message: `Selected assignee is not an active ${teamLabel} team member`,
                        });
                    }
                    assignedUserId = manualId;
                }
            }

            // Part 5.3 — the write goes through the one stage mover, which
            // checks stage_transition_rules. submitQC used to move the ticket
            // itself, consulting nothing.
            try {
                await applyStageMove(client, {
                    ticket: ticketBefore,
                    toStageName: nextStage,
                    conditionHint: failure ? failure.conditionHint : null,
                    assignedUserId,
                    status: isCompleted ? 'completed' : 'in_progress',
                    extraSets: failure ? failure.sets : [],
                    extraParams: failure ? failure.params : [],
                    source: 'qcController.submitQC',
                    actor: req.user,
                    correlationId: req.correlationId || null,
                    reason: failure ? failure.failReason : (qcGate.override ? `QC2 check override: ${qcGate.override}` : null),
                    qcGate: failure ? null : qcGate,
                });
            } catch (moveErr) {
                await client.query('ROLLBACK');
                if (moveErr instanceof StageTransitionRefused) {
                    return res.status(moveErr.status).json({ success: false, message: moveErr.message });
                }
                throw moveErr;
            }

            if (failure && qcStage === 'Dispatch QC') {
                if (dispatchRemove) {
                    const allocRes = await client.query(
                        `SELECT allocation_id FROM sales_order_serials
                          WHERE qc_ticket_id = $1 AND status <> 'removed'
                          ORDER BY allocation_id DESC LIMIT 1`,
                        [id]
                    );
                    if (allocRes.rows.length) {
                        const { applyDispatchQcFailure } = require('../services/dispatchQcCaptureService');
                        const paRes = await client.query(
                            `SELECT production_asset_id FROM production_assets
                              WHERE ticket_id = $1 OR (vendor_serial_id IS NOT NULL AND vendor_serial_id = $2)
                              ORDER BY production_asset_id DESC LIMIT 1`,
                            [id, ticketMeta.vendor_serial_id || null]
                        );
                        await applyDispatchQcFailure(client, {
                            allocationId: allocRes.rows[0].allocation_id,
                            pa: paRes.rows[0] || null,
                            remarks: failure.failReason,
                            actorUserId: userId,
                            actorName: req.user.name,
                            correlationId: req.correlationId || null,
                            moveTicketToDiagnosis: false,
                        });
                    }
                } else {
                    // Same as move-stage's rework route: the order sees the failure.
                    await client.query(
                        `UPDATE sales_order_serials SET qc_status = 'failed', updated_at = NOW()
                          WHERE qc_ticket_id = $1 AND status = 'attached'`,
                        [id]
                    );
                }
            }

            if (failure) {
                // Part 5.4 (R5) — this fires for QC2 now, not only QC1. A QC2
                // failure through this endpoint used to record nothing at all.
                await ttsplAuditService.logTtsplEvent({
                    ttsplId: ticketMeta.ttspl_id,
                    vendorSerialId: ticketMeta.vendor_serial_id,
                    eventType: auditEventType(qcStage),
                    description: failure.highlightedReason,
                    metadata: {
                        reason: failure.failReason,
                        ticket_id: Number(id),
                        stage: qcStage,
                        fail_count: failure.failCount,
                        escalated: failure.escalated,
                    },
                    actorUserId: userId,
                    actorName: req.user.name,
                    db: client
                });
            }

            const ticketAfterQc = await client.query(
                `SELECT ticket_id, status, assigned_user_id, current_stage_id FROM tickets WHERE ticket_id = $1`,
                [id]
            );
            await syncWorkLogForTicketState(client, ticketAfterQc.rows[0]);

            if (result === 'PASS') {
                const workEndNotes = `QC passed - ${qcStage}`;
                await client.query(
                    `INSERT INTO activities (ticket_id, user_id, action, notes) VALUES ($1, $2, 'work_ended', $3)`,
                    [id, userId, `Ended work: ${workEndNotes}`]
                );
            }

            if (isPendingInventory && result === 'PASS') {
                await client.query(
                    `UPDATE tickets SET qc2_passed_at = NOW() WHERE ticket_id = $1`,
                    [id]
                );
                try {
                    const paSvc = require('../services/productionAssetService');
                    let pa = await paSvc.getByTicket(client, Number(id));
                    if (!pa && ticketMeta.vendor_serial_id) {
                        pa = await paSvc.getByVendorSerial(client, ticketMeta.vendor_serial_id);
                    }
                    if (!pa) {
                        pa = await paSvc.createFromGrn(client, {
                            ticketId: Number(id),
                            serialNumber: ticketMeta.serial_number,
                            ttsplId: ticketMeta.ttspl_id,
                            vendorSerialId: ticketMeta.vendor_serial_id,
                            configSource: ticketMeta,
                        });
                    }
                    if (pa?.production_asset_id) {
                        await paSvc.markPendingInventory(client, pa.production_asset_id, userId, {
                            source: 'qc2',
                            inventory_tag,
                        });
                    }
                } catch (paErr) {
                    if (paErr.status === 400) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({ success: false, message: paErr.message });
                    }
                    console.error('QC submit pending inventory mark failed:', paErr.message);
                }
                if (serialNumber || machineNumber) {
                    await client.query(
                        `UPDATE inventory SET stage = $1 WHERE serial_number = $2 OR machine_number = $3`,
                        [nextStage, serialNumber, machineNumber]
                    );
                }
            } else if (isCompleted && result === 'PASS' && ticketMeta.ticket_type === 'sales_order_qc') {
                // Pre-dispatch "Dispatch QC" pass on a Sales Order laptop must mirror the
                // stage-move path: mark the SO allocation / DC QC / vendor serial as passed
                // and keep the unit RESERVED for its order (not generic ready stock),
                // otherwise the laptop stays "pending" and keeps showing in the queue / blocks DC.
                await client.query(
                    `UPDATE dc_qc_tickets SET status = 'qc_passed', updated_at = NOW()
                      WHERE ticket_id = $1`,
                    [id]
                );
                await client.query(
                    `UPDATE delivery_challan_lines
                        SET pre_dispatch_qc_passed = TRUE, updated_at = NOW()
                      WHERE pre_dispatch_qc_ticket_id = $1`,
                    [id]
                );
                await client.query(
                    `UPDATE sales_order_serials SET qc_status = 'passed', updated_at = NOW()
                      WHERE qc_ticket_id = $1 AND status = 'attached'`,
                    [id]
                );
                if (ticketMeta.vendor_serial_id) {
                    // Part 2.2 / D7: this was byte-for-byte the same SQL as
                    // ticketPhase2Controller, so which screen the technician
                    // used decided whether the change was audited. One routine
                    // now, shared by both.
                    await reserveOnQcPass(client, ticketMeta.vendor_serial_id, {
                        actorUserId: userId || null,
                        actorName: req.user?.name || null,
                        correlationId: req.correlationId,
                        caller: 'qcController.submitQC',
                    });
                    await vacateWarehouseLocation(client, ticketMeta.vendor_serial_id);
                }
                if (ticketMeta.sales_order_number) {
                    const dispatchWf = require('../services/dispatchWorkflowService');
                    await dispatchWf.onQcPassed(client, {
                        salesOrderNumber: ticketMeta.sales_order_number,
                        user: { user_id: userId, name: req.user?.name, role: req.user?.role },
                    });
                }
            } else if (isCompleted && result === 'PASS') {
                if (serialNumber || machineNumber) {
                    await client.query(
                        `UPDATE inventory 
                         SET status = 'In Stock', stock_type = 'Ready', stage = 'Inventory'
                         WHERE serial_number = $1 OR machine_number = $2`,
                        [serialNumber, machineNumber]
                    );
                }
                if (ticketMeta.vendor_serial_id) {
                    const fullTicket = await client.query(
                        `SELECT * FROM tickets WHERE ticket_id = $1`,
                        [id]
                    );
                    await markVendorSerialReadyForRent(
                        client,
                        fullTicket.rows[0] || ticketMeta,
                        userId
                    );
                }
            } else if (serialNumber || machineNumber) {
                await client.query(
                    `UPDATE inventory SET stage = $1 WHERE serial_number = $2 OR machine_number = $3`,
                    [nextStage, serialNumber, machineNumber]
                );
            }

            const checklistItems = buildChecklistSummary(checklist);
            const checklistNote = checklistItems.length > 0 ? ` | Checklist: ${checklistItems.join(', ')}` : '';

            // Log activity
            let assigneeNote = '';
            if (result === 'PASS' && qcStage === 'QC1' && assignedUserId) {
                const assigneeRes = await client.query(
                    'SELECT name FROM users WHERE user_id = $1',
                    [assignedUserId]
                );
                const assigneeName = assigneeRes.rows[0]?.name || `User #${assignedUserId}`;
                assigneeNote = ` Assigned to ${assigneeName} for QC2.`;
            }

            await client.query(
                `INSERT INTO activities (ticket_id, stage_id, user_id, action, notes)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    id, stage_id, userId, `qc_${qcStage.toLowerCase()}_submitted`,
                    `${qcStage} completed. Result: ${result}. Grade: ${grading.final_grade}. Next: ${nextStage}${assigneeNote}${checklistNote}`
                ]
            );

            const ticketAfterRes = await client.query('SELECT * FROM tickets WHERE ticket_id = $1', [id]);
            await logProductionHistory(client, {
                ticketBefore,
                ticketAfter: ticketAfterRes.rows[0] || ticketBefore,
                beforeStageName,
                afterStageName: nextStage,
                source: 'submitQC',
                remarks: remarks || null,
                failureReason: result === 'FAIL' ? (remarks?.trim() || reasons?.join('; ') || null) : null,
                actor: req.user,
                metadata: { qc_result: result, qc_stage: qcStage, grade: grading.final_grade },
                assignmentType: result === 'FAIL' ? 'qc_fail_return' : 'qc_pass_handoff',
            });
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `${qcStage} submitted successfully`,
            result,
            nextStage,
            qcId
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Submit QC error:', error);
        const detail = String(error?.message || '');
        const message = detail.includes('value too long')
            ? 'QC header value too long for database column. Please retry — columns were widened for full processor names.'
            : 'Server error';
        res.status(500).json({ success: false, message });
    } finally {
        client.release();
    }
};

// Upload QC photo
exports.uploadPhoto = async (req, res) => {
    const { qc_id } = req.params;

    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    try {
        const photoPath = req.file.path.replace(/\\/g, '/');

        await pool.query(
            `INSERT INTO qc_photos (qc_id, photo_path) VALUES ($1, $2)`,
            [qc_id, photoPath]
        );

        res.json({ success: true, photoPath });

    } catch (error) {
        console.error('Upload photo error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// Get QC history for a ticket
exports.getQCHistory = async (req, res) => {
    const { ticket_id } = req.params;

    try {
        const results = await pool.query(
            `SELECT qr.*, u1.name as tested_by_name, u2.name as checked_by_name
             FROM qc_results qr
             LEFT JOIN users u1 ON qr.tested_by = u1.user_id
             LEFT JOIN users u2 ON qr.checked_by = u2.user_id
             WHERE qr.ticket_id = $1
             ORDER BY qr.qc_stage, qr.submitted_at DESC`,
            [ticket_id]
        );

        res.json({ success: true, history: results.rows });

    } catch (error) {
        console.error('Get QC history error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = exports;
