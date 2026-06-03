import React from 'react';
export function StatItem({
  label,
  value,
  color




}: {label: string;value: string | number;color: 'blue' | 'rose' | 'emerald' | 'amber';}) {
  const colorMap = {
    blue: 'text-blue-700 bg-blue-50',
    rose: 'text-rose-700 bg-rose-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    amber: 'text-amber-700 bg-amber-50'
  };
  const dotColorMap = {
    blue: 'bg-blue-500',
    rose: 'bg-rose-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500'
  };
  return (
    <div
      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm ${colorMap[color]}`}>
      
      <span className={`w-1.5 h-1.5 rounded-full ${dotColorMap[color]}`}></span>
      <span className="font-medium">{label}</span>
      <span className="font-bold ml-0.5">{value}</span>
    </div>);

}