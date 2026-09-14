import type { ReactNode } from 'react';
import { FileText, Info, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { getArchiveSummary } from './batchArchiveModel';
import { archiveDocumentLabels, archiveVersionLabels, type ArchiveDocument, type ArchiveDocumentKind, type ArchiveTab, type BatchArchive } from './batchArchiveTypes';
import './batch-archive-sections.css';

export interface BatchArchiveSectionsProps {
  batch: BatchArchive;
  tab: ArchiveTab;
  onViewDocument: (id: string) => void;
  onEditScope: (id: string) => void;
  readOnly?: boolean;
}

const documentGroups: Record<Exclude<ArchiveTab, 'overview' | 'versions'>, { title: string; description: string; kinds: ArchiveDocumentKind[] }[]> = {
  production: [
    { title: '派工记录', description: '派工是计划安排，实际完成以现场报工为准。', kinds: ['dispatch'] },
    { title: '现场报工', description: '保留各工序与计量单位；组件和工序完成量不相加为整机台数。', kinds: ['production'] },
  ],
  inspections: [
    { title: '首次检验', description: '保留首次检验结果；后续复验不回填首次合格率。', kinds: ['inspection'] },
    { title: '复验记录', description: '查看原检验与整改依据，复验通过量单独记录。', kinds: ['reinspection'] },
    { title: '质量授权放行', description: '放行依据单独保留；检验合格不自动代表放行或出货。', kinds: ['release'] },
  ],
  exceptions: [{ title: '不良处置记录', description: '沿原异常归集处理与验证；转交记录不重复增加不良件数。', kinds: ['exception'] }],
  materials: [
    { title: '领料记录', description: '查看领料原单及材料批次，保留实际领用数量与单位。', kinds: ['issue'] },
    { title: '退料记录', description: '退回数量与接收状态以原单为准；不直接视为合格可用库存。', kinds: ['return'] },
  ],
  shipments: [{ title: '实际出货原单', description: '按实际出货日期归集；草稿、冲销及有效出货保留各自状态。', kinds: ['shipment'] }],
};

export function BatchArchiveSections({ batch, tab, onViewDocument, onEditScope, readOnly = false }: BatchArchiveSectionsProps) {
  const { t } = useI18n();
  const summary = getArchiveSummary(batch);
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const quantity = (value: number | null, unit = '台') => value === null ? t('待确认') : `${number(value)} ${t(unit)}`;
  const known = (value: string) => value.trim() ? value : <span className="bas-pending">{t('待确认')}</span>;
  const source = (id: string) => batch.documents.find((item) => item.id === id);

  function heading(title: string, description?: string, trailing?: ReactNode) {
    return <header className="bas-heading"><div><h2>{t(title)}</h2>{description && <p>{t(description)}</p>}</div>{trailing}</header>;
  }
  function sourceButton(id: string) {
    const document = source(id);
    return document ? <Button key={id} variant="link" size="sm" className="bas-source" onClick={() => onViewDocument(id)} aria-label={t('查看原单 {code}', { code: document.code })}>{document.code}</Button> : <span key={id} className="bas-pending">{t('原单待补齐')}</span>;
  }
  function cell(label: string, content: ReactNode, className?: string) {
    return <td data-label={t(label)} className={className}>{content}</td>;
  }
  function empty(title: string, note = '当前批次尚未归集这类记录，可切换其他标签查看已有资料。') {
    return <div className="bas-empty"><FileText className="size-5" aria-hidden="true" /><div><strong>{t(title)}</strong><p>{t(note)}</p></div></div>;
  }
  function documentTable(rows: ArchiveDocument[], label: string) {
    if (!rows.length) return empty('暂无关联记录');
    return <div className="bas-table-wrap"><table className="bas-table bas-doc-table"><caption className="sr-only">{t(label)}</caption><thead><tr>{['单据 / 类型', '日期', '数量', '状态', '经办人', '操作'].map((label) => <th scope="col" key={label}>{t(label)}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      {cell('单据 / 类型', <><strong>{row.code}</strong><p>{t(archiveDocumentLabels[row.kind])} · {t(row.title)}</p></>)}
      {cell('日期', <span className="bas-numeric">{row.date || t('待补齐')}</span>)}
      {cell('数量', <span className={cn('bas-numeric', row.quantity === null && 'bas-pending')}>{quantity(row.quantity, row.unit)}</span>)}
      {cell('状态', <span className={cn('bas-status', `bas-status-${row.tone}`)}>{t(row.status)}</span>)}
      {cell('经办人', known(row.actor))}
      {cell('操作', <Button size="sm" variant="outline" onClick={() => onViewDocument(row.id)} aria-label={t('查看原单 {code}', { code: row.code })}>{t('查看原单')}</Button>)}
    </tr>)}</tbody></table></div>;
  }
  function materialTable() {
    if (!batch.materials.length) return empty('暂无关键物料关联', '材料批次和用料依据待补齐；现有批次资料仍可继续查看。');
    return <div className="bas-table-wrap"><table className="bas-table bas-material-table"><caption className="sr-only">{t('关键物料批次与来源')}</caption><thead><tr>{['物料 / 规格', '供应商 / 批次', '用量 / 台', '已领 / 已退', '原单依据'].map((label) => <th scope="col" key={label}>{t(label)}</th>)}</tr></thead><tbody>{batch.materials.map((material) => <tr key={material.id}>
      {cell('物料 / 规格', <><strong>{material.name}</strong><p>{material.code} · {material.spec || t('规格待确认')}</p></>)}
      {cell('供应商 / 批次', <>{known(material.supplier)}<p className={cn(!material.materialBatch && 'bas-pending')}>{material.materialBatch || t('材料批次待补齐')}</p>{material.serialNumbers.length > 0 && <details className="bas-inline-details"><summary>{t('材料 SN')} · {number(material.serialNumbers.length)}</summary><ul className="bas-serial-list">{material.serialNumbers.map((sn) => <li key={sn}>{sn}</li>)}</ul></details>}</>)}
      {cell('用量 / 台', <span className={cn('bas-numeric', material.perUnitQty === null && 'bas-pending')}>{quantity(material.perUnitQty, material.unit)}</span>)}
      {cell('已领 / 已退', <div className="bas-numeric">{quantity(material.issuedQty, material.unit)}<p>{t('已退')} {quantity(material.returnedQty, material.unit)}</p></div>)}
      {cell('原单依据', <div className="bas-source-list">{material.sourceDocumentIds.length ? material.sourceDocumentIds.map(sourceButton) : <span className="bas-pending">{t('待补齐')}</span>}</div>)}
    </tr>)}</tbody></table></div>;
  }

  if (tab === 'overview') {
    const facts: [string, ReactNode][] = [
      ['生产批次', batch.batchNo], ['关联计划', batch.planNo], ['产品名称', batch.productName], ['产品型号', batch.productCode],
      ['生产产线', known(batch.line)], ['批次负责人', known(batch.owner)], ['开始日期', batch.startDate || t('待确认')], ['计划数量', quantity(batch.plannedQty)],
    ];
    return <div className="bas-sections">
      <section>{heading('批次基本资料')}<dl className="bas-facts">{facts.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl></section>
      <section>{heading('资料完整情况', '版本范围按软件、硬件与 BOM 三项核对；已有 SN 单独记录。')}<div className="bas-completeness"><div><span>{t('完整版本范围')}</span><strong>{quantity(summary.versionConfirmed)}</strong></div><div><span>{t('版本待确认')}</span><strong className={cn(summary.versionPending > 0 && 'bas-pending')}>{quantity(summary.versionPending)}</strong></div><div><span>{t('已有整机 SN')}</span><strong>{number(summary.snKnown)} {t('个')}</strong></div><div><span>{t('整机 SN 待补齐')}</span><strong className={cn(summary.snMissing > 0 && 'bas-pending')}>{quantity(summary.snMissing)}</strong></div></div></section>
      <section>{heading('已有整机 SN', '仅展示原记录中已有的关联；材料 SN 不计入整机数量。')}{batch.serials.length ? <details className="bas-known-serials"><summary>{t('查看 {count} 个 SN 及原单', { count: batch.serials.length })}</summary><ul>{batch.serials.map((item) => <li key={`${item.sn}-${item.sourceDocumentId}`}><span className="bas-numeric">{item.sn}</span>{sourceButton(item.sourceDocumentId)}</li>)}</ul></details> : empty('整机 SN 待补齐', '当前保留批次记录，尚无可查询的整机 SN 清单。')}</section>
      <p className="bas-note"><Info className="size-4" aria-hidden="true" /><span>{t('资料来源')}：{batch.sourceLabel} · {t('来源时间')}：{batch.sourceAt ? new Date(batch.sourceAt).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false }) : t('待补齐')}</span></p>
    </div>;
  }

  if (tab === 'versions') {
    return <div className="bas-sections">
      <section>{heading('批内版本范围', '各范围保留实际适用的历史版本；未确认范围单独提示。', readOnly && <span className="bas-status bas-status-neutral">{t('只读')}</span>)}
        <div className="bas-coverage" aria-label={t('批内版本完整情况')}><div className="bas-coverage-labels"><span>{t('完整版本范围')} <strong>{quantity(summary.versionConfirmed)}</strong></span><span>{t('待确认')} <strong className={cn(summary.versionPending > 0 && 'bas-pending')}>{quantity(summary.versionPending)}</strong></span></div><div className="bas-coverage-bar" aria-hidden="true"><span style={{ width: `${batch.completedQty > 0 ? Math.min(100, summary.versionConfirmed / batch.completedQty * 100) : 0}%` }} /></div><p>{t('按软件、硬件与 BOM 三项核对本批完工范围；已有 SN 数量单独记录。')}</p></div>
        {batch.versionScopes.length ? <div className="bas-table-wrap"><table className="bas-table bas-version-table"><caption className="sr-only">{t('批内版本范围')}</caption><thead><tr>{['适用范围', '数量', '软件', '硬件', 'BOM', '原单依据', '操作'].map((label) => <th scope="col" key={label}>{t(label)}</th>)}</tr></thead><tbody>{batch.versionScopes.map((scope) => <tr key={scope.id}>
          {cell('适用范围', <><strong>{scope.name}</strong><details className="bas-inline-details"><summary>{t('其他版本与 SN')}</summary><dl className="bas-scope-details">{(['drawing', 'sop', 'sip'] as const).map((key) => <div key={key}><dt>{t(archiveVersionLabels[key])}</dt><dd>{known(scope.versions[key])}</dd></div>)}</dl><p>{t('已关联 SN')}：{number(scope.serialNumbers.length)} {t('个')}</p>{scope.serialNumbers.length ? <ul className="bas-serial-list">{scope.serialNumbers.map((sn) => <li key={sn}>{sn}</li>)}</ul> : <p className="bas-pending">{t('整机 SN 待补齐')}</p>}</details></>)}
          {cell('数量', <span className="bas-numeric">{quantity(scope.quantity)}</span>)}
          {cell('软件', known(scope.versions.software))}{cell('硬件', known(scope.versions.hardware))}{cell('BOM', known(scope.versions.bom))}
          {cell('原单依据', <div className="bas-source-list">{scope.evidenceIds.length ? scope.evidenceIds.map(sourceButton) : <span className="bas-pending">{t('待补齐')}</span>}</div>)}
          {cell('操作', <Button size="sm" variant="outline" disabled={readOnly} onClick={() => onEditScope(scope.id)} aria-label={t('修订范围 {name}', { name: scope.name })}><Pencil className="size-3.5" aria-hidden="true" />{t('修订')}</Button>)}
        </tr>)}</tbody></table></div> : empty('版本范围待确认', readOnly ? '当前为只读查看，实际版本与适用数量尚待归集。' : '可通过右侧补充版本范围，登记已有依据与适用数量。')}
      </section>
      <section>{heading('关键物料批次 / SN', '保留材料批次与领退料原单；尚未建立逐台用料映射。')}{materialTable()}</section>
    </div>;
  }

  return <div className="bas-sections">{documentGroups[tab].map((group) => <section key={group.title}>{heading(group.title, group.description)}{documentTable(batch.documents.filter((document) => group.kinds.includes(document.kind)).sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code)), group.title)}</section>)}{tab === 'materials' && <section>{heading('关联材料批次', '领料与退料分别保留；以下数量不代表当前可用库存。')}{materialTable()}</section>}</div>;
}
