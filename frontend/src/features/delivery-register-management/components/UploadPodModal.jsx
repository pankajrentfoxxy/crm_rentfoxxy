import React, { useEffect, useMemo, useState } from 'react';
import SearchableMultiSelect from '../../operation-management/components/SearchableMultiSelect';
import {
  sendDeliveryRegisterOtp,
  submitDeliveryRegisterPod,
  verifyDeliveryRegisterOtp,
} from '../../../utils/deliveryRegisterApi';

function serialLabel(serial) {
  const parts = String(serial).split('|');
  if (parts.length >= 3) return `${parts[1]} | ${parts[2]}`;
  return serial;
}

export default function UploadPodModal({ open, onClose, row, deliveryPersons, onSuccess }) {
  const [datetime, setDatetime] = useState('');
  const [deliveryPersonId, setDeliveryPersonId] = useState('');
  const [submittedName, setSubmittedName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [delivered, setDelivered] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [remark, setRemark] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [otpMsg, setOtpMsg] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');

  const serialOptions = useMemo(
    () => (row?.all_serials || []).map((s) => ({
      value: JSON.stringify(s),
      label: serialLabel(s.serial),
    })),
    [row]
  );

  useEffect(() => {
    if (!open || !row) return;
    setDatetime(new Date().toISOString().slice(0, 16));
    setCustomerName(row.customer_name || '');
    setEmail(row.email || '');
    setMobile(row.customer_phone || '');
    setDeliveryPersonId(row.delivery_person_id ? String(row.delivery_person_id) : 'by_courier');
    setSubmittedName('');
    setOtp('');
    setOtpSent(false);
    setOtpVerified(false);
    setLatitude('');
    setLongitude('');
    setRemark('');
    setFiles([]);
    setError('');
    setOtpMsg('');
    setVerifyMsg('');
    const allValues = serialOptions.map((o) => o.value);
    setDelivered(allValues);
    setRejected([]);
  }, [open, row, serialOptions]);

  useEffect(() => {
    const person = (deliveryPersons || []).find((p) => String(p.id) === String(deliveryPersonId));
    if (person) setSubmittedName(person.name);
    else if (deliveryPersonId === 'by_courier') setSubmittedName('Admin');
  }, [deliveryPersonId, deliveryPersons]);

  if (!open || !row) return null;

  const personOptions = [
    { value: 'by_courier', label: 'By Courier' },
    ...(deliveryPersons || []).map((p) => ({ value: String(p.id), label: p.name })),
  ];

  const onDeliveredChange = (selected) => {
    setDelivered(selected);
    setRejected((prev) => prev.filter((v) => !selected.includes(v)));
  };

  const onRejectedChange = (selected) => {
    setRejected(selected);
    setDelivered((prev) => prev.filter((v) => !selected.includes(v)));
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(String(pos.coords.latitude));
        setLongitude(String(pos.coords.longitude));
      },
      () => setError('Unable to get location')
    );
  };

  const sendOtp = async () => {
    setOtpMsg('');
    try {
      const data = await sendDeliveryRegisterOtp(row.dc_number, { email, name: customerName });
      setOtpSent(true);
      setOtpMsg(data.message || 'OTP sent');
    } catch (e) {
      setOtpMsg(e.response?.data?.message || 'Failed to send OTP');
    }
  };

  const verifyOtp = async () => {
    setVerifyMsg('');
    try {
      const data = await verifyDeliveryRegisterOtp(row.dc_number, { otp });
      if (data.status === 'success' || data.success) {
        setOtpVerified(true);
        setVerifyMsg(data.message || 'OTP verified');
      } else {
        setVerifyMsg(data.message || 'Invalid OTP');
      }
    } catch (e) {
      setVerifyMsg(e.response?.data?.message || 'Verification failed');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!otpVerified) {
      setError('Please verify OTP before submitting');
      return;
    }
    if (!delivered.length && !rejected.length) {
      setError('Select delivered or rejected products');
      return;
    }
    if (!files.length) {
      setError('Upload at least one POD file');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('dc_number', row.dc_number);
      fd.append('datetime', datetime);
      fd.append('name', submittedName);
      fd.append('customer_name', customerName);
      fd.append('mobile', mobile);
      fd.append('email', email);
      fd.append('latitude', latitude);
      fd.append('longitude', longitude);
      fd.append('remark', remark);
      fd.append('delivery_person_id', deliveryPersonId);
      delivered.forEach((v) => fd.append('delivered_products', v));
      rejected.forEach((v) => fd.append('rejected_products', v));
      files.forEach((f) => fd.append('files', f));
      await submitDeliveryRegisterPod(row.dc_number, fd);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Submit failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">Upload POD</h2>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {(row.all_serials || []).map((s) => (
              <span key={s.serial} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900 text-xs">
                <span className="text-amber-400 font-medium">{serialLabel(s.serial).split('|')[0]?.trim()}</span>
                <span className="text-cyan-300">{serialLabel(s.serial).split('|')[1]?.trim()}</span>
              </span>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Date</label>
              <input type="datetime-local" required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Delivery Person Name<span className="text-red-500">*</span></label>
              <select required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={deliveryPersonId} onChange={(e) => setDeliveryPersonId(e.target.value)}>
                {personOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Customer Name</label>
              <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Customer Mobile</label>
              <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Customer Email</label>
              <input type="email" required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button type="button" onClick={sendOtp} className="text-xs text-cyan-700 mt-1 hover:underline">{otpSent ? 'Resend OTP' : 'Send OTP'}</button>
              {otpMsg ? <p className="text-xs text-gray-500 mt-0.5">{otpMsg}</p> : null}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Enter OTP<span className="text-red-500">*</span></label>
              <input required className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Enter OTP" />
              <button type="button" onClick={verifyOtp} className="text-xs text-cyan-700 mt-1 hover:underline">Verify OTP</button>
              {verifyMsg ? <p className={`text-xs mt-0.5 ${otpVerified ? 'text-green-600' : 'text-red-600'}`}>{verifyMsg}</p> : null}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Latitude</label>
              <input readOnly className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-gray-50" value={latitude} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Longitude</label>
              <input readOnly className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-gray-50" value={longitude} />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={getLocation} className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Get Location</button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SearchableMultiSelect
              id="pod-delivered"
              label="Delivered Products"
              required
              value={delivered}
              onChange={onDeliveredChange}
              options={serialOptions}
              placeholder="Select delivered"
            />
            <SearchableMultiSelect
              id="pod-rejected"
              label="Rejected Products"
              value={rejected}
              onChange={onRejectedChange}
              options={serialOptions}
              placeholder="Select rejected"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">Remark<span className="text-red-500">*</span></label>
            <textarea required rows={2} className="w-full mt-1 border rounded-lg px-3 py-2 text-sm" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600">Upload POD Files<span className="text-red-500">*</span></label>
            <input type="file" multiple required className="w-full mt-1 text-sm" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </div>

          {error ? <p className="text-red-600 text-sm">{error}</p> : null}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={saving || !otpVerified} className="px-4 py-2 bg-teal-700 text-white rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
