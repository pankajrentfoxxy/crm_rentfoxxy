/**
 * Production — the floor's checklists, in one place.
 *
 * Every stage form on the floor reads its questions from here (served by
 * GET /tickets/floor-checklists), and the server checks submissions against the
 * same definitions, so the screen and the server cannot disagree about what a
 * stage asks or what fails it.
 *
 * Each question says in words which answer is the good one. `tone` drives the
 * colour: 'good' green, 'bad' red (needs a remark, may fail the stage), 'info'
 * neutral (recorded, never a fault), 'na' for hardware the model simply does
 * not have ("Not fitted"), which is never a fault.
 *
 * QC keys and stored values are the ones qc_results.checklist_data has always
 * held (1,800+ records on QA), so old records still read correctly. Only the
 * wording, the colours and the new "Not fitted" / BitLocker answers change.
 */

const Y = (label = 'Yes') => ({ value: 'YES', label, tone: 'good' });
const N = (label = 'No') => ({ value: 'NO', label, tone: 'bad' });
const W = { value: 'WORKING', label: 'Works', tone: 'good' };
const NW = { value: 'NOT WORKING', label: "Doesn't work", tone: 'bad' };
const NA = (label = 'Not fitted') => ({ value: 'NA', label, tone: 'na' });

// ── QC1 / QC2 / Dispatch QC ───────────────────────────────────────────────
const QC_SECTIONS = [
  {
    key: 'body', title: 'Body',
    items: [
      { key: 'body_scratches', q: 'Scratches on the body?', hint: 'Scratches lower the grade; they do not fail QC.',
        options: [{ value: 'NO', label: 'No scratches', tone: 'good' }, { value: 'YES', label: 'Has scratches', tone: 'info' }] },
      { key: 'physical_damage', q: 'Any crack or broken plastic?',
        options: [{ value: 'NO', label: 'None', tone: 'good' }, { value: 'YES', label: 'Cracked / broken', tone: 'bad' }] },
      { key: 'body_screws', q: 'All screws fitted?', options: [Y(), N('Screws missing')] },
      { key: 'body_hinge', q: 'Hinges firm when the lid opens and closes?', options: [Y(), N('Loose / broken')] },
      { key: 'ttspl_id', q: 'TTSPL label stuck on and readable?', options: [Y(), N('Missing')] },
    ],
  },
  {
    key: 'inside', title: 'Inside and heat',
    items: [
      { key: 'motherboard_cleaning', q: 'Inside cleaned and CPU paste renewed?', options: [Y('Done'), N('Not done')] },
      { key: 'heating_test', q: 'Stays cool under load (no overheating)?', options: [Y('Stays cool'), N('Overheats')] },
    ],
  },
  {
    key: 'software', title: 'BIOS, drivers and software',
    items: [
      { key: 'bios_check', q: 'BIOS opens with no password, date and time right?', options: [Y(), N()] },
      { key: 'required_drivers', q: 'Device Manager shows no missing drivers?', options: [Y('None missing'), N('Drivers missing')] },
      { key: 'ms_office', q: 'MS Office installed and activated?',
        options: [{ value: 'INSTALLED', label: 'Installed', tone: 'good' }, { value: 'NOT INSTALLED', label: 'Not installed', tone: 'bad' }] },
      { key: 'chrome', q: 'Chrome installed?',
        options: [{ value: 'INSTALLED', label: 'Installed', tone: 'good' }, { value: 'NOT INSTALLED', label: 'Not installed', tone: 'bad' }] },
      { key: 'ultra_viewer', q: 'UltraViewer installed?',
        options: [{ value: 'INSTALLED', label: 'Installed', tone: 'good' }, { value: 'NOT INSTALLED', label: 'Not installed', tone: 'bad' }] },
      { key: 'virtual_memory', q: 'Virtual memory set to match the RAM?', options: [Y(), N()] },
      { key: 'bitlocker_off', q: 'BitLocker turned off?', hint: 'A laptop with BitLocker on locks the customer out.', options: [Y('Off'), N('Still on')], since: '2026-09-26' },
    ],
  },
  {
    key: 'input', title: 'Keyboard and touchpad',
    items: [
      { key: 'keyboard', q: 'Every key types?', options: [W, NW] },
      { key: 'keyboard_light', q: 'Keyboard backlight works?', options: [Y('Works'), N("Doesn't work"), NA('No backlight on this model')] },
      { key: 'touchpad', q: 'Touchpad moves the pointer smoothly?', options: [W, NW] },
      { key: 'left_click', q: 'Left click?', options: [W, NW] },
      { key: 'right_click', q: 'Right click?', options: [W, NW] },
      { key: 'scrolling', q: 'Two-finger scrolling?', options: [W, NW] },
      { key: 'cursor_speed', q: 'Pointer speed set to 80%?', options: [Y(), N()] },
    ],
  },
  {
    key: 'ports', title: 'Ports, network and charger',
    items: [
      { key: 'usb_ports', q: 'Every USB port reads a pen drive?', options: [W, NW] },
      { key: 'vga_hdmi', q: 'HDMI / VGA shows a picture on a monitor?', options: [W, NW, NA('No HDMI / VGA port')] },
      { key: 'lan_port', q: 'LAN port connects?', options: [W, NW, NA('No LAN port')] },
      { key: 'wifi_test', q: 'Wi-Fi connects (2.4 and 5 GHz)?', options: [W, NW] },
      { key: 'bluetooth', q: 'Bluetooth finds a device?', options: [W, NW] },
      { key: 'audio_jack', q: 'Headphone jack plays sound?', options: [Y('Works'), N("Doesn't work"), NA('No jack')] },
      { key: 'power_adapter', q: 'Charger charges the laptop and is the right wattage?', options: [W, NW] },
    ],
  },
  {
    key: 'screen', title: 'Screen, camera and sound',
    items: [
      { key: 'screen_resolution', q: 'Screen at full resolution, no lines, spots or dead pixels?',
        options: [{ value: 'PASS', label: 'Clean', tone: 'good' }, { value: 'FAIL', label: 'Has a fault', tone: 'bad' }] },
      { key: 'refresh_rate', q: 'Refresh rate set to the highest?', options: [Y(), N()] },
      { key: 'touch_screen', q: 'Touch screen responds?', options: [Y('Works'), N("Doesn't work"), NA('Not a touch screen')] },
      { key: 'camera_recording', q: 'Camera records video with sound?', options: [Y('Works'), N("Doesn't work")] },
      { key: 'speaker', q: 'Speakers play clearly?', options: [W, NW] },
    ],
  },
  {
    key: 'health', title: 'Battery and drive health',
    items: [
      { key: 'battery_health', q: 'Battery health (from the battery report)?', hint: 'Good: 80% or more of design capacity. Average: 60–79%. Bad: below 60%.',
        options: [{ value: 'GOOD', label: 'Good', tone: 'good' }, { value: 'AVERAGE', label: 'Average', tone: 'info' }, { value: 'BAD', label: 'Bad', tone: 'bad' }] },
      { key: 'ssd_health', q: 'Drive health (from CrystalDiskInfo)?', hint: 'Good: shows "Good". Average: "Caution". Bad: "Bad".',
        options: [{ value: 'GOOD', label: 'Good', tone: 'good' }, { value: 'AVERAGE', label: 'Average', tone: 'info' }, { value: 'BAD', label: 'Bad', tone: 'bad' }] },
      { key: 'expandability', q: 'Free RAM / drive slot for a later upgrade?',
        options: [{ value: 'YES', label: 'Yes', tone: 'info' }, { value: 'NO', label: 'No', tone: 'info' }] },
    ],
  },
];

