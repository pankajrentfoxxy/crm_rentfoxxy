import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { sendDeliveryOtp, submitDeliveryRegister, verifyDeliveryOtp } from '../../utils/salesManagementApi';

export default function DeliveryRegisterPage() {
  const { dcNumber } = useParams();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [remark, setRemark] = useState('');
  const [delivered, setDelivered] = useState('');
  const [message, setMessage] = useState('');

  const sendOtp = async () => {
    await sendDeliveryOtp(dcNumber, { email, name: 'Customer' });
    setMessage('OTP sent');
  };

  const verifyOtp = async () => {
    await verifyDeliveryOtp(dcNumber, { otp });
    setMessage('OTP verified');
  };

  const complete = async () => {
    await submitDeliveryRegister(dcNumber, {
      delivered_serial_numbers: delivered.split(',').map((s) => s.trim()).filter(Boolean),
      rejected_serial_numbers: [],
      submitted_remark: remark,
      status: 'delivered',
    });
    setMessage('Delivery registered');
  };

  return (
    <div className="max-w-xl mx-auto p-4">
      <Link to="/operation-management/delivery-challans" className="text-sm text-blue-600">← Back</Link>
      <h1 className="text-2xl font-semibold mt-3 mb-4">Delivery Register — {dcNumber}</h1>
      <div className="bg-white border rounded-xl p-5 space-y-3">
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Customer email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="button" onClick={sendOtp} className="px-3 py-2 border rounded text-sm">Send OTP</button>
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="OTP" value={otp} onChange={(e) => setOtp(e.target.value)} />
        <button type="button" onClick={verifyOtp} className="px-3 py-2 border rounded text-sm">Verify OTP</button>
        <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Delivered serials (comma separated)" value={delivered} onChange={(e) => setDelivered(e.target.value)} />
        <textarea className="w-full border rounded px-3 py-2 text-sm" placeholder="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
        <button type="button" onClick={complete} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Mark delivered</button>
        {message ? <p className="text-green-700 text-sm">{message}</p> : null}
      </div>
    </div>
  );
}
