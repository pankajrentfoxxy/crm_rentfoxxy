-- ============================================================
-- Migration 199: Support revamp — issue catalogue, resolution
--   codes, root causes, action codes.
--   Number is 199 (not 194) because 192–198 already exist.
-- Idempotent: safe to re-run.
-- Catalogue reconstructed from PHASE_01 + PHASE_02/04/06 codes
-- because SUPPORT_REVAMP_PLAN.md §5.3 was not in the repo.
-- 7 types, 41 subtypes, full level-3 set + inactive *-UNS rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_issue_catalog (
  catalog_id         SERIAL PRIMARY KEY,
  parent_id          INT REFERENCES support_issue_catalog(catalog_id),
  level              SMALLINT NOT NULL CHECK (level IN (1,2,3)),
  code               VARCHAR(24) NOT NULL UNIQUE,
  name               VARCHAR(120) NOT NULL,
  applies_to_class   VARCHAR(10) NOT NULL DEFAULT 'BOTH'
                       CHECK (applies_to_class IN ('INCIDENT','REQUEST','BOTH')),
  default_impact     SMALLINT CHECK (default_impact IN (1,2,3)),
  default_urgency    SMALLINT CHECK (default_urgency IN (1,2,3)),
  default_wo_type    VARCHAR(30)
                       CHECK (default_wo_type IS NULL OR default_wo_type IN
                         ('FIELD_VISIT','REPAIR_PICKUP','RETURN_PICKUP','SERVICE_RETURN',
                          'REPLACEMENT_DELIVERY','PART_DELIVERY','PART_RETURN','REMOTE_FIX')),
  is_safety          BOOLEAN NOT NULL DEFAULT FALSE,
  requires_photo     BOOLEAN NOT NULL DEFAULT FALSE,
  chargeable_default BOOLEAN NOT NULL DEFAULT FALSE,
  skill_required     VARCHAR(30),
  kb_article_id      INT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_issue_catalog_parent ON support_issue_catalog(parent_id);
CREATE INDEX IF NOT EXISTS idx_issue_catalog_level  ON support_issue_catalog(level) WHERE active;

CREATE TABLE IF NOT EXISTS support_resolution_codes (
  code_id     SERIAL PRIMARY KEY,
  code        VARCHAR(24) NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  group_name  VARCHAR(40),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_root_causes (
  cause_id           SERIAL PRIMARY KEY,
  code               VARCHAR(24) NOT NULL UNIQUE,
  name               VARCHAR(120) NOT NULL,
  default_liability  VARCHAR(30)
                       CHECK (default_liability IS NULL OR default_liability IN
                         ('COMPANY','CUSTOMER_CHARGEABLE','VENDOR_WARRANTY','INSURANCE','NONE')),
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_action_codes (
  action_id   SERIAL PRIMARY KEY,
  code        VARCHAR(24) NOT NULL UNIQUE,
  name        VARCHAR(120) NOT NULL,
  group_name  VARCHAR(40) NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Level 1: 7 types ────────────────────────────────────────
INSERT INTO support_issue_catalog (level, code, name, applies_to_class, sort_order) VALUES
  (1,'HW','Hardware','INCIDENT',10),
  (1,'SW','Software / OS','INCIDENT',20),
  (1,'PER','Peripherals & Accessories','INCIDENT',30),
  (1,'NET','Network & Connectivity','INCIDENT',40),
  (1,'LOG','Logistics / Asset Movement','REQUEST',50),
  (1,'COM','Commercial / Billing','REQUEST',60),
  (1,'SVC','Service Quality / Other','BOTH',70)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, applies_to_class = EXCLUDED.applies_to_class, sort_order = EXCLUDED.sort_order,
      updated_at = NOW();

-- ── Level 2: 41 subtypes ────────────────────────────────────
INSERT INTO support_issue_catalog (parent_id, level, code, name, applies_to_class,
                                   default_impact, default_urgency, default_wo_type, skill_required, sort_order)
SELECT p.catalog_id, 2, v.code, v.name, v.cls, v.imp, v.urg, v.wo, v.skill, v.so
FROM (VALUES
  -- Hardware (12)
  ('HW','HW-DIS','Display',                    'INCIDENT',2,2,'FIELD_VISIT','HARDWARE_BASIC',10),
  ('HW','HW-KBD','Keyboard & Trackpad',        'INCIDENT',2,2,'FIELD_VISIT','HARDWARE_BASIC',20),
  ('HW','HW-BAT','Battery & Charging',         'INCIDENT',2,1,'PART_DELIVERY','HARDWARE_BASIC',30),
  ('HW','HW-STO','Storage',                    'INCIDENT',2,2,'FIELD_VISIT','HARDWARE_BASIC',40),
  ('HW','HW-MEM','Memory (RAM)',               'INCIDENT',2,2,'PART_DELIVERY','HARDWARE_BASIC',50),
  ('HW','HW-MBD','Motherboard / Chip level',   'INCIDENT',1,1,'REPAIR_PICKUP','CHIP_LEVEL',60),
  ('HW','HW-THM','Thermal',                    'INCIDENT',2,2,'REPAIR_PICKUP','HARDWARE_BASIC',70),
  ('HW','HW-BDY','Body & Physical',            'INCIDENT',3,3,'REPAIR_PICKUP','HARDWARE_BASIC',80),
  ('HW','HW-AUD','Audio',                      'INCIDENT',3,3,'FIELD_VISIT','HARDWARE_BASIC',90),
  ('HW','HW-PRT','Ports & Connectivity',       'INCIDENT',3,2,'FIELD_VISIT','HARDWARE_BASIC',100),
  ('HW','HW-CAM','Camera',                     'INCIDENT',3,3,'FIELD_VISIT','HARDWARE_BASIC',110),
  ('HW','HW-BOO','Boot / POST',                'INCIDENT',1,1,'REPAIR_PICKUP','HARDWARE_BASIC',120),
  -- Software (6)
  ('SW','SW-OS','Operating system',            'INCIDENT',2,2,'REMOTE_FIX','SOFTWARE_L1',10),
  ('SW','SW-APP','Applications',               'INCIDENT',3,2,'REMOTE_FIX','SOFTWARE_L1',20),
  ('SW','SW-SEC','Security / Antivirus',       'INCIDENT',1,1,'REMOTE_FIX','SOFTWARE_L2',30),
  ('SW','SW-UPD','Updates / Patching',         'INCIDENT',3,3,'REMOTE_FIX','SOFTWARE_L1',40),
  ('SW','SW-ACC','Accounts & Login',           'INCIDENT',2,2,'REMOTE_FIX','SOFTWARE_L1',50),
  ('SW','SW-DRV','Drivers',                    'INCIDENT',3,2,'REMOTE_FIX','SOFTWARE_L1',60),
  -- Peripherals (6)
  ('PER','PER-ADP','Adapter / Charger',        'INCIDENT',2,1,'PART_DELIVERY','HARDWARE_BASIC',10),
  ('PER','PER-MOU','Mouse',                    'INCIDENT',3,3,'PART_DELIVERY','HARDWARE_BASIC',20),
  ('PER','PER-BAG','Bag / Sleeve',             'INCIDENT',3,3,'PART_DELIVERY','HARDWARE_BASIC',30),
  ('PER','PER-DOC','Docking',                  'INCIDENT',3,2,'FIELD_VISIT','HARDWARE_BASIC',40),
  ('PER','PER-HDS','Headset',                  'INCIDENT',3,3,'PART_DELIVERY','HARDWARE_BASIC',50),
  ('PER','PER-MON','External monitor',         'INCIDENT',3,2,'FIELD_VISIT','HARDWARE_BASIC',60),
  -- Network (4)
  ('NET','NET-WIF','Wi-Fi',                    'INCIDENT',2,2,'REMOTE_FIX','NETWORK',10),
  ('NET','NET-VPN','VPN',                      'INCIDENT',2,2,'REMOTE_FIX','NETWORK',20),
  ('NET','NET-LAN','LAN / Ethernet',           'INCIDENT',2,2,'FIELD_VISIT','NETWORK',30),
  ('NET','NET-BLT','Bluetooth',                'INCIDENT',3,3,'REMOTE_FIX','SOFTWARE_L1',40),
  -- Logistics (5)
  ('LOG','LOG-RET','Return / Pickup',          'REQUEST',2,2,'RETURN_PICKUP','FIELD_SWAP',10),
  ('LOG','LOG-DEL','Delivery',                 'REQUEST',2,2,'REPLACEMENT_DELIVERY','FIELD_SWAP',20),
  ('LOG','LOG-REP','Replacement',              'REQUEST',2,1,'REPLACEMENT_DELIVERY','FIELD_SWAP',30),
  ('LOG','LOG-BUF','Buffer stock',             'REQUEST',3,2,'PART_DELIVERY','FIELD_SWAP',40),
  ('LOG','LOG-LOS','Lost / Missing asset',     'REQUEST',2,1,'RETURN_PICKUP','FIELD_SWAP',50),
  -- Commercial (4)
  ('COM','COM-INV','Invoice / Billing',        'REQUEST',3,3,NULL,NULL,10),
  ('COM','COM-CNT','Contract',                 'REQUEST',3,3,NULL,NULL,20),
  ('COM','COM-PAY','Payment',                  'REQUEST',3,2,NULL,NULL,30),
  ('COM','COM-DEP','Security deposit',         'REQUEST',3,3,NULL,NULL,40),
  -- Service quality (4)
  ('SVC','SVC-SLA','SLA complaint',            'BOTH',1,1,NULL,NULL,10),
  ('SVC','SVC-TEC','Technician conduct',       'BOTH',2,2,NULL,NULL,20),
  ('SVC','SVC-COM','Communication',            'BOTH',3,3,NULL,NULL,30),
  ('SVC','SVC-OTH','Other',                    'BOTH',3,3,NULL,NULL,40)
) AS v(parent_code, code, name, cls, imp, urg, wo, skill, so)
JOIN support_issue_catalog p ON p.code = v.parent_code AND p.level = 1
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, applies_to_class = EXCLUDED.applies_to_class,
  default_impact = EXCLUDED.default_impact, default_urgency = EXCLUDED.default_urgency,
  default_wo_type = EXCLUDED.default_wo_type, skill_required = EXCLUDED.skill_required,
  sort_order = EXCLUDED.sort_order, updated_at = NOW();

-- ── Level 3 issues ──────────────────────────────────────────
-- Columns: parent_code, code, name, imp, urg, wo, safety, photo, chargeable, skill, so
INSERT INTO support_issue_catalog (
  parent_id, level, code, name, applies_to_class,
  default_impact, default_urgency, default_wo_type,
  is_safety, requires_photo, chargeable_default, skill_required, sort_order, active
)
SELECT p.catalog_id, 3, v.code, v.name, p.applies_to_class,
       v.imp, v.urg, COALESCE(v.wo, p.default_wo_type),
       v.safety, v.photo, v.chg, COALESCE(v.skill, p.skill_required), v.so, TRUE
FROM (VALUES
  -- Display
  ('HW-DIS','HW-DIS-CRK','Cracked panel',              2,2,'REPAIR_PICKUP', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',10),
  ('HW-DIS','HW-DIS-FLT','Flickering',                 2,2,'FIELD_VISIT',   FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',20),
  ('HW-DIS','HW-DIS-DIM','Dim / backlight',            2,2,'FIELD_VISIT',   FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',30),
  ('HW-DIS','HW-DIS-LIN','Lines / artefacts',          2,2,'REPAIR_PICKUP', FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',40),
  ('HW-DIS','HW-DIS-DED','Dead pixels',                3,3,'FIELD_VISIT',   FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',50),
  ('HW-DIS','HW-DIS-TCH','Touch not working',          2,2,'FIELD_VISIT',   FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',60),
  ('HW-DIS','HW-DIS-BEZ','Screen bezel damaged',       3,3,'REPAIR_PICKUP', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',70),
  -- Keyboard
  ('HW-KBD','HW-KBD-KEY','Keys not working',           2,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-KBD','HW-KBD-STK','Sticky keys',                3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-KBD','HW-KBD-LSP','Liquid spill on keyboard',   2,1,'REPAIR_PICKUP', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',30),
  ('HW-KBD','HW-KBD-TPD','Trackpad not working',       2,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',40),
  ('HW-KBD','HW-KBD-TBT','Trackpad buttons',           3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',50),
  -- Battery
  ('HW-BAT','HW-BAT-SWL','Battery swollen',            1,1,'PART_DELIVERY', TRUE,  TRUE,  FALSE, 'HARDWARE_BASIC',10),
  ('HW-BAT','HW-BAT-NCH','Not charging',               2,1,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-BAT','HW-BAT-SHT','Short runtime',              2,2,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  ('HW-BAT','HW-BAT-ADT','Adapter not detected',       2,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',40),
  ('HW-BAT','HW-BAT-SRG','Power surge',                2,1,'REPAIR_PICKUP', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',50),
  -- Storage
  ('HW-STO','HW-STO-FAL','Drive failure',              1,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-STO','HW-STO-SLD','Slow disk',                  2,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-STO','HW-STO-NOT','Not detected',               2,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  ('HW-STO','HW-STO-BIT','BitLocker / encryption lock',2,1,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L2',40),
  -- Memory
  ('HW-MEM','HW-MEM-FAL','RAM failure',                2,1,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-MEM','HW-MEM-BSO','Blue screen / memory',       2,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-MEM','HW-MEM-NOT','Not detected',               2,2,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  -- Motherboard
  ('HW-MBD','HW-MBD-NOP','Does not power on',          1,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'CHIP_LEVEL',10),
  ('HW-MBD','HW-MBD-NBO','No boot / no POST',          1,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'CHIP_LEVEL',20),
  ('HW-MBD','HW-MBD-BRD','Board damage',               1,1,'REPAIR_PICKUP', FALSE, TRUE,  FALSE, 'CHIP_LEVEL',30),
  ('HW-MBD','HW-MBD-LIQ','Liquid damage',              1,1,'REPAIR_PICKUP', TRUE,  TRUE,  FALSE, 'CHIP_LEVEL',40),
  ('HW-MBD','HW-MBD-BRN','Burning smell',              1,1,'REPAIR_PICKUP', TRUE,  TRUE,  FALSE, 'CHIP_LEVEL',50),
  ('HW-MBD','HW-MBD-CHP','Chip-level fault',           1,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'CHIP_LEVEL',60),
  -- Thermal
  ('HW-THM','HW-THM-FAN','Fan noise / failure',        2,2,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-THM','HW-THM-OVR','Overheating',                2,2,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-THM','HW-THM-THR','Thermal shutdown',           2,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  -- Body (all photos)
  ('HW-BDY','HW-BDY-CRK','Body crack',                 3,3,'REPAIR_PICKUP', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',10),
  ('HW-BDY','HW-BDY-HNG','Hinge broken',               2,2,'REPAIR_PICKUP', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',20),
  ('HW-BDY','HW-BDY-DNT','Dent / bend',                3,3,'REPAIR_PICKUP', FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',30),
  ('HW-BDY','HW-BDY-SCR','Scratches',                  3,3,'REPAIR_PICKUP', FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',40),
  ('HW-BDY','HW-BDY-LID','Lid damage',                 3,3,'REPAIR_PICKUP', FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',50),
  -- Audio
  ('HW-AUD','HW-AUD-NSO','No sound',                   3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-AUD','HW-AUD-MIC','Mic not working',            3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-AUD','HW-AUD-DST','Distorted audio',            3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  -- Ports
  ('HW-PRT','HW-PRT-USB','USB port dead',              3,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-PRT','HW-PRT-HDM','HDMI / display out',         3,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-PRT','HW-PRT-CHG','Charging port',              2,2,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  ('HW-PRT','HW-PRT-SDT','SD / other port',            3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',40),
  -- Camera
  ('HW-CAM','HW-CAM-NWK','Camera not working',         3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-CAM','HW-CAM-BLK','Black image',                3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-CAM','HW-CAM-PRV','Privacy shutter stuck',      3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  -- Boot
  ('HW-BOO','HW-BOO-NOP','Does not power on',          1,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('HW-BOO','HW-BOO-POS','POST / beep codes',          1,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('HW-BOO','HW-BOO-LOP','Boot loop',                  1,1,'REPAIR_PICKUP', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',30),
  -- Software
  ('SW-OS','SW-OS-WIN','Windows not starting',         2,1,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',10),
  ('SW-OS','SW-OS-SLO','Slow / freeze',                2,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',20),
  ('SW-OS','SW-OS-UPD','Update failed',                3,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',30),
  ('SW-OS','SW-OS-ACT','Activation',                   3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',40),
  ('SW-APP','SW-APP-CRS','App crash',                  3,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',10),
  ('SW-APP','SW-APP-MIS','App missing',                3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',20),
  ('SW-APP','SW-APP-LIC','License',                    3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',30),
  ('SW-SEC','SW-SEC-RSW','Ransomware',                 1,1,'REMOTE_FIX',    TRUE,  FALSE, FALSE, 'SOFTWARE_L2',10),
  ('SW-SEC','SW-SEC-MAL','Malware',                    1,1,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L2',20),
  ('SW-SEC','SW-SEC-AV','Antivirus',                   2,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',30),
  ('SW-UPD','SW-UPD-FAL','Patch failed',               3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',10),
  ('SW-UPD','SW-UPD-PND','Pending reboot',             3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',20),
  ('SW-ACC','SW-ACC-LGN','Cannot login',               2,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',10),
  ('SW-ACC','SW-ACC-PWD','Password reset',             2,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',20),
  ('SW-ACC','SW-ACC-MFA','MFA / lockout',              2,1,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L2',30),
  ('SW-DRV','SW-DRV-MIS','Missing driver',             3,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',10),
  ('SW-DRV','SW-DRV-DSP','Display driver',             3,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',20),
  ('SW-DRV','SW-DRV-NET','Network driver',             3,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',30),
  -- Peripherals
  ('PER-ADP','PER-ADP-DED','Adapter dead',             2,1,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('PER-ADP','PER-ADP-FRY','Cable frayed',             1,1,'PART_DELIVERY', TRUE,  TRUE,  FALSE, 'HARDWARE_BASIC',20),
  ('PER-ADP','PER-ADP-LST','Lost by customer',         3,2,'PART_DELIVERY', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',30),
  ('PER-ADP','PER-ADP-WRG','Wrong wattage',            3,3,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',40),
  ('PER-MOU','PER-MOU-DED','Mouse not working',        3,3,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('PER-MOU','PER-MOU-LST','Lost by customer',         3,3,'PART_DELIVERY', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',20),
  ('PER-BAG','PER-BAG-TOR','Torn / damaged',           3,3,'PART_DELIVERY', FALSE, TRUE,  FALSE, 'HARDWARE_BASIC',10),
  ('PER-BAG','PER-BAG-LST','Lost by customer',         3,3,'PART_DELIVERY', FALSE, TRUE,  TRUE,  'HARDWARE_BASIC',20),
  ('PER-DOC','PER-DOC-NWK','Dock not working',         3,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('PER-DOC','PER-DOC-VID','No video out',             3,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('PER-HDS','PER-HDS-NWK','Headset not working',      3,3,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('PER-HDS','PER-HDS-MIC','Mic issue',                3,3,'PART_DELIVERY', FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  ('PER-MON','PER-MON-NWK','Monitor not working',      3,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',10),
  ('PER-MON','PER-MON-FLK','Flicker',                  3,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'HARDWARE_BASIC',20),
  -- Network
  ('NET-WIF','NET-WIF-NCN','Cannot connect',           2,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'NETWORK',10),
  ('NET-WIF','NET-WIF-DRP','Dropping',                 2,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'NETWORK',20),
  ('NET-WIF','NET-WIF-SLO','Slow',                     3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'NETWORK',30),
  ('NET-VPN','NET-VPN-NCN','Cannot connect',           2,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'NETWORK',10),
  ('NET-VPN','NET-VPN-AUT','Auth failed',              2,2,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L2',20),
  ('NET-LAN','NET-LAN-NCN','No link',                  2,2,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'NETWORK',10),
  ('NET-LAN','NET-LAN-SLO','Slow',                     3,3,'FIELD_VISIT',   FALSE, FALSE, FALSE, 'NETWORK',20),
  ('NET-BLT','NET-BLT-NCN','Not pairing',              3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',10),
  ('NET-BLT','NET-BLT-AUD','Audio stutter',            3,3,'REMOTE_FIX',    FALSE, FALSE, FALSE, 'SOFTWARE_L1',20),
  -- Logistics
  ('LOG-RET','LOG-RET-EOC','End of contract return',   2,2,'RETURN_PICKUP', FALSE, FALSE, FALSE, 'FIELD_SWAP',10),
  ('LOG-RET','LOG-RET-REQ','Customer requested return',2,2,'RETURN_PICKUP', FALSE, FALSE, FALSE, 'FIELD_SWAP',20),
  ('LOG-DEL','LOG-DEL-DLY','Delayed delivery',         2,2,'REPLACEMENT_DELIVERY', FALSE, FALSE, FALSE, 'FIELD_SWAP',10),
  ('LOG-DEL','LOG-DEL-WRG','Wrong unit delivered',     2,1,'REPLACEMENT_DELIVERY', FALSE, FALSE, FALSE, 'FIELD_SWAP',20),
  ('LOG-DEL','LOG-DEL-DTR','Damaged in transit',       1,1,'RETURN_PICKUP', TRUE,  TRUE,  FALSE, 'FIELD_SWAP',30),
  ('LOG-REP','LOG-REP-REQ','Replacement requested',    2,1,'REPLACEMENT_DELIVERY', FALSE, FALSE, FALSE, 'FIELD_SWAP',10),
  ('LOG-REP','LOG-REP-WNG','Wrong replacement',        2,1,'REPLACEMENT_DELIVERY', FALSE, FALSE, FALSE, 'FIELD_SWAP',20),
  ('LOG-BUF','LOG-BUF-SHT','Buffer short',             3,2,'PART_DELIVERY', FALSE, FALSE, FALSE, 'FIELD_SWAP',10),
  ('LOG-BUF','LOG-BUF-REQ','Buffer requested',         3,3,'PART_DELIVERY', FALSE, FALSE, FALSE, 'FIELD_SWAP',20),
  ('LOG-LOS','LOG-LOS-MIS','Asset missing',            2,1,'RETURN_PICKUP', FALSE, FALSE, FALSE, 'FIELD_SWAP',10),
  ('LOG-LOS','LOG-LOS-LST','Lost by customer',         2,1,'RETURN_PICKUP', FALSE, TRUE,  TRUE,  'FIELD_SWAP',20),
  -- Commercial
  ('COM-INV','COM-INV-WRG','Wrong invoice',            3,3,NULL,            FALSE, FALSE, FALSE, NULL,10),
  ('COM-INV','COM-INV-MIS','Missing invoice',          3,3,NULL,            FALSE, FALSE, FALSE, NULL,20),
  ('COM-CNT','COM-CNT-REN','Renewal',                  3,3,NULL,            FALSE, FALSE, FALSE, NULL,10),
  ('COM-CNT','COM-CNT-TRM','Terms query',              3,3,NULL,            FALSE, FALSE, FALSE, NULL,20),
  ('COM-PAY','COM-PAY-DUE','Overdue',                  3,2,NULL,            FALSE, FALSE, FALSE, NULL,10),
  ('COM-PAY','COM-PAY-REC','Receipt',                  3,3,NULL,            FALSE, FALSE, FALSE, NULL,20),
  ('COM-DEP','COM-DEP-REF','Refund',                   3,3,NULL,            FALSE, FALSE, FALSE, NULL,10),
  ('COM-DEP','COM-DEP-HLD','Hold',                     3,3,NULL,            FALSE, FALSE, FALSE, NULL,20),
  -- Service
  ('SVC-SLA','SVC-SLA-BRH','SLA breach complaint',     1,1,NULL,            FALSE, FALSE, FALSE, NULL,10),
  ('SVC-TEC','SVC-TEC-CND','Conduct',                  2,2,NULL,            FALSE, FALSE, FALSE, NULL,10),
  ('SVC-TEC','SVC-TEC-LAT','Late arrival',             2,2,NULL,            FALSE, FALSE, FALSE, NULL,20),
  ('SVC-COM','SVC-COM-NUP','No update',                3,3,NULL,            FALSE, FALSE, FALSE, NULL,10),
  ('SVC-COM','SVC-COM-WRG','Wrong info',               3,3,NULL,            FALSE, FALSE, FALSE, NULL,20),
  ('SVC-OTH','SVC-OTH-GEN','General',                  3,3,NULL,            FALSE, FALSE, FALSE, NULL,10)
) AS v(parent_code, code, name, imp, urg, wo, safety, photo, chg, skill, so)
JOIN support_issue_catalog p ON p.code = v.parent_code AND p.level = 2
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, default_impact = EXCLUDED.default_impact,
  default_urgency = EXCLUDED.default_urgency, default_wo_type = EXCLUDED.default_wo_type,
  is_safety = EXCLUDED.is_safety, requires_photo = EXCLUDED.requires_photo,
  chargeable_default = EXCLUDED.chargeable_default, skill_required = EXCLUDED.skill_required,
  sort_order = EXCLUDED.sort_order, active = TRUE, updated_at = NOW();

-- Force photo on every HW-DIS / HW-BDY issue (including any added later in this file)
UPDATE support_issue_catalog c
   SET requires_photo = TRUE, updated_at = NOW()
  FROM support_issue_catalog p
 WHERE c.parent_id = p.catalog_id AND c.level = 3
   AND p.code IN ('HW-DIS','HW-BDY');

UPDATE support_issue_catalog
   SET requires_photo = TRUE, updated_at = NOW()
 WHERE level = 3 AND chargeable_default = TRUE;

-- Inactive Unspecified placeholder under every subtype (Phase 2 backfill)
INSERT INTO support_issue_catalog (
  parent_id, level, code, name, applies_to_class,
  default_impact, default_urgency, default_wo_type, skill_required, sort_order, active
)
SELECT p.catalog_id, 3, p.code || '-UNS', 'Unspecified', p.applies_to_class,
       p.default_impact, p.default_urgency, p.default_wo_type, p.skill_required, 999, FALSE
  FROM support_issue_catalog p
 WHERE p.level = 2
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, active = FALSE, sort_order = 999, updated_at = NOW();

-- ── Resolution codes (PLAN §6.1 — operational set) ──────────
INSERT INTO support_resolution_codes (code, name, group_name, sort_order) VALUES
  ('RES-FOS','Fixed on site','Outcome',10),
  ('RES-RPR','Repaired in workshop','Outcome',20),
  ('RES-SWP','Swapped unit','Outcome',30),
  ('RES-PRT','Part replaced','Outcome',40),
  ('RES-RMT','Fixed remotely','Outcome',50),
  ('RES-KNW','Known workaround','Outcome',60),
  ('RES-NFF','No fault found','Outcome',70),
  ('RES-DUP','Duplicate','Outcome',80),
  ('RES-WAD','Withdrawn / cancelled','Outcome',90),
  ('RES-INF','Information provided','Outcome',100),
  ('RES-RET','Asset returned','Outcome',110),
  ('RES-REP','Replacement delivered','Outcome',120)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, group_name = EXCLUDED.group_name, sort_order = EXCLUDED.sort_order;

-- ── Root causes (PLAN §6.3) ─────────────────────────────────
INSERT INTO support_root_causes (code, name, default_liability, sort_order) VALUES
  ('RC-HWF','Hardware failure','COMPANY',10),
  ('RC-MFD','Manufacturing defect','VENDOR_WARRANTY',20),
  ('RC-WNE','Wear and tear','COMPANY',30),
  ('RC-USR','Physical damage by user','CUSTOMER_CHARGEABLE',40),
  ('RC-LIQ','Liquid damage','CUSTOMER_CHARGEABLE',50),
  ('RC-PWR','Power surge','INSURANCE',60),
  ('RC-SWC','Software corruption','COMPANY',70),
  ('RC-CFG','User configuration','NONE',80),
  ('RC-NET','Customer network','NONE',90),
  ('RC-3PL','Transit damage','INSURANCE',100),
  ('RC-PRC','Process / handling error','COMPANY',110),
  ('RC-UNK','Unknown','NONE',120)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, default_liability = EXCLUDED.default_liability, sort_order = EXCLUDED.sort_order;

-- ── Action codes (PLAN §6.2) ────────────────────────────────
INSERT INTO support_action_codes (code, name, group_name, sort_order) VALUES
  ('ACT-VIS','Visual inspection','Diagnostics',10),
  ('ACT-POST','POST test','Diagnostics',20),
  ('ACT-MEM','Memory test','Diagnostics',30),
  ('ACT-DSK','Disk test','Diagnostics',40),
  ('ACT-THM','Thermal check','Diagnostics',50),
  ('ACT-PRT','Part replaced','Repair',60),
  ('ACT-CLN','Cleaning','Repair',70),
  ('ACT-RWR','Rework / solder','Repair',80),
  ('ACT-FAN','Fan service','Repair',90),
  ('ACT-REI','OS reimage','Software',100),
  ('ACT-UPD','Updates applied','Software',110),
  ('ACT-DRV','Drivers installed','Software',120),
  ('ACT-MAL','Malware removal','Software',130),
  ('ACT-PKP','Pickup','Logistics',140),
  ('ACT-DLV','Delivery','Logistics',150),
  ('ACT-SWP','Swap','Logistics',160),
  ('ACT-FOS','Fixed on site','Outcome',170),
  ('ACT-NFF','No fault found','Outcome',180),
  ('ACT-ESC','Escalated','Outcome',190),
  ('ACT-RPL','Replaced','Outcome',200)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, group_name = EXCLUDED.group_name, sort_order = EXCLUDED.sort_order;
