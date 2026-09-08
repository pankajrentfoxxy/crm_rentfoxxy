import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { PageHeader } from '../../../components/ui/primitives';
import { partCategoryLabel } from '../../../constants/laptopConditions';
import { fetchPhysicalInward } from '../physicalDeadPartApi';
import { fmtDate, physicalPhotoList, physicalUploadUrl } from '../physicalDeadPartUi';

export default function PhysicalPartInwardDetailPage() {
  const { inwardNumber } = useParams();
  const decoded = decodeURIComponent(inwardNumber || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchPhysicalInward(decoded);
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load inward');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [decoded]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="p-8 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></p>;
  if (!data?.inward) {
    return (
      <div className="p-6">
        <p className="text-red-600">Inward not found</p>
        <Link to="/inventory-management/physical-parts" className="text-blue-700 text-sm">Back</Link>
      </div>
    );
  }

  const { inward, parts } = data;
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title={inward.inward_number}
        subtitle={`${parts.length} part(s) · ${inward.warehouse}`}
        actions={(
          <Link to="/inventory-management/physical-parts" className="inline-flex items-center gap-1.5 text-sm text-blue-700">
            <ArrowLeft className="w-4 h-4" /> Inventory
          </Link>
        )}
      />
      <div className="rounded-2xl border bg-white p-4 shadow-sm text-sm grid sm:grid-cols-2 gap-2">
        <p><span className="text-slate-500">Date:</span> {fmtDate(inward.inward_date)}</p>
        <p><span className="text-slate-500">By:</span> {inward.created_by_name || '—'}</p>
        <p className="sm:col-span-2"><span className="text-slate-500">Reason:</span> {inward.inward_reason}</p>
        {inward.remarks ? <p className="sm:col-span-2"><span className="text-slate-500">Remarks:</span> {inward.remarks}</p> : null}
      </div>
      <div className="overflow-x-auto border rounded-xl bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">DP</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2">Photo</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.part_id} className="border-t">
                <td className="px-3 py-2 font-mono font-semibold">{p.dp_number}</td>
                <td className="px-3 py-2">
                  {p.part_name} · {partCategoryLabel(p.category)}
                  {p.serial_number ? <span className="block text-xs font-mono text-slate-500">{p.serial_number}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {physicalPhotoList(p).map((src) => (
                      <a key={src} href={physicalUploadUrl(src)} target="_blank" rel="noreferrer">
                        <img src={physicalUploadUrl(src)} alt="" className="h-12 w-12 object-cover rounded border" />
                      </a>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${p.status === 'out' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-800'}`}>
                    {p.status_label}
                  </span>
                  {p.outward_number ? (
                    <Link to={`/inventory-management/physical-parts/outward/${encodeURIComponent(p.outward_number)}`} className="block text-[11px] font-mono text-blue-700 mt-1">
                      {p.outward_number}
                    </Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
