import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2, FileText, PenLine, ArrowLeft } from 'lucide-react';
import { getChallan } from '../supportPartsApi';
import ESignChallanModal from '../components/ESignChallanModal';
import { usePartsBase } from '../partsBase';
import { uploadBase } from '../../../components/support/utils';

const fileUrl = (p) => (p ? `${uploadBase()}/${p}` : null);

const STATUS_PILL = {
  issued: 'bg-green-100 text-green-800',
  draft: 'bg-amber-100 text-amber-800',
  fully_returned: 'bg-gray-100 text-gray-700',
  partially_returned: 'bg-blue-100 text-blue-700',
};

const RETURN_PILL = {
  used: 'bg-green-100 text-green-700',
  returned: 'bg-gray-100 text-gray-600',
  held: 'bg-blue-100 text-blue-700',
};

export default function ChallanViewPage() {
  const { challanId } = useParams();
  const base = usePartsBase();
  const [challan, setChallan] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSign, setShowSign] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getChallan(challanId)
      .then((r) => { setChallan(r.data.challan); setItems(r.data.items || []); })
      .catch(() => setChallan(null))
      .finally(() => setLoading(false));
  }, [challanId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[#534AB7]" />
      </div>
    );
  }
  if (!challan) return <p className="text-slate-600 p-4">Challan not found.</p>;

  const canSign = ['draft', 'challan_generated'].includes(challan.status);

  return (
    <div className="max-w-2xl mx-auto p-4">
      <Link to={`${base}/tech-bucket`} className="inline-flex items-center gap-1 text-sm text-[#534AB7] mb-3 min-h-[44px]">
        <ArrowLeft className="w-4 h-4" /> Back to bucket
      </Link>

      <div className="bg-white rounded-2xl border p-5 mb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono font-bold text-[#534AB7] text-lg">{challan.challan_number}</p>
            <p className="text-xs text-gray-500 mt-0.5">Support Part Challan</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold capitalize ${STATUS_PILL[challan.status] || 'bg-gray-100 text-gray-700'}`}>
            {String(challan.status).replace(/_/g, ' ')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-xs text-gray-400">Issued to</p>
            <p className="font-semibold text-sm">{challan.tech_name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Support ticket</p>
            <p className="font-semibold text-sm">{challan.ticket_number}</p>
            <p className="text-xs text-gray-500">{challan.customer_name}</p>
          </div>
          {challan.ttspl_id && (
            <div>
              <p className="text-xs text-gray-400">Laptop (TTSPL)</p>
              <p className="font-mono font-bold text-sm text-[#534AB7]">{challan.ttspl_id}</p>
            </div>
          )}
          {challan.issued_at && (
            <div>
              <p className="text-xs text-gray-400">Issued at</p>
              <p className="text-sm">{new Date(challan.issued_at).toLocaleString('en-IN')}</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border p-4 mb-4">
        <p className="font-semibold text-sm text-gray-900 mb-3">Parts in this challan</p>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <p className="font-mono text-xs text-[#534AB7]">{item.prt_id || '-'}</p>
                <p className="font-medium text-sm">{item.part_name}</p>
                <p className="text-xs text-gray-400">Qty: {item.quantity}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RETURN_PILL[item.return_status] || 'bg-gray-100 text-gray-600'}`}>
                {item.return_status}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl border p-4">
          <p className="text-xs text-gray-500 mb-2">Technician signature</p>
          {challan.tech_esign_url ? (
            <img src={fileUrl(challan.tech_esign_url)} alt="Tech sign" className="w-full max-h-24 object-contain" />
          ) : (
            <div className="h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center">
              <p className="text-xs text-gray-300">Not signed</p>
            </div>
          )}
          {challan.tech_esign_at && (
            <p className="text-[10px] text-gray-400 mt-1">{new Date(challan.tech_esign_at).toLocaleString('en-IN')}</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border p-4">
          <p className="text-xs text-gray-500 mb-2">Warehouse signature</p>
          {challan.wh_esign_url ? (
            <img src={fileUrl(challan.wh_esign_url)} alt="WH sign" className="w-full max-h-24 object-contain" />
          ) : (
            <div className="h-16 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center">
              <p className="text-xs text-gray-300">Not signed</p>
            </div>
          )}
          {challan.wh_esign_at && (
            <p className="text-[10px] text-gray-400 mt-1">{new Date(challan.wh_esign_at).toLocaleString('en-IN')}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {canSign && (
          <button
            type="button"
            onClick={() => setShowSign(true)}
            className="w-full py-4 min-h-[44px] bg-[#534AB7] text-white rounded-2xl font-bold text-base active:scale-[0.98] inline-flex items-center justify-center gap-2"
          >
            <PenLine className="w-5 h-5" /> Sign challan (technician)
          </button>
        )}
        {challan.pdf_path && (
          <a
            href={fileUrl(challan.pdf_path)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3.5 min-h-[44px] border-2 border-[#534AB7]/30 text-[#534AB7] rounded-2xl font-semibold text-sm inline-flex items-center justify-center gap-2 hover:bg-[#534AB7]/5"
          >
            <FileText className="w-4 h-4" /> View / download PDF
          </a>
        )}
      </div>

      {showSign && (
        <ESignChallanModal
          challan={challan}
          mode="tech"
          onSigned={() => { setShowSign(false); load(); }}
          onClose={() => setShowSign(false)}
        />
      )}
    </div>
  );
}
