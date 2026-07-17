import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Save, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../utils/api';
import HwReworkAssignModal from '../features/floor-pipeline/components/HwReworkAssignModal';
import Qc1SpecChecklist from '../features/floor-pipeline/components/Qc1SpecChecklist';
import Qc2SpecVerifyPanel from '../features/floor-pipeline/components/Qc2SpecVerifyPanel';
import DispatchQcSpecVerifyPanel from '../features/floor-pipeline/components/DispatchQcSpecVerifyPanel';

const GRADE_OPTIONS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C', 'D'];

const GRADE_NOTES = {
    'A+': 'Like new condition, no visible wear.',
    'A': 'Excellent condition, minimal signs of use.',
    'A-': 'Very good condition, light cosmetic wear.',
    'B+': 'Good condition, minor scratches or wear.',
    'B': 'Fair condition, visible wear but fully functional.',
    'B-': 'Noticeable wear, minor cosmetic issues.',
    'C': 'Heavy cosmetic wear, still functional.',
    'D': 'Poor cosmetic condition, functional with limitations.'
};

const INITIAL_CHECKLIST = {
    // Body & Physical
    body_scratches: null,
    physical_damage: null,
    body_screws: null,
    ttspl_id: null,
    body_hinge: null,

    // Internal & Thermal
    motherboard_cleaning: null,
    heating_test: null,

    // Camera / BIOS / Drivers
    camera_recording: null,
    bios_check: null,
    required_drivers: null,

    // OS & Software
    ms_office: null,
    chrome: null,
    ultra_viewer: null,
    virtual_memory: null,

    // Input Devices
    touchpad: null,
    cursor_speed: null,
    left_click: null,
    right_click: null,
    scrolling: null,
    keyboard: null,
    keyboard_light: null,

    // Ports & Connectivity
    usb_ports: null,
    vga_hdmi: null,
    lan_port: null,
    wifi_test: null,
    power_adapter: null,
    bluetooth: null,
    audio_jack: null,

    // Display & Audio
    speaker: null,
    screen_resolution: null,
    refresh_rate: null,
    touch_screen: null,

    // Power & Storage
    ssd_health: null,
    battery_health: null,

    // Hardware Expandability
    expandability: null
};

