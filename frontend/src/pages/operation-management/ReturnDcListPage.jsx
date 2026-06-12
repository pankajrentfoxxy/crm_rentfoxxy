import React, { useEffect, useState } from 'react';
import { assignReturnDcNumber, fetchReturnDeliveryChallans } from '../../utils/salesManagementApi';

export default function ReturnDcListPage() {
  const [rows, setRows] = useState([]);
  const [ticketId, setTicketId] = useState('');

  const load = () => fetchReturnDeliveryChallans().then((d) => setRows(d.orders || []));

  useEffect(() => { load(); }, []);

  const assign = async () => {
    if (!ticketId) return;
    await assignReturnDcNumber(ticketId);
    setTicketId('');
    load();
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-4">Return Delivery Challan</h1>
      <div className="flex gap-2 mb-4">
        <input className="border rounded px-3 py-2 text-sm" placeholder="Support ticket ID" value={ticketId} onChange={(e) => setTicketId(e.target.value)} />
        <button type="button" onClick={assign} className="px-3 py-2 bg-blue-600 text-white rounded text-sm">Assign RDC number</button>
      </div>
      <table className="min-w-full bg-white border rounded-xl text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">RDC#</th>
            <th className="px-4 py-3 text-left">Ticket</th>
            <th className="px-4 py-3 text-left">Serial</th>
            <th className="px-4 py-3 text-left">Customer</th>
            <th className="px-4 py-3 text-left">Closed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.ticket_id}-${row.return_dc_number}`} className="border-t">
              <td className="px-4 py-3 font-medium">{row.return_dc_number}</td>
              <td className="px-4 py-3">{row.ticket_id}</td>
              <td className="px-4 py-3">{row.serial_number}</td>
              <td className="px-4 py-3">{row.customer_name}</td>
              <td className="px-4 py-3">{row.closed_at ? new Date(row.closed_at).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
