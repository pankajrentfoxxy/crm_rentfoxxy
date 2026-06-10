import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, User } from 'lucide-react';
import { TELEPHONE_CODES } from '../../constants/telephoneCodes';
import { getBackendOrigin } from '../../utils/api';
import {
  createDeliveryTechnician,
  fetchDeliveryTechnician,
  fetchTechnicianAddMeta,
  updateDeliveryTechnician,
} from '../../utils/deliveryRegisterApi';

const IDENTITY_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
  { value: 'nid', label: 'NID' },
  { value: 'company_id', label: 'Company ID' },
];

const emptyForm = {
  first_name: '',
  last_name: '',
  country_code: '91',
  phone: '',
  identity_type: 'passport',
  identity_number: '',
  address: '',
  email: '',
  password: '',
  confirm_password: '',
};

function technicianImageUrl(filename) {
  if (!filename) return null;
  const origin = getBackendOrigin().replace(/\/$/, '');
  return `${origin}/uploads/delivery-man/${filename.replace(/^\//, '')}`;
}

export default function DeliveryTechnicianFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(emptyForm);
  const [profilePreview, setProfilePreview] = useState(null);
  const [profileFile, setProfileFile] = useState(null);
  const [identityFiles, setIdentityFiles] = useState([]);
  const [existingIdentity, setExistingIdentity] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit) {
      fetchTechnicianAddMeta()
        .then((data) => {
          if (data.generated_password) {
            setForm((f) => ({
              ...f,
              password: data.generated_password,
              confirm_password: data.generated_password,
            }));
          }
        })
        .catch(() => {});
      return;
    }

    setLoading(true);
    fetchDeliveryTechnician(id)
      .then((data) => {
        const t = data.data;
        setForm({
          first_name: t.first_name || '',
          last_name: t.last_name || '',
          country_code: t.country_code || '91',
          phone: t.phone || '',
          identity_type: t.identity_type || 'passport',
          identity_number: t.identity_number || '',
          address: t.address || '',
          email: t.email || '',
          password: '',
          confirm_password: '',
        });
        setProfilePreview(technicianImageUrl(t.image));
        setExistingIdentity((t.identity_image || []).map((img) => technicianImageUrl(img)));
      })
      .catch((e) => setError(e.response?.data?.message || 'Failed to load technician'))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const onProfileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProfileFile(file);
    setProfilePreview(URL.createObjectURL(file));
  };

  const onIdentityChange = (e) => {
    setIdentityFiles(Array.from(e.target.files || []));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First and last name are required');
      return;
    }
    if (!form.phone.trim()) {
      setError('Phone is required');
      return;
    }
    if (!form.email.trim()) {
      setError('Email is required');
      return;
    }
    if (!isEdit && !profileFile) {
      setError('Profile image is required');
      return;
    }
    if (!isEdit && (!form.password || form.password.length < 8)) {
      setError('Password must be at least 8 characters');
      return;
    }

    const fd = new FormData();
    fd.append('first_name', form.first_name.trim());
    fd.append('last_name', form.last_name.trim());
    fd.append('country_code', form.country_code);
    fd.append('phone', form.phone.trim());
    fd.append('identity_type', form.identity_type);
    fd.append('identity_number', form.identity_number.trim());
    fd.append('address', form.address);
    fd.append('email', form.email.trim());
    if (!isEdit) {
      fd.append('password', form.password);
    }
    if (profileFile) fd.append('image', profileFile);
    identityFiles.forEach((f) => fd.append('identity_image', f));

    setSaving(true);
    try {
      if (isEdit) {
        await updateDeliveryTechnician(id, fd);
      } else {
        await createDeliveryTechnician(fd);
      }
      navigate('/delivery-register-management/technicians');
    } catch (err) {
      setError(err.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="mb-6">
        <Link to="/delivery-register-management/technicians" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-teal-700 mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to list
        </Link>
        <h1 className="text-2xl font-semibold text-gray-800 flex items-center gap-2">
          <User className="w-6 h-6 text-teal-700" />
          {isEdit ? 'Update Deliveryman' : 'Add Technician'}
        </h1>
      </div>

      {error ? <p className="text-red-600 text-sm mb-4">{error}</p> : null}

      <form onSubmit={submit} className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 border-b pb-3 mb-4">General Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">First Name<span className="text-red-500">*</span></label>
              <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Last Name<span className="text-red-500">*</span></label>
              <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Phone<span className="text-red-500">*</span></label>
              <div className="flex gap-2 mt-1">
                <select className="border rounded-lg px-2 py-2 text-sm w-36" value={form.country_code}
                  onChange={(e) => setForm((f) => ({ ...f, country_code: e.target.value }))}>
                  {TELEPHONE_CODES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
                <input required className="flex-1 border rounded-lg px-3 py-2 text-sm" value={form.phone}
                  maxLength={10} inputMode="numeric" placeholder="Enter 10 digits"
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Identity Type</label>
              <select className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.identity_type}
                onChange={(e) => setForm((f) => ({ ...f, identity_type: e.target.value }))}>
                {IDENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Identity Number<span className="text-red-500">*</span></label>
              <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.identity_number}
                onChange={(e) => setForm((f) => ({ ...f, identity_number: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Address</label>
              <textarea rows={2} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div>
              <label className="text-xs font-medium text-gray-600">
                Technician Profile Pic<span className="text-red-500">*</span>
                <span className="text-gray-400 ml-1">(ratio 1:1)</span>
              </label>
              <input type="file" accept="image/*" className="w-full mt-1 text-sm" onChange={onProfileChange}
                required={!isEdit} />
              {profilePreview ? (
                <img src={profilePreview} alt="Profile preview" className="mt-3 w-32 h-32 rounded-lg object-cover border mx-auto" />
              ) : null}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Identity Image</label>
              <input type="file" accept="image/*" multiple className="w-full mt-1 text-sm" onChange={onIdentityChange} />
              {existingIdentity.length && !identityFiles.length ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {existingIdentity.map((src) => (
                    <img key={src} src={src} alt="Identity" className="w-24 h-24 object-cover rounded border" />
                  ))}
                </div>
              ) : null}
              {identityFiles.length ? (
                <p className="text-xs text-gray-500 mt-2">{identityFiles.length} new file(s) selected</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 border-b pb-3 mb-4">Account Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Email<span className="text-red-500">*</span></label>
              <input type="email" required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            {!isEdit ? (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600">Password</label>
                  <input readOnly className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-gray-50" value={form.password} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Confirm Password</label>
                  <input readOnly className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-gray-50" value={form.confirm_password} />
                </div>
              </>
            ) : null}
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={() => navigate('/delivery-register-management/technicians')}
              className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
