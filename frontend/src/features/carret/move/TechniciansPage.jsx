import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import DeskShell from '../../../shells/DeskShell';
import {
  Button, ConfirmDialog, DataTable, Drawer, EmptyState, Field, FilterBar, FormGrid, Input, Notice, Panel, Select,
  StatusChip, Textarea,
} from '../../../components/carret';
import { getBackendOrigin } from '../../../utils/api';
import {
  changeDeliveryTechnicianPassword, createDeliveryTechnician, deleteDeliveryTechnician, fetchDeliveryTechnician,
  fetchDeliveryTechnicians, fetchTechnicianAddMeta, loginAsTechnician, updateDeliveryTechnician,
  updateDeliveryTechnicianStatus,
} from '../../../utils/deliveryRegisterApi';
import { formatIndianMobileInput, indianMobileError, normalizeIndianMobile } from '../../../utils/phoneValidation';
import { usePermission } from '../../../hooks/usePermission';
import { errText } from './chargerShared';

/**
 * Movement → Delivery technicians: the people who carry a challan by hand and
 * log in to the technician portal (OTP, proof of delivery). The DC's "by hand"
 * picker lists the active ones.
 *
 * Same API as the old screens (/delivery-register-management/technicians),
 * which has always been guarded by `technician_bucket` — so this page and its
 * menu entry use that section too, instead of the two different ones the old
 * menu and route used.
 */
const SECTION = 'technician_bucket';
const PAGE_SIZE = 25;
const IDENTITY_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving licence' },
  { value: 'nid', label: 'National ID' },
  { value: 'company_id', label: 'Company ID' },
];
const EMPTY = {
  first_name: '', last_name: '', country_code: '91', phone: '', identity_type: 'company_id',
  identity_number: '', address: '', email: '', password: '',
};

const imageUrl = (file) => (file ? `${getBackendOrigin().replace(/\/$/, '')}/uploads/delivery-man/${String(file).replace(/^\//, '')}` : null);
const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || '—';

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(length);
  window.crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

