// Cost Components
import { BarChart3 } from 'lucide-react';

export default function CostSummary({ ticket }) {
    if (!ticket) return null;
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" /> Cost Breakdown
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-500">Initial Cost</div>
            <div className="text-xl font-bold">${parseFloat(ticket.initial_cost).toFixed(2)}</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-500">Parts Total</div>
            <div className="text-xl font-bold">${parseFloat(ticket.parts_total).toFixed(2)}</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-sm text-gray-500">Services</div>
            <div className="text-xl font-bold">${parseFloat(ticket.services_total).toFixed(2)}</div>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="text-sm text-blue-600 font-bold">Grand Total</div>
            <div className="text-2xl font-bold text-blue-700">${parseFloat(ticket.grand_total).toFixed(2)}</div>
          </div>
        </div>
      </div>
    );
  }
  