import React, { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../utils/api';
import { compressImageFile, podUrl } from '../../../components/support/utils';
import { errMsg } from './serveShared';

/**
 * Six photos of a laptop on a pickup (migration 433): front, back, screen on,
 * keyboard, left side, right side. Each is compressed in the browser (≈1.5 MB
 * max, 1600 px) and uploaded as soon as it is taken; a re-take replaces it.
 * The technician cannot take the customer's OTP until all six are in.
 */
export const PHOTO_SLOTS = [
  { key: 'front', label: 'Front (lid)' },
  { key: 'back', label: 'Back (base)' },
  { key: 'screen', label: 'Screen on' },
  { key: 'keyboard', label: 'Keyboard' },
  { key: 'left', label: 'Left side' },
  { key: 'right', label: 'Right side' },
];

export const uploadPickupPhoto = async (itemId, slot, file) => {
  const small = await compressImageFile(file);
  const fd = new FormData();
  fd.append(slot, small, small.name || `${slot}.jpg`);
  return api.post(`/support/items/${itemId}/photos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

export default function PickupPhotos({ itemId, photos = [], onChange, readOnly = false }) {
  const [busy, setBusy] = useState('');
  const bySlot = Object.fromEntries((photos || []).map((p) => [p.slot, p]));
  const done = PHOTO_SLOTS.filter((s) => bySlot[s.key]).length;

  const take = async (slot, file) => {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) { toast.error('Take a photo'); return; }
    setBusy(slot);
    try {
      const { data } = await uploadPickupPhoto(itemId, slot, file);
      onChange?.(data.photos || []);
    } catch (e) {
      toast.error(errMsg(e, 'Could not upload the photo'));
    } finally { setBusy(''); }
  };

  return (
    <div className="c-photos">
      <div className="c-photos-h">
        <b>Laptop photos</b>
        <span className={done === PHOTO_SLOTS.length ? 'is-ok' : ''}>{done}/{PHOTO_SLOTS.length}</span>
      </div>
      <div className="c-photos-grid">
        {PHOTO_SLOTS.map((s) => {
          const p = bySlot[s.key];
          return (
            <label key={s.key} className={`c-photo${p ? ' is-on' : ''}${readOnly ? ' is-ro' : ''}`}>
              {p ? <img src={podUrl(p.path)} alt={s.label} loading="lazy" /> : <span className="c-photo-plus" aria-hidden="true">＋</span>}
              <span className="c-photo-l">{busy === s.key ? 'Uploading…' : s.label}</span>
              {!readOnly && (
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={Boolean(busy)}
                  onChange={(e) => { take(s.key, e.target.files?.[0]); e.target.value = ''; }}
                />
              )}
              {readOnly && p && <a href={podUrl(p.path)} target="_blank" rel="noopener noreferrer" className="c-photo-open" aria-label={`Open ${s.label}`} />}
            </label>
          );
        })}
      </div>
    </div>
  );
}