// Which answers fail which stage. QC1 is the "does it work" check. QC2 is the
// last look before a customer gets it, so it also refuses what a customer
// would reject. Dispatch QC re-checks a unit that already passed QC2, with the
// QC1 rules. (Same rules as before, plus BitLocker for every stage.)
const QC_BASE_CRITERIA = [
  { key: 'keyboard', values: ['NOT WORKING'], reason: 'Keyboard not working' },
  { key: 'touchpad', values: ['NOT WORKING'], reason: 'Touchpad not working' },
  { key: 'usb_ports', values: ['NOT WORKING'], reason: 'USB ports not working' },
  { key: 'wifi_test', values: ['NOT WORKING'], reason: 'WiFi not working' },
  { key: 'battery_health', values: ['BAD'], reason: 'Battery health BAD' },
  { key: 'ssd_health', values: ['BAD'], reason: 'SSD health BAD' },
  { key: 'screen_resolution', values: ['FAIL'], reason: 'Screen resolution failed' },
  { key: 'bitlocker_off', values: ['NO'], reason: 'BitLocker still on' },
];
const QC2_ADDITIONAL_CRITERIA = [
  { key: 'battery_health', values: ['AVERAGE'], reason: 'QC2: battery health only AVERAGE — not fit to ship' },
  { key: 'ssd_health', values: ['AVERAGE'], reason: 'QC2: SSD health only AVERAGE — not fit to ship' },
  { key: 'physical_damage', values: ['YES'], reason: 'QC2: physical damage / crack present' },
  { key: 'body_hinge', values: ['NO'], reason: 'QC2: body hinge check failed' },
  { key: 'ttspl_id', values: ['NO'], reason: 'QC2: TTSPL asset label missing' },
  { key: 'speaker', values: ['NOT WORKING'], reason: 'QC2: speaker not working' },
  { key: 'camera_recording', values: ['NO'], reason: 'QC2: camera / audio recording failed' },
  { key: 'bluetooth', values: ['NOT WORKING'], reason: 'QC2: Bluetooth not working' },
  { key: 'power_adapter', values: ['NOT WORKING'], reason: 'QC2: power adapter not working' },
  { key: 'required_drivers', values: ['NO'], reason: 'QC2: required drivers missing' },
  { key: 'ms_office', values: ['NOT INSTALLED'], reason: 'QC2: MS Office not installed / activated' },
  { key: 'vga_hdmi', values: ['NOT WORKING'], reason: 'QC2: VGA / HDMI not working' },
  { key: 'lan_port', values: ['NOT WORKING'], reason: 'QC2: LAN port not working' },
  { key: 'left_click', values: ['NOT WORKING'], reason: 'QC2: left click not working' },
  { key: 'right_click', values: ['NOT WORKING'], reason: 'QC2: right click not working' },
];

