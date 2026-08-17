import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../../../components/ui/supportPrimitives';
import { fetchReturnCatalog, saveWorkOrderCondition, uploadAttachments } from '../supportV2Api';

const DEFAULT_GRADES = {
  A: 'Like new. No visible marks. Fully functional.',
  B: 'Light cosmetic wear. Minor scuffs. Fully functional.',
  C: 'Visible wear — dents, deep scratches, worn keys. Functional.',
  D: 'Damaged — cracked screen/body, hinge broken, liquid, non-functional.',
};

function emptySheet(serialId) {
  return {
    serial_id: serialId,
    grade: '',
    damage_items: [],
    accessories: {},
    notes: '',
    attachment_ids: [],
  };
}

function liveTotal(sheet, catalog) {
  let n = 0;
  for (const code of sheet.damage_items) {
    const row = (catalog.damage || []).find((d) => d.code === code);
    n += Number(row?.charge_amount || 0);
  }
  for (const [code, status] of Object.entries(sheet.accessories || {})) {
    if (status === 'MISSING' || status === 'DAMAGED') {
      const row = (catalog.accessories || []).find((a) => a.code === code);
      n += Number(row?.charge_amount || 0);
    }
  }
  return n;
}

export default function ConditionGradingSheet({ wo, assets, ticketId, disabled, onComplete }) {
  const serials = (assets || []).filter((a) => a.serial_id);
  const [catalog, setCatalog] = useState({ accessories: [], damage: [], grades: DEFAULT_GRADES });
  const [sheets, setSheets] = useState(() => Object.fromEntries(serials.map((a) => [a.serial_id, emptySheet(a.serial_id)])));
  const [active, setActive] = useState(serials[0]?.serial_id || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState({});

  useEffect(() => {
    fetchReturnCatalog()
      .then((r) => setCatalog({
        accessories: r.data?.accessories || [],
        damage: r.data?.damage || [],
        grades: r.data?.grades || DEFAULT_GRADES,
      }))
      .catch(() => {});
  }, []);

  const sheet = sheets[active] || emptySheet(active);
  const running = useMemo(
    () => Object.values(sheets).reduce((s, sh) => s + liveTotal(sh, catalog), 0),
    [sheets, catalog]
  );

  const patch = (partial) => {
    setSheets((cur) => ({ ...cur, [active]: { ...cur[active], ...partial } }));
  };

  const toggleDamage = (code) => {
    const cur = sheet.damage_items || [];
    patch({ damage_items: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code] });
  };

  const addPhotos = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    try {
      const r = await uploadAttachments(ticketId, files, { kind: 'CONDITION' });
      const ids = (r.data?.rows || []).map((x) => x.attachment_id);
      patch({ attachment_ids: [...(sheet.attachment_ids || []), ...ids] });
    } catch {
      toast.error('Photo upload failed');
    }
  };

  const saveOne = async (serialId) => {
    const sh = sheets[serialId];
    if (!sh?.grade) throw new Error('Pick a grade');
    const r = await saveWorkOrderCondition(wo.wo_id, {
      serial_id: serialId,
      grade: sh.grade,
      damage_items: (sh.damage_items || []).map((code) => ({ code })),
      accessories: Object.fromEntries(
        Object.entries(sh.accessories || {}).map(([code, status]) => [code, { status }])
      ),
      notes: sh.notes,
      attachment_ids: sh.attachment_ids || [],
    });
    setSaved((cur) => ({ ...cur, [serialId]: true }));
    return r;
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      for (const a of serials) {
        await saveOne(a.serial_id);
      }
      toast.success('Condition saved');
      onComplete({ graded: true, serial_ids: serials.map((a) => a.serial_id) });
    } catch (e) {
      toast.error(e.response?.data?.message || e.message || 'Grade rejected');
    } finally {
      setSaving(false);
    }
  };

  if (!serials.length) return <p className="text-[12px] text-sup-muted">No serials on this job.</p>;

  return (
    <div className="space-y-3 text-[12px]">
      <div className="flex flex-wrap gap-1">
        {serials.map((a) => (
          <button
            key={a.serial_id}
            type="button"
            onClick={() => setActive(a.serial_id)}
            className={`px-2 py-1 rounded-full border ${active === a.serial_id ? 'bg-sup-accentSoft border-sup-accent' : 'border-sup-line'}`}
          >
            {a.ttspl_id || a.serial_number || a.serial_id}
            {saved[a.serial_id] ? ' ✓' : ''}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {['A', 'B', 'C', 'D'].map((g) => (
          <button
            key={g}
            type="button"
            disabled={disabled}
            onClick={() => patch({ grade: g })}
            className={`min-h-[72px] rounded-[10px] border p-2 text-left ${sheet.grade === g ? 'ring-2 ring-sup-accent bg-sup-accentSoft' : 'border-sup-line bg-white'}`}
          >
            <div className="text-[16px] font-bold">Grade {g}</div>
            <div className="text-[11px] text-sup-muted">{catalog.grades[g] || DEFAULT_GRADES[g]}</div>
          </button>
        ))}
      </div>

      <div>
        <div className="font-semibold mb-1">Damage</div>
        <div className="space-y-1">
          {(catalog.damage || []).map((d) => (
            <label key={d.code} className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={(sheet.damage_items || []).includes(d.code)}
                onChange={() => toggleDamage(d.code)}
              />
              {d.name} <span className="text-sup-muted">₹{Number(d.charge_amount).toLocaleString('en-IN')}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="font-semibold mb-1">Accessories</div>
        {(catalog.accessories || []).map((a) => (
          <div key={a.code} className="flex items-center gap-2 py-0.5">
            <span className="w-36">{a.name}</span>
            {['PRESENT', 'MISSING', 'DAMAGED'].map((st) => (
              <label key={st} className="flex items-center gap-1">
                <input
                  type="radio"
                  name={`acc-${active}-${a.code}`}
                  disabled={disabled}
                  checked={(sheet.accessories || {})[a.code] === st}
                  onChange={() => patch({ accessories: { ...sheet.accessories, [a.code]: st } })}
                />
                {st === 'PRESENT' ? 'Present' : st === 'MISSING' ? 'Missing' : 'Damaged'}
              </label>
            ))}
          </div>
        ))}
      </div>

      <label className="underline text-sup-accent cursor-pointer">
        ＋ Photos ({(sheet.attachment_ids || []).length})
        <input type="file" accept="image/*" multiple disabled={disabled} className="hidden" onChange={addPhotos} />
      </label>
      <textarea
        disabled={disabled}
        value={sheet.notes}
        onChange={(e) => patch({ notes: e.target.value })}
        rows={2}
        placeholder="Notes"
        className="w-full border rounded px-2 py-1"
      />

      <div className="font-semibold text-[13px]">
        Chargeable so far: ₹{running.toLocaleString('en-IN')}
      </div>
      <Button size="touch" disabled={disabled} loading={saving} onClick={saveAll}>
        Save grades
      </Button>
    </div>
  );
}
