'use strict';

const pool = require('../config/db');
const {
  getAllSettings,
  setMany,
  grouped,
} = require('../services/supportSettingsService');

exports.getSettings = async (req, res) => {
  try {
    const all = await getAllSettings(pool);
    const templates = await pool.query(
      `SELECT template_id, event_code, channel, audience, subject, body, active
         FROM support_notification_templates
        ORDER BY event_code, channel`
    );
    const rules = await pool.query(
      `SELECT rule_id, approval_type, min_amount, approver_role, blocks, active
         FROM support_approval_rules
        ORDER BY approval_type, min_amount`
    );
    res.json({
      success: true,
      settings: all,
      groups: grouped(all),
      templates: templates.rows,
      approval_rules: rules.rows,
    });
  } catch (e) {
    console.error('getSettings:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.patchSettings = async (req, res) => {
  try {
    const patch = req.body && req.body.settings ? req.body.settings : req.body;
    const all = await setMany(pool, patch || {}, req.user && req.user.user_id);
    if (patch && (patch.parts_lead_threshold != null || patch.parts_manager_threshold != null)) {
      const lead = Number(all.parts_lead_threshold);
      const mgr = Number(all.parts_manager_threshold);
      await pool.query(
        `UPDATE support_approval_rules
            SET min_amount = $1
          WHERE approval_type IN ('PART_VALUE','CHARGEABLE_PART','DAMAGE_CHARGE')
            AND approver_role = 'support_lead'`,
        [0]
      );
      await pool.query(
        `UPDATE support_approval_rules
            SET min_amount = $1
          WHERE approval_type IN ('PART_VALUE','CHARGEABLE_PART','DAMAGE_CHARGE')
            AND approver_role = 'support_manager'`,
        [mgr || lead || 10000]
      );
    }
    res.json({ success: true, settings: all, groups: grouped(all) });
  } catch (e) {
    console.error('patchSettings:', e);
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
};

exports.patchTemplate = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { active, subject, body } = req.body || {};
    const r = await pool.query(
      `UPDATE support_notification_templates
          SET active = COALESCE($2, active),
              subject = COALESCE($3, subject),
              body = COALESCE($4, body)
        WHERE template_id = $1
        RETURNING *`,
      [id, active == null ? null : Boolean(active), subject || null, body || null]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, template: r.rows[0] });
  } catch (e) {
    console.error('patchTemplate:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};
