import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Laptop } from 'lucide-react';
import { format } from 'date-fns';
import api from '../utils/api';

function inr(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

export default function LaptopsPage() {
  const [laptops, setLaptops] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/laptops').then(({ data }) => setLaptops(data.laptops || [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">My Laptops</h1>
        <p className="text-sm text-slate-500">{laptops.length} active rentals</p>
      </div>
      {loading ? (
        <p className="text-slate-500 animate-pulse">Loading…</p>
      ) : laptops.length === 0 ? (
        <p className="text-slate-500 bg-white border rounded-xl p-8 text-center">No laptops on record yet.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {laptops.map((lap) => (
            <div key={lap.ttspl_id || lap.dc_number} className="bg-white border rounded-xl p-5 shadow-sm space-y-2">
              <div className="flex items-center gap-2 text-brand font-semibold">
                <Laptop className="w-5 h-5" />
                {lap.ttspl_id || '—'}
              </div>
              <p className="font-medium">{lap.brand} {lap.model}</p>
              <p className="text-sm text-slate-600">{lap.config || '—'}</p>
              <p className="text-xs text-slate-500">
                Dispatched: {lap.dispatch_date ? format(new Date(lap.dispatch_date), 'dd MMM yyyy') : '—'}
              </p>
              <p className="text-sm">Monthly Rate: {inr(lap.monthly_rate)}/month</p>
              <p className="text-xs text-slate-500">DC: {lap.dc_number || '—'}</p>
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 capitalize">{lap.status || 'active'}</span>
              <div className="pt-2">
                <Link
                  to={`/support?ttspl=${encodeURIComponent(lap.ttspl_id || '')}`}
                  className="text-sm text-brand font-semibold hover:underline"
                >
                  Raise Support Ticket
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