export default function TechniciansPage() {
  const { hasPermission, user } = usePermission();
  const can = (a) => hasPermission(SECTION, a);
  const isSuper = user?.role === 'super_admin';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, rows: [], total: 0, pages: 1, error: null });
  const [editing, setEditing] = useState(null); // 'new' | technician_id
  const [pwFor, setPwFor] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => fetchDeliveryTechnicians({ page, limit: PAGE_SIZE, search: search || undefined })
    .then((d) => setState({ loading: false, rows: d.data || [], total: d.pagination?.total ?? (d.data || []).length, pages: d.pagination?.totalPages || 1, error: null }))
    .catch((e) => setState({ loading: false, rows: [], total: 0, pages: 1, error: errText(e, 'Could not load technicians.') })), [page, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const toggle = async (r) => {
    setBusy(r.technician_id);
    try {
      await updateDeliveryTechnicianStatus(r.technician_id, r.is_active ? 0 : 1);
      toast.success(`${fullName(r)} is now ${r.is_active ? 'inactive' : 'active'}`);
      load();
    } catch (e) { toast.error(errText(e, 'Could not change the status')); } finally { setBusy(null); }
  };

  const loginAs = async (r) => {
    setBusy(r.technician_id);
    try {
      const d = await loginAsTechnician({ technician_id: r.technician_id, technician_email: r.email });
      if (!d.technicianToken) throw new Error('No session token returned');
      window.open(`${window.location.origin}/technician/auth/callback?token=${encodeURIComponent(d.technicianToken)}`, '_blank', 'noopener,noreferrer');
      toast.success('Technician portal opened in a new tab');
    } catch (e) { toast.error(errText(e, e.message || 'Login as technician failed')); } finally { setBusy(null); }
  };

  const doDelete = async () => {
    try {
      await deleteDeliveryTechnician(deleting.technician_id);
      toast.success(`${fullName(deleting)} deleted`);
      load();
    } catch (e) { toast.error(errText(e, 'Could not delete — challans may still point at this technician. Make them inactive instead.')); }
  };

  const columns = useMemo(() => [
    {
      key: 'n', header: 'Technician',
      render: (r) => (
        <span className="flex items-center" style={{ gap: '8px' }}>
          {r.image
            ? <img src={imageUrl(r.image)} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
            : null}
          {fullName(r)}
        </span>
      ),
      sub: (r) => (r.user_id ? 'CRM user' : 'Portal login'),
    },
    { key: 'p', header: 'Phone', render: (r) => (r.phone ? `+${r.country_code || '91'} ${r.phone}` : '—'), sub: (r) => r.email || null },
    { key: 's', header: 'Status', render: (r) => <StatusChip status={r.is_active ? 'active' : 'cancelled'} label={r.is_active ? 'Active' : 'Inactive'} /> },
    {
      key: 'a', header: '', align: 'right',
      render: (r) => (
        <span className="flex justify-end flex-wrap" style={{ gap: '4px' }}>
          {can('edit') && <Button variant="quiet" onClick={() => setEditing(r.technician_id)}>Edit</Button>}
          {can('edit') && <Button variant="quiet" onClick={() => toggle(r)} disabled={busy === r.technician_id}>{r.is_active ? 'Deactivate' : 'Activate'}</Button>}
          {can('edit') && r.email && <Button variant="quiet" onClick={() => setPwFor(r)}>Password</Button>}
          {can('edit') && isSuper && r.email && <Button variant="quiet" onClick={() => loginAs(r)} disabled={busy === r.technician_id}>Login as</Button>}
          {can('delete') && <Button variant="quiet" onClick={() => setDeleting(r)}>Delete</Button>}
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy, isSuper, hasPermission]);

  return (
    <DeskShell
      title="Delivery technicians"
      breadcrumb="Movement"
      subtitle="Who can carry a challan by hand and sign in to the technician portal."
      actions={can('create') && <Button variant="primary" onClick={() => setEditing('new')}>Add technician</Button>}
    >
      <Panel
        toolbar={(
          <FilterBar
            filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Name, phone, email or ID number' }]}
            values={{ search }}
            onChange={(k, v) => { setSearch(v); setPage(1); }}
            onClear={() => setSearch('')}
            count={`${state.total} technicians`}
          />
        )}
      >
        {state.loading && <EmptyState title="Loading…" />}
        {state.error && <EmptyState title="Could not load technicians" body={state.error} />}
        {!state.loading && !state.error && (
          <>
            <DataTable columns={columns} rows={state.rows} rowKey={(r) => r.technician_id} empty={<EmptyState title="No technicians found" />} />
            {state.pages > 1 && (
              <div className="flex items-center justify-end" style={{ gap: '8px', padding: '8px' }}>
                <Button variant="quiet" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="font-ui text-ink-2" style={{ fontSize: 'var(--d-sm)' }}>Page {page} of {state.pages}</span>
                <Button variant="quiet" disabled={page >= state.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </Panel>

      <TechnicianDrawer id={editing} onClose={() => setEditing(null)} onSaved={load} />
      <PasswordDrawer tech={pwFor} onClose={() => setPwFor(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title={`Delete ${deleting ? fullName(deleting) : ''}?`}
        body="This removes the technician for good. To stop them being picked on new challans, deactivate instead."
        confirmLabel="Delete"
      />
    </DeskShell>
  );
}

function TechnicianDrawer({ id, onClose, onSaved }) {
  const isNew = id === 'new';
  const [form, setForm] = useState(EMPTY);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [idFiles, setIdFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setError(''); setPhoto(null); setIdFiles([]); setPhotoPreview(null);
    if (isNew) {
      setForm({ ...EMPTY, password: generatePassword() });
      fetchTechnicianAddMeta().then((d) => { if (d.generated_password) setForm((f) => ({ ...f, password: d.generated_password })); }).catch(() => {});
      return;
    }
    setLoading(true);
    fetchDeliveryTechnician(id)
      .then((d) => {
        const t = d.data || {};
        setForm({
          first_name: t.first_name || '', last_name: t.last_name || '', country_code: t.country_code || '91',
          phone: t.phone || '', identity_type: t.identity_type || 'company_id', identity_number: t.identity_number || '',
          address: t.address || '', email: t.email || '', password: '',
        });
        setPhotoPreview(imageUrl(t.image));
      })
      .catch((e) => setError(errText(e, 'Could not load the technician')))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setError('');
    if (!form.first_name.trim() || !form.last_name.trim()) { setError('First and last name are required.'); return; }
    const phoneErr = indianMobileError(form.phone, { required: true, label: 'Phone' });
    if (phoneErr) { setError(phoneErr); return; }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError('A valid email is required — it is the portal login.'); return; }
    if (isNew && !photo) { setError('A photo is required.'); return; }
    if (isNew && form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }

    const fd = new FormData();
    fd.append('first_name', form.first_name.trim());
    fd.append('last_name', form.last_name.trim());
    fd.append('country_code', form.country_code || '91');
    fd.append('phone', normalizeIndianMobile(form.phone));
    fd.append('identity_type', form.identity_type);
    fd.append('identity_number', form.identity_number.trim());
    fd.append('address', form.address);
    fd.append('email', form.email.trim());
    if (isNew) fd.append('password', form.password);
    if (photo) fd.append('image', photo);
    idFiles.forEach((f) => fd.append('identity_image', f));

    setSaving(true);
    try {
      if (isNew) await createDeliveryTechnician(fd); else await updateDeliveryTechnician(id, fd);
      toast.success(isNew ? 'Technician added — login details emailed' : 'Technician updated');
      onSaved?.();
      onClose?.();
    } catch (e) {
      setError(errText(e, 'Could not save the technician'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      title={isNew ? 'Add technician' : 'Edit technician'}
      width="36rem"
      footer={<Button variant="primary" onClick={save} disabled={saving || loading}>{saving ? 'Saving…' : 'Save'}</Button>}
    >
      {loading ? <EmptyState title="Loading…" /> : (
        <div className="c-stack">
          {error && <Notice tone="crit" title={error} />}
          <FormGrid cols={2}>
            <Field label="First name" required><Input value={form.first_name} onChange={set('first_name')} /></Field>
            <Field label="Last name" required><Input value={form.last_name} onChange={set('last_name')} /></Field>
            <Field label="Mobile" required hint="10-digit Indian mobile">
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formatIndianMobileInput(e.target.value) }))} inputMode="tel" />
            </Field>
            <Field label="Email" required hint="Used to sign in to the technician portal">
              <Input type="email" value={form.email} onChange={set('email')} />
            </Field>
            <Field label="ID type"><Select options={IDENTITY_TYPES} value={form.identity_type} onChange={set('identity_type')} /></Field>
            <Field label="ID number"><Input value={form.identity_number} onChange={set('identity_number')} /></Field>
            <Field label="Address" span={2}><Textarea value={form.address} onChange={set('address')} rows={2} /></Field>
            <Field label="Photo" required={isNew}>
              <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPhoto(f); setPhotoPreview(URL.createObjectURL(f)); } }} />
              {photoPreview && <img src={photoPreview} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', marginTop: 6 }} />}
            </Field>
            <Field label="ID images" hint={isNew ? 'Optional, several allowed' : 'New images replace the ones on file'}>
              <input type="file" accept="image/*" multiple onChange={(e) => setIdFiles(Array.from(e.target.files || []))} />
            </Field>
            {isNew && (
              <Field label="Portal password" span={2} hint="Generated for you and emailed to the technician">
                <div className="flex" style={{ gap: '6px' }}>
                  <Input value={form.password} onChange={set('password')} />
                  <Button variant="quiet" onClick={() => setForm((f) => ({ ...f, password: generatePassword() }))}>New</Button>
                </div>
              </Field>
            )}
          </FormGrid>
        </div>
      )}
    </Drawer>
  );
}

function PasswordDrawer({ tech, onClose }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setPw(''); setConfirm(''); }, [tech]);

  const save = async () => {
    if (pw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (pw !== confirm) { toast.error('The two passwords do not match'); return; }
    setSaving(true);
    try {
      await changeDeliveryTechnicianPassword(tech.technician_id, { password: pw, confirm_password: confirm });
      toast.success('Password changed');
      onClose?.();
    } catch (e) { toast.error(errText(e, 'Could not change the password')); } finally { setSaving(false); }
  };

  return (
    <Drawer
      open={Boolean(tech)}
      onClose={onClose}
      title={tech ? `Password — ${fullName(tech)}` : 'Password'}
      footer={<Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Change password'}</Button>}
    >
      <div className="c-stack">
        <Field label="New password" hint="At least 8 characters">
          <div className="flex" style={{ gap: '6px' }}>
            <Input value={pw} onChange={(e) => setPw(e.target.value)} />
            <Button variant="quiet" onClick={() => { const g = generatePassword(); setPw(g); setConfirm(g); }}>Generate</Button>
          </div>
        </Field>
        <Field label="Repeat it"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        <p className="font-ui text-ink-3 m-0" style={{ fontSize: 'var(--d-sm)' }}>Tell the technician the new password; it is not emailed.</p>
      </div>
    </Drawer>
  );
}
