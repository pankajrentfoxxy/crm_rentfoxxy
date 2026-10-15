import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, DocNumber, Drawer, Field, Input, Notice } from '../../../components/carret';
import api from '../../../utils/api';
import { errMsg } from './procureShared';

/**
 * 428 — give a laptop received without a serial its real serial number, once
 * it powers on. `unit` needs serial_id and ttspl_id. The backend replaces the
 * NOSERIAL- placeholder on the floor ticket and every other copy.
 */
export default function AddSerialDrawer({ unit, onClose, onSaved }) {
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSerial(''); }, [unit?.serial_id]);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/vendor-management/serials/${unit.serial_id}/serial-number`, { serial_number: serial.trim() });
      toast.success(data.message);
      onSaved?.(data.data);
      onClose();
    } catch (e) {
      toast.error(errMsg(e, 'Could not add the serial'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={Boolean(unit)}
      onClose={onClose}
      title="Add serial number"
      footer={<Button variant="primary" disabled={busy || serial.trim().length < 3} onClick={save}>{busy ? 'Saving…' : 'Save serial'}</Button>}
    >
      {unit && (
        <div className="c-stack">
          <p><DocNumber value={unit.ttspl_id} /> was received without its serial number because it would not power on.</p>
          <Notice tone="info" title="Read it from the laptop">
            Use the sticker, the BIOS screen, or the serial shown by Windows (wmic bios get serialnumber). It replaces the placeholder on the floor ticket and everywhere else.
          </Notice>
          <Field label="Serial number" required>
            <Input value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} className="font-mono" autoFocus />
          </Field>
        </div>
      )}
    </Drawer>
  );
}
