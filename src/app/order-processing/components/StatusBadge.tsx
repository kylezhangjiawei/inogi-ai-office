import React from 'react';
export function StatusBadge({ type, text }: {type: string;text: string;}) {
  const styles =
  {
    success: 'text-emerald-700 bg-emerald-50',
    warning: 'text-amber-700 bg-amber-50',
    error: 'text-rose-700 bg-rose-50',
    info: 'text-blue-700 bg-blue-50'
  }[type] || 'text-slate-700 bg-slate-50';
  return (
    <span
      className={`px-2.5 py-1 text-[10px] font-medium rounded-full ${styles}`}>
      
      {text}
    </span>);

}