export default function QC1Form({ ticket, qcStage = 'QC1', onComplete }) {
    const [header, setHeader] = useState({
        processor: '',
        generation: '',
        storage_type: '',
        ram_size: ''
    });

    const [checklist, setChecklist] = useState(INITIAL_CHECKLIST);

    const [grading, setGrading] = useState({
        final_grade: '',
        grade_notes: ''
    });

    const [partReplacement, setPartReplacement] = useState({
        parts_replaced: false,
        replaced_parts: []
    });

    const [remarks, setRemarks] = useState('');
    const [signOff] = useState({
        checked_by: null
    });
    const [processing, setProcessing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [bitlockerModal, setBitlockerModal] = useState(false);
    const [specChecklistReady, setSpecChecklistReady] = useState(qcStage !== 'QC1');
    const [qc2Verified, setQc2Verified] = useState(qcStage !== 'QC2');
    const [dispatchQcVerified, setDispatchQcVerified] = useState(qcStage !== 'Dispatch QC');
    const [assigneeModal, setAssigneeModal] = useState(false);
    const [qc2Assignees, setQc2Assignees] = useState([]);
    const [selectedAssigneeId, setSelectedAssigneeId] = useState('');
    const [loadingAssignees, setLoadingAssignees] = useState(false);
    const [hwFailPickerOpen, setHwFailPickerOpen] = useState(false);

    const syncHeaderFromSpec = useCallback((h) => {
        setHeader({
            processor: h.processor || '',
            generation: h.generation || '',
            storage_type: h.storage_type || h.ssd || '',
            ram_size: h.ram_size || h.ram || '',
        });
    }, []);

    const handleQc2Verified = useCallback((ok) => {
        setQc2Verified(!!ok);
    }, []);

    const handleDispatchQcVerified = useCallback((ok) => {
        setDispatchQcVerified(!!ok);
    }, []);

    const loadQCData = useCallback(async () => {
        try {
            const res = await api.get(`/tickets/${ticket.ticket_id}/qc?qc_stage=${qcStage}`);
            if (res.data.success) {
                const { ticket: ticketData, qcResult } = res.data;

                // Only prefill the inspection from an UNLOCKED draft of the current cycle.
                // A locked result is a finalized submission from a previous QC pass/fail
                // cycle — after a failure the form must open blank for a fresh inspection.
                const draft = qcResult && !qcResult.is_locked ? qcResult : null;

                // Header config can still come from the ticket/inventory (not a prior QC value).
                setHeader({
                    processor: draft?.processor || ticketData.processor || '',
                    generation: draft?.generation || '',
                    storage_type: draft?.storage_type || ticketData.storage_type || '',
                    ram_size: draft?.ram_size || ticketData.ram_size || ''
                });

                if (draft) {
                    setChecklist(draft.checklist_data || INITIAL_CHECKLIST);
                    setGrading({
                        final_grade: draft.final_grade || '',
                        grade_notes: draft.grade_notes || ''
                    });
                    setRemarks(draft.remarks || '');
                    if (draft.parts_replaced) {
                        setPartReplacement({
                            parts_replaced: true,
                            replaced_parts: draft.replaced_parts || []
                        });
                    }
                } else {
                    // Finalized prior cycle (or nothing yet) → start from scratch.
                    setChecklist(INITIAL_CHECKLIST);
                    setGrading({ final_grade: '', grade_notes: '' });
                    setRemarks('');
                    setPartReplacement({ parts_replaced: false, replaced_parts: [] });
                }
            }
        } catch (error) {
            console.error('Load QC error:', error);
        }
    }, [ticket.ticket_id, qcStage]);

    useEffect(() => {
        loadQCData();
    }, [loadQCData]);

    const needsRemarks = () => {
        return Object.values(checklist).some(val =>
            val === 'NO' || val === 'NOT WORKING' || val === 'BAD' || val === 'FAIL' || val === 'NOT INSTALLED'
        );
    };

    const willPassQC = () => {
        const criticalFailures = [
            checklist.keyboard === 'NOT WORKING',
            checklist.touchpad === 'NOT WORKING',
            checklist.usb_ports === 'NOT WORKING',
            checklist.wifi_test === 'NOT WORKING',
            checklist.battery_health === 'BAD',
            checklist.ssd_health === 'BAD',
            checklist.screen_resolution === 'FAIL'
        ];
        return !criticalFailures.some(Boolean);
    };

    const submitQC = async (assignToUserId = null) => {
        setProcessing(true);
        try {
            // Spec panels own config; fill legacy header fields so API never depends on the old form.
            const safeHeader = {
                processor: header.processor || ticket.processor || '-',
                generation: header.generation || ticket.generation || '-',
                storage_type: header.storage_type || ticket.storage_type || ticket.storage || '-',
                ram_size: header.ram_size || ticket.ram_size || ticket.ram || '-',
            };
            const payload = {
                qcStage,
                header: safeHeader,
                checklist,
                grading,
                remarks,
                replacedParts: partReplacement.parts_replaced ? partReplacement.replaced_parts : [],
                signOff
            };
            if (assignToUserId != null) {
                payload.assignToUserId = assignToUserId;
            }
            const res = await api.post(`/tickets/${ticket.ticket_id}/qc/submit`, payload);

            if (res.data.success) {
                alert(`${qcStage} submitted successfully!\nResult: ${res.data.result}\nNext Stage: ${res.data.nextStage}`);
                onComplete?.({
                    nextStage: res.data.nextStage,
                    result: res.data.result,
                    fromStageMove: true,
                });
            }
        } catch (error) {
            console.error('Submit QC error:', error);
            alert(error.response?.data?.message || 'Failed to submit QC');
        } finally {
            setProcessing(false);
            setAssigneeModal(false);
            setSelectedAssigneeId('');
            setHwFailPickerOpen(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.post(`/tickets/${ticket.ticket_id}/qc/save`, {
                qcStage,
                header,
                checklist,
                grading,
                remarks,
                replacedParts: partReplacement.parts_replaced ? partReplacement.replaced_parts : []
            });
            alert('QC draft saved successfully');
        } catch (error) {
            console.error('Save QC error:', error);
            alert('Failed to save QC draft');
        } finally {
            setSaving(false);
        }
    };

    const handleSubmit = async () => {
        if (qcStage === 'QC1' && !specChecklistReady) {
            return alert('Please complete the specification checklist (all 6 fields)');
        }
        if (qcStage === 'QC2' && !qc2Verified) {
            return alert('Complete QC2 spec verification before testing');
        }
        if (qcStage === 'Dispatch QC' && !dispatchQcVerified) {
            return alert('Complete Dispatch QC spec verification before testing');
        }

        // Validate all checklist items
        const allFilled = Object.values(checklist).every(val => val !== null);
        if (!allFilled) {
            return alert('Please complete all checklist items');
        }

        // Validate remarks if needed
        if (needsRemarks() && !remarks.trim()) {
            return alert('Remarks are mandatory when any item is marked as NO, NOT WORKING, BAD, FAIL, or NOT INSTALLED');
        }

        // Validate grading
        if (!grading.final_grade) {
            return alert('Please assign a final grade');
        }

        // Validate part replacement details
        if (partReplacement.parts_replaced && partReplacement.replaced_parts.length === 0) {
            return alert('Please add part replacement details or uncheck "Any Part Replaced"');
        }

        // Show Bitlocker reminder before submitting
        setBitlockerModal(true);
    };

    const handleBitlockerDone = async () => {
        setBitlockerModal(false);

        const needsQc2Assignee = qcStage === 'QC1' && willPassQC();
        if (qcStage === 'QC1' && !willPassQC()) {
            setHwFailPickerOpen(true);
            return;
        }
        if (!needsQc2Assignee) {
            await submitQC();
            return;
        }

        setLoadingAssignees(true);
        try {
            const res = await api.get('/tickets/qc/qc2-assignees');
            const assignees = res.data.success ? (res.data.assignees || []) : [];
            setQc2Assignees(assignees);

            if (assignees.length === 0) {
                await submitQC();
                return;
            }

            if (assignees.length === 1) {
                await submitQC(assignees[0].user_id);
                return;
            }

            setSelectedAssigneeId('');
            setAssigneeModal(true);
        } catch (error) {
            console.error('Load QC2 assignees error:', error);
            alert('Could not load QC2 team members. Submitting with automatic assignment.');
            await submitQC();
        } finally {
            setLoadingAssignees(false);
        }
    };

    const handleAssigneeConfirm = async () => {
        if (!selectedAssigneeId) {
            return alert('Please select a QC2 team member to assign this ticket');
        }
        await submitQC(parseInt(selectedAssigneeId, 10));
    };

    const confirmHwFailAssign = async (userId) => {
        await submitQC(userId);
    };

    const addReplacedPart = () => {
        setPartReplacement({
            ...partReplacement,
            replaced_parts: [...partReplacement.replaced_parts, { part_code: '', part_name: '', serial_number: '' }]
        });
    };

    const updateReplacedPart = (index, field, value) => {
        const updated = [...partReplacement.replaced_parts];
        updated[index][field] = value;
        setPartReplacement({ ...partReplacement, replaced_parts: updated });
    };

    const removeReplacedPart = (index) => {
        const updated = partReplacement.replaced_parts.filter((_, i) => i !== index);
        setPartReplacement({ ...partReplacement, replaced_parts: updated });
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Stage Header */}
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-bold">{qcStage} Quality Check</h2>
                        <p className="text-purple-100 mt-2">
                            {ticket.brand} {ticket.model} | SN: {ticket.serial_number}
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="text-sm text-purple-200">TR No</div>
                        <div className="text-2xl font-bold">{ticket.ticket_id}</div>
                    </div>
                </div>
            </div>

            {/* Spec checklist (QC1) or classic header (Dispatch QC) */}
            {qcStage === 'QC1' ? (
                <Qc1SpecChecklist
                    ticket={ticket}
                    onReadyChange={setSpecChecklistReady}
                    onHeaderSync={syncHeaderFromSpec}
                />
            ) : qcStage === 'QC2' ? (
                <Qc2SpecVerifyPanel
                    ticket={ticket}
                    onVerified={handleQc2Verified}
                    onHeaderSync={syncHeaderFromSpec}
                />
            ) : qcStage === 'Dispatch QC' ? (
                <DispatchQcSpecVerifyPanel
                    ticket={ticket}
                    onVerified={handleDispatchQcVerified}
                    onHeaderSync={syncHeaderFromSpec}
                />
            ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <span className="text-red-600">*</span> Header Information
                </h3>
                <div className="grid md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-semibold mb-2">Processor *</label>
                        <select
                            value={header.processor}
                            onChange={(e) => setHeader({ ...header, processor: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500"
                            required
                        >
                            <option value="">Select Processor</option>
                            <option value="i3">i3</option>
                            <option value="i5">i5</option>
                            <option value="i7">i7</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold mb-2">Generation *</label>
                        <input
                            type="text"
                            value={header.generation}
                            onChange={(e) => setHeader({ ...header, generation: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500"
                            placeholder="e.g., 8th Gen, 10th Gen"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold mb-2">Storage Type *</label>
                        <select
                            value={header.storage_type}
                            onChange={(e) => setHeader({ ...header, storage_type: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500"
                            required
                        >
                            <option value="">Select Storage</option>
                            <option value="120GB SSD">120GB SSD</option>
                            <option value="128GB SSD">128GB SSD</option>
                            <option value="240GB SSD">240GB SSD</option>
                            <option value="256GB SSD">256GB SSD</option>
                            <option value="500GB HDD">500GB HDD</option>
                            <option value="512GB SSD">512GB SSD</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold mb-2">RAM Size *</label>
                        <select
                            value={header.ram_size}
                            onChange={(e) => setHeader({ ...header, ram_size: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500"
                            required
                        >
                            <option value="">Select RAM</option>
                            <option value="8GB">8GB</option>
                            <option value="16GB">16GB</option>
                            <option value="32GB">32GB</option>
                        </select>
                    </div>
                </div>
            </div>
            )}

            {qcStage === 'QC2' && !qc2Verified ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Specs must match first. When they do, review them above and click <strong>Continue to QC2 Testing</strong>.
                </div>
            ) : qcStage === 'Dispatch QC' && !dispatchQcVerified ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                    Specs must match first. When they do, review them above and click <strong>Proceed to Dispatch QC Testing</strong>.
                </div>
            ) : (
            <>
            {/* Body & Physical Section */}
            <ChecklistSection
                title="Body & Physical"
                icon="🔍"
                items={[
                    { key: 'body_scratches', label: 'Body Scratches Available', options: ['YES', 'NO'] },
                    { key: 'physical_damage', label: 'Physical Damage / Crack Available', options: ['YES', 'NO'] },
                    { key: 'body_screws', label: 'Body Check for Screws', options: ['YES', 'NO'] },
                    { key: 'ttspl_id', label: 'TTSPL ID', options: ['YES', 'NO'] },
                    { key: 'body_hinge', label: 'Body Check for Hinge', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Internal & Thermal Section */}
            <ChecklistSection
                title="Internal & Thermal"
                icon="🌡️"
                items={[
                    { key: 'motherboard_cleaning', label: 'Motherboard Cleaning & CPU Paste', options: ['YES', 'NO'] },
                    { key: 'heating_test', label: 'Heating Issues Test', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Camera / BIOS / Drivers Section */}
            <ChecklistSection
                title="Camera / BIOS / Drivers"
                icon="📷"
                items={[
                    { key: 'camera_recording', label: 'Camera (Video & Audio) Recording', options: ['YES', 'NO'] },
                    { key: 'bios_check', label: 'BIOS Check', options: ['YES', 'NO'] },
                    { key: 'required_drivers', label: 'All Required Drivers', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* OS & Software Section */}
            <ChecklistSection
                title="OS & Software"
                icon="💻"
                items={[
                    { key: 'ms_office', label: 'MS Office Installation & Activation', options: ['INSTALLED', 'NOT INSTALLED'] },
                    { key: 'chrome', label: 'Chrome', options: ['INSTALLED', 'NOT INSTALLED'] },
                    { key: 'ultra_viewer', label: 'Ultra Viewer', options: ['INSTALLED', 'NOT INSTALLED'] },
                    { key: 'virtual_memory', label: 'Virtual Memory Set as per RAM', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Input Devices Section */}
            <ChecklistSection
                title="Input Devices"
                icon="⌨️"
                items={[
                    { key: 'touchpad', label: 'Touch Pad', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'cursor_speed', label: 'Cursor Speed Set 80%', options: ['YES', 'NO'] },
                    { key: 'left_click', label: 'Left Click', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'right_click', label: 'Right Click', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'scrolling', label: 'Scrolling', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'keyboard', label: 'Keyboard', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'keyboard_light', label: 'Keyboard Light', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Ports & Connectivity Section */}
            <ChecklistSection
                title="Ports & Connectivity"
                icon="🔌"
                items={[
                    { key: 'usb_ports', label: 'All USB Ports', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'vga_hdmi', label: 'VGA or HDMI', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'lan_port', label: 'LAN Port', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'wifi_test', label: 'WiFi Test (2.4 / 5 GHz)', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'power_adapter', label: 'Power Adapter & Watt', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'bluetooth', label: 'Bluetooth Check', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'audio_jack', label: 'Audio Jack', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Display & Audio Section */}
            <ChecklistSection
                title="Display & Audio"
                icon="🖥️"
                items={[
                    { key: 'speaker', label: 'Speaker', options: ['WORKING', 'NOT WORKING'] },
                    { key: 'screen_resolution', label: 'Screen Resolution', options: ['PASS', 'FAIL'] },
                    { key: 'refresh_rate', label: 'Display Adapter Refresh Rate Set', options: ['YES', 'NO'] },
                    { key: 'touch_screen', label: 'Touch Screen', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Power & Storage Section */}
            <ChecklistSection
                title="Power & Storage"
                icon="🔋"
                items={[
                    { key: 'ssd_health', label: 'SSD Health', options: ['GOOD', 'AVERAGE', 'BAD'] },
                    { key: 'battery_health', label: 'Battery Health', options: ['GOOD', 'AVERAGE', 'BAD'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Hardware Expandability Section */}
            <ChecklistSection
                title="Hardware Expandability"
                icon="🔧"
                items={[
                    { key: 'expandability', label: 'Hard Drive, RAM Type & Expandable Possibility', options: ['YES', 'NO'] }
                ]}
                checklist={checklist}
                setChecklist={setChecklist}
            />

            {/* Part Replacement Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                    🔩 Part Replacement Declaration
                </h3>
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <input
                            type="checkbox"
                            id="parts_replaced"
                            checked={partReplacement.parts_replaced}
                            onChange={(e) => setPartReplacement({ parts_replaced: e.target.checked, replaced_parts: e.target.checked ? partReplacement.replaced_parts : [] })}
                            className="w-5 h-5 text-purple-600"
                        />
                        <label htmlFor="parts_replaced" className="text-lg font-semibold">Any Part Replaced?</label>
                    </div>

                    {partReplacement.parts_replaced && (
                        <div className="mt-4 space-y-3">
                            {partReplacement.replaced_parts.map((part, index) => (
                                <div key={index} className="grid md:grid-cols-4 gap-3 p-4 bg-gray-50 rounded-lg">
                                    <input
                                        type="text"
                                        placeholder="Part Code"
                                        value={part.part_code}
                                        onChange={(e) => updateReplacedPart(index, 'part_code', e.target.value)}
                                        className="border rounded-lg p-2"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Part Name"
                                        value={part.part_name}
                                        onChange={(e) => updateReplacedPart(index, 'part_name', e.target.value)}
                                        className="border rounded-lg p-2"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Serial Number *"
                                        value={part.serial_number}
                                        onChange={(e) => updateReplacedPart(index, 'serial_number', e.target.value)}
                                        className="border rounded-lg p-2"
                                        required
                                    />
                                    <button
                                        onClick={() => removeReplacedPart(index)}
                                        className="bg-red-100 text-red-600 rounded-lg px-3 py-2 font-semibold hover:bg-red-200"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}

                            <button
                                onClick={addReplacedPart}
                                className="bg-purple-100 text-purple-600 rounded-lg px-4 py-2 font-semibold hover:bg-purple-200"
                            >
                                + Add Part
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Grading Section */}
            <div className="bg-gradient-to-br from-yellow-50 to-amber-50 border-2 border-yellow-300 rounded-xl p-6 shadow-md">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-yellow-900">
                    ⭐ Final Grading <span className="text-red-600">*</span>
                </h3>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold mb-2 text-yellow-900">Grade *</label>
                        <select
                            value={grading.final_grade}
                            onChange={(e) => {
                                const selected = e.target.value;
                                setGrading({
                                    final_grade: selected,
                                    grade_notes: selected ? (GRADE_NOTES[selected] || '') : ''
                                });
                            }}
                            className="w-full border-2 border-yellow-300 rounded-lg p-3 focus:ring-2 focus:ring-yellow-500 bg-white"
                            required
                        >
                            <option value="">Select Grade</option>
                            {GRADE_OPTIONS.map(grade => (
                                <option key={grade} value={grade}>{grade}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold mb-2 text-yellow-900">Grade Notes (Optional)</label>
                        <textarea
                            value={grading.grade_notes}
                            onChange={(e) => setGrading({ ...grading, grade_notes: e.target.value })}
                            className="w-full border-2 border-yellow-300 rounded-lg p-3 focus:ring-2 focus:ring-yellow-500 bg-white"
                            rows="3"
                            placeholder="Optional notes about the grading decision..."
                        />
                    </div>
                </div>
            </div>

            {/* Remarks Section */}
            {needsRemarks() && (
                <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-red-900">
                        <AlertTriangle className="w-6 h-6" />
                        Remarks Required <span className="text-red-600">*</span>
                    </h3>
                    <textarea
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        className="w-full border-2 border-red-300 rounded-lg p-3 focus:ring-2 focus:ring-red-500"
                        rows="4"
                        placeholder="Please provide remarks for items marked as NO, NOT WORKING, BAD, FAIL, or NOT INSTALLED..."
                        required
                    />
                </div>
            )}

            {/* Optional Remarks */}
            {!needsRemarks() && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <h3 className="text-xl font-bold mb-4">Additional Remarks (Optional)</h3>
                    <textarea
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500"
                        rows="3"
                        placeholder="Any additional notes or observations..."
                    />
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4">
                <button
                    onClick={handleSave}
                    disabled={saving || processing}
                    className="flex-1 bg-gray-600 text-white py-4 rounded-lg font-bold text-lg hover:bg-gray-700 disabled:bg-gray-300 transition-colors flex items-center justify-center gap-2 shadow-md"
                >
                    <Save className="w-6 h-6" />
                    {saving ? 'Saving...' : 'Save Draft'}
                </button>

                <button
                    onClick={handleSubmit}
                    disabled={processing || saving || loadingAssignees}
                    className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 rounded-lg font-bold text-lg hover:from-green-700 hover:to-emerald-700 disabled:from-gray-300 disabled:to-gray-400 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                    <CheckCircle className="w-6 h-6" />
                    {processing || loadingAssignees ? 'Submitting...' : `Submit ${qcStage}`}
                </button>
            </div>
            </>
            )}

            {/* QC2 assignee selection (after QC1 pass + Bitlocker confirm) */}
            {assigneeModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="mb-6">
                            <h3 className="text-lg font-bold text-gray-900 mb-2">Assign for QC2</h3>
                            <p className="text-gray-600 text-sm">
                                Select a team member with QC2 access. The ticket will move to QC2 and be assigned to them.
                            </p>
                        </div>
                        <div className="mb-6">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">
                                QC2 assignee <span className="text-red-600">*</span>
                            </label>
                            <select
                                value={selectedAssigneeId}
                                onChange={(e) => setSelectedAssigneeId(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">Select team member</option>
                                {qc2Assignees.map((member) => (
                                    <option key={member.user_id} value={member.user_id}>
                                        {member.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setAssigneeModal(false);
                                    setSelectedAssigneeId('');
                                }}
                                disabled={processing}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAssigneeConfirm}
                                disabled={processing || !selectedAssigneeId}
                                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-300"
                            >
                                {processing ? 'Submitting...' : 'Submit QC1'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <HwReworkAssignModal
                ticket={ticket}
                open={hwFailPickerOpen}
                onClose={() => setHwFailPickerOpen(false)}
                onConfirm={confirmHwFailAssign}
                confirming={processing}
            />

            {/* Bitlocker Reminder Modal */}
            {bitlockerModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[60]">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="text-center mb-6">
                            <div className="mx-auto w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
                                <span className="text-2xl">🔒</span>
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">Please remove Bitlocker</h3>
                            <p className="text-gray-600 text-sm">
                                Ensure Bitlocker has been removed from the laptop before marking QC Pass. The ticket will move to the next stage after you confirm.
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setBitlockerModal(false)}
                                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleBitlockerDone}
                                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Reusable Checklist Section Component
function ChecklistSection({ title, icon, items, checklist, setChecklist }) {
    const [expanded, setExpanded] = useState(true);
    const negativeTokens = ['NO', 'NOT', 'BAD', 'FAIL'];

    const failures = items.filter(item => {
        const val = checklist[item.key];
        console.log('Checklist value for', val);
        if (!Array.isArray(val)) return false;
        return negativeTokens.some(token => val?.includes(token));
    });
    const completed = items.filter(item => checklist[item.key] !== null).length;

    return (
        <div className={`rounded-xl border ${failures.length > 0 ? 'border-red-300 bg-red-50/30' : 'border-gray-200 bg-white'} overflow-hidden shadow-sm`}>
            <div
                onClick={() => setExpanded(!expanded)}
                className={`flex items-center gap-3 p-4 cursor-pointer ${failures.length > 0 ? 'bg-red-100/50' : 'bg-gray-50'}`}
            >
                <span className="text-lg">{icon}</span>
                <span className="font-bold text-gray-800">{title}</span>
                <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs font-semibold text-gray-500">{completed}/{items.length}</span>
                    {failures.length > 0 && (
                        <span className="text-xs font-bold text-red-600">{failures.length} Issue(s)</span>
                    )}
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
            </div>

            {expanded && (
                <div className="p-4 space-y-4">
                    {items.map(item => (
                        <div key={item.key} className="grid md:grid-cols-2 gap-4 items-center">
                            <div className="font-medium text-gray-700">{item.label}</div>
                            <div className="flex gap-2 flex-wrap">
                                {item.options.map(option => {
                                    const isNegative = negativeTokens.some(token => option.includes(token));
                                    return (
                                        <button
                                            key={option}
                                            onClick={() => setChecklist({ ...checklist, [item.key]: option })}
                                            className={`px-4 py-2 rounded-lg font-semibold transition-all ${checklist[item.key] === option
                                                ? (isNegative ? 'bg-red-600 text-white shadow-md' : 'bg-green-600 text-white shadow-md')
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                                }`}
                                        >
                                            {option}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