function qcCriteria(stage) {
  return String(stage) === 'QC2' ? [...QC_BASE_CRITERIA, ...QC2_ADDITIONAL_CRITERIA] : QC_BASE_CRITERIA;
}

function qcResult(checklist, stage) {
  const c = checklist || {};
  const reasons = qcCriteria(stage).filter((r) => r.values.includes(c[r.key])).map((r) => r.reason);
  return { result: reasons.length ? 'FAIL' : 'PASS', reasons };
}

const QC_ITEMS = QC_SECTIONS.flatMap((s) => s.items);
const QC_GRADES = [
  { value: 'A+', label: 'A+', hint: 'Like new, no visible wear' },
  { value: 'A', label: 'A', hint: 'Excellent, minimal signs of use' },
  { value: 'A-', label: 'A-', hint: 'Very good, light cosmetic wear' },
  { value: 'B+', label: 'B+', hint: 'Good, minor scratches' },
  { value: 'B', label: 'B', hint: 'Fair, visible wear, fully working' },
  { value: 'B-', label: 'B-', hint: 'Noticeable wear, minor cosmetic issues' },
  { value: 'C', label: 'C', hint: 'Heavy cosmetic wear, still working' },
  { value: 'D', label: 'D', hint: 'Poor cosmetics, working with limits' },
];

