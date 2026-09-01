import React from 'react';
import { AutoTranslatedText } from '../../components/TranslatableText';
import { t, useI18n } from '../../lib/i18n';
export function StatusBadge({ type, text }: {type: string;text: string;}) {
  useI18n();
  const styles =
  {
    success: 'text-emerald-700 bg-emerald-50',
    warning: 'text-amber-700 bg-amber-50',
    error: 'text-rose-700 bg-rose-50',
    info: 'text-blue-700 bg-blue-50'
  }[type] || 'text-slate-700 bg-slate-50';
  return (
    <span
      className={`order-horizon-status-badge rounded-lg px-2.5 py-1 text-xs font-medium ${styles}`}>
      
      <AutoTranslatedText text={t(text.trim())} />
    </span>);

}
