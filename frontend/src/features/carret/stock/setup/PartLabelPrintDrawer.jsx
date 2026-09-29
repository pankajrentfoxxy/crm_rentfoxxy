import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Button, Checkbox, DataTable, Drawer, EmptyState, Field, FormGrid, Input, Notice, Section, Segmented, Select,
} from '../../../../components/carret';
import {
  COLUMNS, GAP_MM, LABEL_MM, MAX_COPIES, PAPER_HEIGHT_MM, PAPER_WIDTH_MM, SIZE_OPTIONS, TIGHT_DOTS,
  captionFor, clampCopies, encodedFor, normaliseUnits, printLabelSheet, qrDataUrl, symbolInfo,
} from './partLabels';

const ROW_DIMS = `${PAPER_WIDTH_MM} × ${PAPER_HEIGHT_MM} mm`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Data-URL previews of each payload, regenerated only when the payloads change. */
function useQrPreviews(payloads) {
  const [previews, setPreviews] = useState({});
  const key = payloads.join('\u0001');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = {};
      for (const text of key ? key.split('\u0001') : []) {
        try { next[text] = await qrDataUrl(text); } catch { next[text] = null; }
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => { cancelled = true; };
  }, [key]);
  return previews;
}

/** The sticker as it will come off the roll: QR, and the caption under it. */
function LabelThumb({ src, code, caption }) {
  return (
    <div className="c-plabel-thumb">
      {src ? <img src={src} alt={`QR for ${code}`} /> : <span className="c-plabel-thumb-wait" aria-hidden="true" />}
      {caption ? <span className="c-plabel-thumb-cap">{caption}</span> : null}
    </div>
  );
}

function CopiesStepper({ code, value, disabled, onChange }) {
  return (
    <div className="c-plabel-step">
      <Button variant="quiet" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)} aria-label={`One less copy of ${code}`}>−</Button>
      <Input type="number" min={0} max={MAX_COPIES} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={`Copies of ${code}`} />
      <Button variant="quiet" disabled={disabled || value >= MAX_COPIES} onClick={() => onChange(value + 1)} aria-label={`One more copy of ${code}`}>+</Button>
    </div>
  );
}

/**
 * Print QR stickers for physical units — spare parts (PRT…) or laptops (TTSPL…).
 * Replaces inventory-management/components/PartLabelPrintModal on Carret
 * screens with the same contract and the same printed output.
 *
 * `units` is [{ code, title, subtitle, poNumber, serialNumber }]. The QR always
 * carries the code; scanning it resolves serial, specs, PO and vendor from the
 * system, so nothing on the sticker can go stale. The PO can also ride inside
 * the symbol, print as text under it, or both.
 *
 * The server builds the PDF (4 × 15 mm stickers on a 71.6 × 15 mm strip); it
 * opens in a new tab with the print dialog, or downloads if popups are blocked.
 * "One by one" sends each unit as its own job so the operator can stick one
 * part's labels before the next part's come out.
 */