/** Every question answered with one of its own answers. Returns the problems. */
function checkAnswers(items, answers) {
  const a = answers || {};
  const missing = [];
  const invalid = [];
  for (const it of items) {
    const v = a[it.key];
    if (v == null || v === '') missing.push(it.key);
    else if (!it.options.some((o) => o.value === v)) invalid.push(it.key);
  }
  return { missing, invalid };
}

function badAnswers(items, answers) {
  const a = answers || {};
  return items.filter((it) => it.options.some((o) => o.value === a[it.key] && o.tone === 'bad'));
}

// ── Diagnosis ─────────────────────────────────────────────────────────────
// Good / Fault / Not fitted. Keys are the diagnosis_results columns where one
// exists (so they fill in), plus two body questions stored in `answers` only.
// Dropped from the old 42: overlaps ("Power ON" vs the power question, BIOS
// lock asked twice, charging port asked three ways, Wi-Fi detected vs
// connecting, bad sectors vs drive health, left/right click vs touchpad).
const G = { value: 'good', label: 'OK', tone: 'good' };
const F = (label = 'Fault') => ({ value: 'fault', label, tone: 'bad' });
const DNA = (label = 'Not fitted') => ({ value: 'na', label, tone: 'na' });
const DIAGNOSIS_SECTIONS = [
  {
    key: 'power', title: 'Power and start-up', route: 'chip',
    items: [
      { key: 'power_on', q: 'Powers on with the charger connected?', options: [G, F("Won't power on")] },
      { key: 'boots_successfully', q: 'Starts to Windows or the BIOS screen?', options: [G, F("Won't start")] },
      { key: 'bios_unlocked', q: 'BIOS has no password?', options: [G, F('BIOS locked')] },
    ],
  },
  {
    key: 'board', title: 'Motherboard', route: 'chip', hint: 'A fault here means chip-level repair.',
    items: [
      { key: 'no_short', q: 'No short circuit?', options: [G, F('Short')] },
      { key: 'no_rust_liquid', q: 'No rust or liquid damage on the board?', options: [G, F('Rust / liquid')] },
      { key: 'no_ic_heating', q: 'No chip on the board heats up abnormally?', options: [G, F('A chip heats up')] },
    ],
  },
  {
    key: 'screen', title: 'Screen and camera', route: 'parts',
    items: [
      { key: 'display_on', q: 'Screen lights up?', options: [G, F('Blank')] },
      { key: 'no_lines_spots', q: 'No lines, spots or dead pixels?', options: [G, F('Lines / spots')] },
      { key: 'no_flickering', q: 'No flicker?', options: [G, F('Flickers')] },
      { key: 'brightness_control', q: 'Brightness keys change the brightness?', options: [G, F()] },
      { key: 'webcam_working', q: 'Webcam shows a picture?', options: [G, F(), DNA('No webcam')] },
    ],
  },
  {
    key: 'input', title: 'Keyboard and touchpad', route: 'parts',
    items: [
      { key: 'all_keys_working', q: 'Every key types?', options: [G, F('Keys dead')] },
      { key: 'touchpad_working', q: 'Touchpad and both click buttons work?', options: [G, F()] },
    ],
  },
  {
    key: 'battery', title: 'Battery and charging', route: 'parts',
    items: [
      { key: 'battery_detected', q: 'Battery detected?', options: [G, F('Not detected')] },
      { key: 'battery_charging', q: 'Charges when plugged in?', options: [G, F("Doesn't charge")] },
      { key: 'battery_swollen', q: 'Battery flat, not swollen?', options: [G, F('Swollen')] },
      { key: 'charging_port_tight', q: 'Charging port firm, not loose?', options: [G, F('Loose')] },
    ],
  },
  {
    key: 'memory', title: 'RAM and drive', route: 'parts',
    items: [
      { key: 'ram_detected', q: 'RAM detected?', options: [G, F('Not detected')] },
      { key: 'correct_capacity', q: 'RAM size matches the label / order?', options: [G, F('Different size')] },
      { key: 'slot_1_working', q: 'First RAM slot works?', options: [G, F(), DNA('Soldered RAM')] },
      { key: 'slot_2_working', q: 'Second RAM slot works?', options: [G, F(), DNA('Only one slot')] },
      { key: 'storage_detected', q: 'Drive detected?', options: [G, F('Not detected')] },
      { key: 'smart_status_ok', q: 'Drive health shows "Good" in CrystalDiskInfo?', options: [G, F('Caution / Bad')] },
    ],
  },
  {
    key: 'connect', title: 'Wi-Fi, Bluetooth and ports', route: 'parts',
    items: [
      { key: 'wifi_connecting', q: 'Wi-Fi connects to a network?', options: [G, F()] },
      { key: 'bluetooth_working', q: 'Bluetooth finds a device?', options: [G, F(), DNA('No Bluetooth')] },
      { key: 'usb_ports', q: 'Every USB port works?', options: [G, F()] },
      { key: 'type_c', q: 'USB-C port works?', options: [G, F(), DNA('No USB-C')] },
      { key: 'hdmi', q: 'HDMI shows a picture?', options: [G, F(), DNA('No HDMI')] },
      { key: 'audio_jack', q: 'Headphone jack plays sound?', options: [G, F(), DNA('No jack')] },
    ],
  },
  {
    key: 'thermal', title: 'Fan and heat', route: 'parts',
    items: [
      { key: 'fan_spinning', q: 'Fan spins?', options: [G, F("Doesn't spin")] },
      { key: 'no_abnormal_noise', q: 'No grinding or rattling noise?', options: [G, F('Noisy')] },
      { key: 'heating_normal', q: 'Temperature normal under load?', options: [G, F('Overheats')] },
    ],
  },
  {
    key: 'body', title: 'Body', route: 'body',
    items: [
      { key: 'body_intact', q: 'Body free of cracks and broken plastic?', options: [G, F('Cracked / broken')], answersOnly: true },
      { key: 'hinges_ok', q: 'Hinges firm?', options: [G, F('Loose / broken')], answersOnly: true },
    ],
  },
  {
    key: 'locks', title: 'Locks', route: 'floor_manager', hint: 'A locked laptop goes to the floor manager.',
    items: [
      { key: 'hdd_unlocked', q: 'Drive has no password?', options: [G, F('Drive locked')] },
      { key: 'no_mdm_computrace', q: 'No company lock (MDM / Computrace / Absolute)?', options: [G, F('Company-locked')] },
    ],
  },
];
const DIAGNOSIS_ITEMS = DIAGNOSIS_SECTIONS.flatMap((s) => s.items.map((it) => ({ ...it, section: s.key, route: s.route })));

