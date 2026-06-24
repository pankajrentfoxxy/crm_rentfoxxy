/**
 * erp_id_map — central ID remapping for idempotent migrations.
 */
async function ensureIdMapTable(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS erp_id_map (
      entity        VARCHAR(64)  NOT NULL,
      erp_id        BIGINT       NOT NULL,
      crm_id        BIGINT       NOT NULL,
      erp_table     VARCHAR(128),
      crm_table     VARCHAR(128),
      migrated_at   TIMESTAMPTZ  DEFAULT NOW(),
      PRIMARY KEY (entity, erp_id)
    )
  `);
  await crm.query(`
    CREATE INDEX IF NOT EXISTS idx_erp_id_map_crm
      ON erp_id_map (entity, crm_id)
  `);
}

async function getCrmId(crm, entity, erpId) {
  const { rows } = await crm.query(
    'SELECT crm_id FROM erp_id_map WHERE entity = $1 AND erp_id = $2',
    [entity, erpId]
  );
  return rows[0]?.crm_id ?? null;
}

async function setCrmId(crm, { entity, erpId, crmId, erpTable, crmTable }) {
  await crm.query(
    `INSERT INTO erp_id_map (entity, erp_id, crm_id, erp_table, crm_table)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (entity, erp_id) DO UPDATE
       SET crm_id = EXCLUDED.crm_id, migrated_at = NOW()`,
    [entity, erpId, crmId, erpTable || null, crmTable || null]
  );
}

async function mapRequired(crm, entity, erpId) {
  const id = await getCrmId(crm, entity, erpId);
  if (id == null) throw new Error(`Missing erp_id_map: entity=${entity} erp_id=${erpId}`);
  return id;
}

module.exports = { ensureIdMapTable, getCrmId, setCrmId, mapRequired };