export default function PartLabelPrintDrawer({ open, units = [], onClose, defaultCopies = 4, title = 'Print QR labels' }) {
  const [copies, setCopies] = useState({});
  const [sizeMm, setSizeMm] = useState(15);
  const [poInQr, setPoInQr] = useState(false);
  const [showSerial, setShowSerial] = useState(true);
  const [showPo, setShowPo] = useState(true);
  const [busy, setBusy] = useState(false);
  /** { queue, index, phase: 'printing' | 'awaiting_next' } while printing one by one. */
  const [oneByOne, setOneByOne] = useState(null);
  const printing = useRef(false);

  const rows = useMemo(() => normaliseUnits(units), [units]);
  const anyPo = rows.some((u) => u.poNumber);
  const anySerial = rows.some((u) => u.serialNumber);
  const usePoInQr = poInQr && anyPo;
  const withCaption = (showSerial && anySerial) || (showPo && anyPo);
  const captionOpts = { showSerial, showPo };

  const payloads = useMemo(() => rows.map((u) => encodedFor(u, usePoInQr)), [rows, usePoInQr]);
  const previews = useQrPreviews(open ? payloads : []);

  // A new batch starts at the caller's default copy count.
  useEffect(() => {
    if (!open) return;
    setCopies(Object.fromEntries(rows.map((u) => [u.code, defaultCopies])));
    setOneByOne(null);
  }, [open, rows, defaultCopies]);

  const countOf = (u) => Number(copies[u.code]) || 0;
  const totalLabels = rows.reduce((s, u) => s + countOf(u), 0);
  const strips = Math.ceil(totalLabels / COLUMNS) || 0;
  const allSame = rows.length && rows.every((u) => countOf(u) === countOf(rows[0])) ? countOf(rows[0]) : null;

  // Worst case across the batch, since one roll prints them all.
  const density = useMemo(() => {
    if (!payloads.length) return null;
    const longest = payloads.reduce((a, b) => (b.length > a.length ? b : a), payloads[0]);
    return symbolInfo(longest, sizeMm);
  }, [payloads, sizeMm]);

  const setCopiesFor = (code, v) => setCopies((prev) => ({ ...prev, [code]: clampCopies(v) }));
  const setAllCopies = (v) => setCopies(Object.fromEntries(rows.map((u) => [u.code, clampCopies(v)])));

  const labelFor = (u) => ({ code: encodedFor(u, usePoInQr), caption: captionFor(u, captionOpts), copies: countOf(u) });

  const send = async (labels, { filename, message }) => {
    const { stickers, opened } = await printLabelSheet(labels, { sizeMm, withCaption, filename });
    toast.success(message || (opened
      ? `${stickers} label(s) ready — use your label printer's print dialog`
      : `${stickers} label(s) downloaded`));
  };

  const printUnit = (u) => {
    const label = labelFor(u);
    return send([label], { filename: `part-label-${u.code}.pdf`, message: `${u.code}: ${label.copies} sticker(s) ready to print` });
  };

  const printAll = async () => {
    const labels = rows.map(labelFor).filter((l) => l.copies > 0);
    if (!labels.length) { toast.error('Set at least one copy to print'); return; }
    setBusy(true);
    try { await send(labels, {}); } catch (e) {
      toast.error(e.response?.data?.message || 'Could not build the label sheet');
    } finally { setBusy(false); }
  };

  const printOnly = async (u) => {
    if (busy || printing.current) return;
    if (!countOf(u)) { toast.error('Set at least one copy for this part'); return; }
    setBusy(true);
    try { await printUnit(u); } catch (e) {
      toast.error(e.response?.data?.message || `Could not print ${u.code}`);
    } finally { setBusy(false); }
  };

  /** Print queue[index]; afterwards wait for "Print next" or finish. */
  const runStep = async (queue, index) => {
    printing.current = true;
    setBusy(true);
    setOneByOne({ queue, index, phase: 'printing' });
    try {
      await printUnit(queue[index]);
      if (index + 1 >= queue.length) {
        toast.success(queue.length === 1 ? 'Finished — printed 1 part' : `Finished — printed ${queue.length} part(s) one by one`);
        setOneByOne(null);
      } else {
        setOneByOne({ queue, index, phase: 'awaiting_next' });
      }
    } catch (e) {
      toast.error(e.response?.data?.message || `Could not print ${queue[index].code}`);
      // The first job failing ends the run; a later one can be retried with "Print next".
      setOneByOne(index === 0 ? null : { queue, index, phase: 'awaiting_next' });
    } finally {
      printing.current = false;
      setBusy(false);
    }
  };

  const startOneByOne = () => {
    const queue = rows.filter((u) => countOf(u) > 0);
    if (!queue.length) { toast.error('Set at least one copy to print'); return; }
    runStep(queue, 0);
  };

  const printNext = () => {
    if (!oneByOne || printing.current) return;
    if (!oneByOne.queue[oneByOne.index + 1]) { setOneByOne(null); return; }
    runStep(oneByOne.queue, oneByOne.index + 1);
  };

  // Esc, the backdrop and × all land here: never mid-job, and a close drops the queue.
  const close = useCallback(() => {
    if (busy) return;
    setOneByOne(null);
    onClose?.();
  }, [busy, onClose]);

  const locked = busy || Boolean(oneByOne);
  const current = oneByOne ? oneByOne.queue[oneByOne.index] : null;
  const next = oneByOne?.phase === 'awaiting_next' ? oneByOne.queue[oneByOne.index + 1] : null;

  const cols = [
    {
      key: 'q',
      header: 'Label',
      width: '4.5rem',
      render: (u) => {
        const p = encodedFor(u, usePoInQr);
        return <LabelThumb src={previews[p]} code={u.code} caption={captionFor(u, captionOpts)} />;
      },
    },
    {
      key: 'c',
      header: 'Code',
      render: (u) => <span className="font-mono">{u.code}</span>,
      sub: (u) => u.title || null,
    },
    { key: 'd', header: 'Serial / PO', render: (u) => [u.subtitle, u.poNumber].filter(Boolean).join(' · ') || '—' },
    {
      key: 'n',
      header: 'Copies',
      render: (u) => <CopiesStepper code={u.code} value={countOf(u)} disabled={locked} onChange={(v) => setCopiesFor(u.code, v)} />,
    },
    {
      key: 'p',
      header: '',
      align: 'right',
      render: (u) => <Button variant="quiet" disabled={locked || !countOf(u)} onClick={() => printOnly(u)} title={`Print only ${u.code}`}>Print</Button>,
    },
  ];

  const footer = (
    <div className="flex flex-wrap justify-end" style={{ gap: '8px' }}>
      <Button variant="quiet" disabled={busy} onClick={close}>Close</Button>
      <Button disabled={locked || !totalLabels} onClick={startOneByOne} title="Open a separate print job for each part">
        {busy && oneByOne ? 'Printing…' : 'Print one by one'}
      </Button>
      <Button variant="primary" disabled={locked || !totalLabels} onClick={printAll}>
        {busy && !oneByOne ? 'Building sheet…' : `Print all (${totalLabels})`}
      </Button>
    </div>
  );

  return (
    <Drawer open={open} onClose={close} title={title} footer={footer} width="56rem">
      <div className="c-stack">
        <p className="text-ink-3 m-0">
          {plural(rows.length, 'unit')} · {plural(totalLabels, 'sticker')} · {plural(strips, 'strip')} of {COLUMNS}
        </p>

        <Section title="Sticker">
          <div className="c-stack">
            <FormGrid cols={2}>
              <Field label="QR size">
                <Select value={String(sizeMm)} disabled={busy} onChange={(e) => setSizeMm(Number(e.target.value))} options={SIZE_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))} />
              </Field>
              <Field label="Copies for every unit" hint={allSame == null ? 'Units have different counts — set each below' : undefined}>
                <div>
                  <Segmented
                    label="Copies for every unit"
                    value={locked ? null : allSame}
                    onChange={(n) => { if (!locked) setAllCopies(n); }}
                    options={[1, 2, 3, 4].map((n) => ({ value: n, label: `${n}×` }))}
                  />
                </div>
              </Field>
            </FormGrid>
            <div className="c-plabel-strip" aria-label={`Paper ${ROW_DIMS}, four ${LABEL_MM} mm labels`}>
              <div className="c-plabel-strip-row">
                {[1, 2, 3, 4].map((n) => <span key={n} className="c-plabel-strip-cell">{n}</span>)}
              </div>
              <span className="text-ink-3">Paper {ROW_DIMS} · four {LABEL_MM}×{LABEL_MM} mm labels · {GAP_MM} mm gap</span>
            </div>
            <Notice tone="info" title={`Set the printer paper to ${ROW_DIMS}`}>
              Four labels of {LABEL_MM}×{LABEL_MM} mm with a {GAP_MM} mm gap. Print at actual size / 100% — no fit-to-page.
            </Notice>
          </div>
        </Section>

        {(anyPo || anySerial) && (
          <Section title="Text under the QR">
            <div className="c-stack">
              <Checkbox
                checked={showSerial}
                disabled={busy || !anySerial}
                onChange={(e) => setShowSerial(e.target.checked)}
                label={<>Print serial number under the QR <span className="c-plabel-hint">Small upright text. Preferred when a serial exists.{!anySerial ? ' (none on these units)' : ''}</span></>}
              />
              <Checkbox
                checked={showPo}
                disabled={busy || !anyPo}
                onChange={(e) => setShowPo(e.target.checked)}
                label={<>Print PO number under the QR <span className="c-plabel-hint">Used when serial is off or missing (e.g. SP-PO-0499). Tiny font so it is not cut at the edge.</span></>}
              />
              <Checkbox
                checked={poInQr}
                disabled={busy || !anyPo}
                onChange={(e) => setPoInQr(e.target.checked)}
                label={<>Include the PO number inside the QR <span className="c-plabel-hint">Encodes the PO in the QR — a denser symbol; leave off unless you need it.</span></>}
              />
              {density && (
                <Notice tone={density.dots300 < TIGHT_DOTS ? 'warn' : 'info'} title={density.dots300 < TIGHT_DOTS ? 'Tight for a 203 dpi printer — turn off the PO inside the QR' : undefined}>
                  Version {density.version} symbol, {density.modules} modules across {sizeMm} mm — {density.moduleMm.toFixed(3)} mm
                  per module ({density.dots300.toFixed(1)} dots on a 300 dpi printer).
                </Notice>
              )}
            </div>
          </Section>
        )}

        {oneByOne && (
          <Notice
            tone="info"
            title={`One by one · part ${oneByOne.index + 1} of ${oneByOne.queue.length}`}
            action={(
              <div className="flex flex-wrap" style={{ gap: '8px' }}>
                <Button variant="quiet" disabled={busy} onClick={() => setOneByOne(null)}>Stop</Button>
                {next && <Button variant="primary" disabled={busy} onClick={printNext}>{`Print next (${next.code})`}</Button>}
              </div>
            )}
          >
            {oneByOne.phase === 'printing' ? `Printing ${current?.code}…` : `Printed ${current?.code}. Stick its labels, then print the next: ${next?.code || '—'}.`}
          </Notice>
        )}

        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(u) => u.code}
          empty={<EmptyState title="No units to label" />}
        />
      </div>
    </Drawer>
  );
}