/** What the technician decides at the end of Diagnosis, and where it goes. */
const DIAGNOSIS_OUTCOMES = [
  { value: 'assembly', label: 'No faults — go to assembly', stage: 'Assembly & Software', condition: 'no_chip_no_body' },
  { value: 'parts', label: 'Needs parts — I have asked for them; fit them in assembly', stage: 'Assembly & Software', condition: 'no_chip_no_body' },
  { value: 'chip', label: 'Needs chip-level repair', stage: 'Chip Level Repair', condition: 'chip_required' },
  { value: 'body', label: 'Needs body / paint work', stage: 'Body & Paint', condition: 'body_required' },
  { value: 'floor_manager', label: "Can't fix it here — floor manager to decide", stage: 'Floor Manager', condition: 'diagnosis_failed' },
];

/** The outcome the answers point to (the form pre-selects it). */
function suggestDiagnosisOutcome(answers) {
  const faults = badAnswers(DIAGNOSIS_ITEMS, answers);
  if (!faults.length) return 'assembly';
  const routes = new Set(faults.map((f) => f.route));
  if (routes.has('floor_manager')) return 'floor_manager';
  if (routes.has('chip')) return 'chip';
  if (routes.has('parts')) return 'parts';
  return 'body';
}

// ── Stage checklists (Chip, Body & Paint, Assembly, Final Testing) ─────────
// The live items for Assembly & Final Testing are the editable stage_checklists
// rows; these are the fallback (and the seed for the two repair stages).
const STAGE_CHECKLISTS = {
  'Chip Level Repair': [
    { key: 'fault_found', label: 'Found the faulty component on the board' },
    { key: 'component_replaced', label: 'Replaced / reworked it' },
    { key: 'no_short_after', label: 'No short circuit after the repair' },
    { key: 'powers_on_after', label: 'Laptop powers on and starts' },
    { key: 'no_heating_after', label: 'Ran 15 minutes with no chip heating up' },
  ],
  'Body & Paint': [
    { key: 'damage_fixed', label: 'Cracks / broken plastic repaired or panel replaced' },
    { key: 'hinges_fixed', label: 'Hinges firm' },
    { key: 'painted', label: 'Painted / finished and fully dry' },
    { key: 'screws_back', label: 'All screws and rubber feet back' },
    { key: 'labels_back', label: 'TTSPL and serial labels back on' },
  ],
  'Assembly & Software': [
    { key: 'os_installed', label: 'OS installed (genuine image)' },
    { key: 'drivers_installed', label: 'All drivers installed' },
    { key: 'activation', label: 'Windows / Office activated' },
    { key: 'software_suite', label: 'Standard software suite installed' },
    { key: 'hardware_reassembled', label: 'Hardware reassembled & screws fitted' },
    { key: 'cleaning_done', label: 'Cleaning / cosmetic finish done' },
    { key: 'boot_ok', label: 'Boots & runs without errors' },
  ],
  'Final Testing': [
    { key: 'power_ok', label: 'Powers on & charges' },
    { key: 'display_ok', label: 'Display — no dead pixels / lines' },
    { key: 'keyboard_ok', label: 'Keyboard & touchpad all keys working' },
    { key: 'battery_ok', label: 'Battery health acceptable' },
    { key: 'ports_ok', label: 'All ports (USB / Type-C / HDMI) working' },
    { key: 'wifi_bt_ok', label: 'Wi-Fi & Bluetooth working' },
    { key: 'audio_ok', label: 'Audio (speaker / mic / jack) working' },
    { key: 'camera_ok', label: 'Camera working' },
    { key: 'final_grade', label: 'Laptop cleaned and ready for QC (QC gives the grade)' },
  ],
};

async function stageChecklistItems(db, stageName) {
  try {
    const r = await db.query(
      `SELECT sc.checklist_items FROM stage_checklists sc JOIN stages s ON s.stage_id = sc.stage_id
        WHERE s.stage_name = $1 ORDER BY sc.checklist_id DESC LIMIT 1`,
      [stageName]
    );
    const items = r.rows[0]?.checklist_items;
    if (Array.isArray(items) && items.length) return items;
  } catch (_) { /* table missing on an old env — use the fallback */ }
  return STAGE_CHECKLISTS[stageName] || [];
}

module.exports = {
  QC_SECTIONS, QC_ITEMS, QC_GRADES, QC_BASE_CRITERIA, QC2_ADDITIONAL_CRITERIA, qcCriteria, qcResult,
  DIAGNOSIS_SECTIONS, DIAGNOSIS_ITEMS, DIAGNOSIS_OUTCOMES, suggestDiagnosisOutcome,
  STAGE_CHECKLISTS, stageChecklistItems, checkAnswers, badAnswers,
};
