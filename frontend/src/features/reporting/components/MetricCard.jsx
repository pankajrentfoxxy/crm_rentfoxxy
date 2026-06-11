import React from 'react';
import { METRIC_COLORS, METRIC_BG } from '../reportingUtils';

export default function MetricCard({ title, value, subtitle, trend: trendData, icon: Icon, color = 'blue' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{title}</p>
          <p className={`text-2xl font-bold mt-1 ${METRIC_COLORS[color] || METRIC_COLORS.blue}`}>{value}</p>
          {subtitle ? <p className="text-xs text-gray-400 mt-1">{subtitle}</p> : null}
        </div>
        {Icon ? (
          <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${METRIC_BG[color] || METRIC_BG.blue}`}>
            <Icon className="w-5 h-5" />
          </div>
        ) : null}
      </div>
      {trendData ? (
        <p className={`text-xs mt-3 ${trendData.up ? 'text-green-600' : 'text-red-600'}`}>
          {trendData.up ? '↑' : '↓'} {trendData.pct}% vs last period
        </p>
      ) : null}
    </div>
  );
}
