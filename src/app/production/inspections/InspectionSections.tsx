import type { ReactNode } from 'react';
import { ClipboardCheck, FileText, History, ImageIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import type { PlanningDocument } from '../planning/planningTypes';
import { canOperateInspection, getInspectionProgress, getReinspectable, getTransferable } from './inspectionModel';
import { inspectionActionLabels, type InspectionActionContext, type InspectionPhoto, type InspectionState, type InspectionView } from './inspectionTypes';
import './inspection-sections.css';

export interface InspectionSectionsProps {
  state: InspectionState;
  taskId: string;
  view: InspectionView;
  readOnly: boolean;
  actorId: string;
  onAction: (context: InspectionActionContext) => void;
  onPhoto: (photo: InspectionPhoto) => void;
  onDocument: (document: PlanningDocument) => void;
}

export function InspectionSections({ state, taskId, view, readOnly, actorId, onAction, onPhoto, onDocument }: InspectionSectionsProps) {
  const { t } = useI18n();
  const task = state.tasks.find((item) => item.id === taskId);
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const amount = (value: number) => `${number(value)} ${t(task?.unit ?? '')}`.trim();
  const person = (id: string) => state.actors.find((item) => item.id === id)?.name ?? t('人员待确认');
  const time = (value: string) => new Date(value).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false });
  const date = (value: string) => new Date(`${value}T00:00:00+08:00`).toLocaleDateString(i18nLocale(), { timeZone: 'Asia/Shanghai' });
  const heading = (title: string, description: string) => <header className="ins-heading"><h2>{t(title)}</h2><p>{t(description)}</p></header>;
  const empty = (title: string, description: string, action?: ReactNode) => <div className="ins-empty"><ClipboardCheck className="size-5" aria-hidden="true" /><div><strong>{t(title)}</strong><p>{t(description)}</p>{action}</div></div>;
  const badge = (label: string, tone: 'neutral' | 'positive' | 'pending' = 'neutral') => <span className={cn('ins-badge', `ins-badge-${tone}`)}>{t(label)}</span>;
  const field = (label: string, value: ReactNode) => <div><dt>{t(label)}</dt><dd>{value}</dd></div>;
  const button = (context: InspectionActionContext, code: string, label = inspectionActionLabels[context.kind]) => <Button type="button" size="sm" variant="outline" className="ins-action" aria-label={t('{label} {code}', { label: t(label), code })} onClick={() => onAction(context)}>{t(label)}</Button>;
  if (!task) return empty('未找到检验任务', '请从上方任务列表重新选择。');
  const records = state.records.filter((item) => item.taskId === task.id);
  const issues = state.issues.filter((item) => item.taskId === task.id);
  const releases = state.releases.filter((item) => item.taskId === task.id);
  const progress = getInspectionProgress(state, task.id);
  const can = (kind: InspectionActionContext['kind']) => !readOnly && canOperateInspection(state, actorId, task.id, kind) && (kind === 'accept' || Boolean(task.acceptedAt));
  const stage = task.stage === 'final' ? '终检' : '过程检';
  const photos = (items: InspectionPhoto[]) => items.length ? <div className="ins-photos" aria-label={t('检验现场照片')}>{items.map((photo) => <button key={photo.id} type="button" className="ins-photo" aria-label={t('查看照片 {name}', { name: photo.name })} onClick={() => onPhoto(photo)}><img src={photo.dataUrl} alt={photo.name} loading="lazy" /><span><ImageIcon className="size-3" aria-hidden="true" />{photo.name}</span></button>)}</div> : <p className="ins-muted">{t('未附现场照片')}</p>;

  if (view === 'records') return <div className="ins-sections"><section>{heading('本任务检验记录', '初检与复验分别留存。复验通过不改写首次结果，也不自动放行。')}{records.length ? <ol className="ins-record-list">{[...records].reverse().map((record) => {
    const original = records.find((item) => item.id === record.originalId);
    const issue = issues.find((item) => item.id === record.issueId);
    const sip = task.documents.find((item) => item.code === record.sipCode && item.version === record.sipVersion);
    const transferable = getTransferable(state, record.id);
    return <li className="ins-record" key={record.id}><header className="ins-record-heading"><div><div className="ins-record-title"><h3 className="ins-code">{record.code}</h3>{badge(record.kind === 'initial' ? '初检' : '复验')}{badge(stage)}</div><p className="ins-record-meta">{date(record.date)} · {person(record.actorId)}</p></div>{badge(record.conclusion === 'qualified' ? '本次合格' : '本次不合格', record.conclusion === 'qualified' ? 'positive' : 'pending')}</header><div className="ins-record-body"><dl className="ins-quantities">{field('检验量', amount(record.quantity))}{field('合格', amount(record.good))}{field('不良', amount(record.bad))}</dl><dl className="ins-context">{field('来源报工', <span className="ins-code">{task.reportCode}</span>)}{field('SIP 版本', <div className="ins-document"><span className="ins-code">{record.sipCode} · {record.sipVersion}</span>{sip ? <Button type="button" variant="link" size="sm" className="ins-source" aria-label={t('查看 SIP 摘要 {code} {version}', { code: sip.code, version: sip.version })} onClick={() => onDocument(sip)}><FileText className="size-3.5" aria-hidden="true" />{t('查看摘要')}</Button> : <span className="ins-muted">{t('此版本原件待接入')}</span>}</div>)}</dl></div>{record.kind === 'reinspection' ? <div className="ins-original"><span>{t('原检验')} · <strong className="ins-code">{original?.code ?? t('待核对')}</strong></span><span>{t('不良单')} · <strong className="ins-code">{issue?.code ?? t('待核对')}</strong></span><span>{t('处置依据')} · <strong className="ins-code">{issue?.dispositionCode ?? t('待补齐')}</strong></span></div> : null}<details className="ins-details"><summary>{t('查看检验证据、备注与照片')}</summary><div><dl className="ins-evidence">{field('检验证据', record.evidence || t('待补齐'))}{record.note ? field('检验备注', record.note) : null}{field('登记时间', time(record.at))}</dl>{photos(record.photos)}</div></details>{can('transfer') && transferable > 0 ? <div className="ins-row-actions"><span>{t('本记录有 {quantity} 待转不良处理', { quantity: amount(transferable) })}</span>{button({ kind: 'transfer', taskId: task.id, recordId: record.id }, record.code)}</div> : null}</li>;
  })}</ol> : empty('本任务暂无检验记录', task.acceptedAt ? '核对本次检验数量、SIP 版本和证据后登记初检。' : '请先接受报检，再登记检验结果。', can('inspect') && progress.uninspected > 0 ? button({ kind: 'inspect', taskId: task.id }, task.code) : undefined)}<p className="ins-note">{t('记录数量按本任务工序及单位核对；过程检与终检不相加作为整机产出。')}</p></section></div>;

  if (view === 'issues') {
    const untransferred = records.filter((item) => getTransferable(state, item.id) > 0);
    return <div className="ins-sections"><section>{heading('待转不良处理', '保留原检验不良范围，创建本页处理记录；不重复增加首次不良数量。')}{untransferred.length ? <ul className="ins-transfer-list">{untransferred.map((record) => <li key={record.id}><div><strong className="ins-code">{record.code}</strong><p>{t(record.kind === 'initial' ? '初检不良' : '复验不良')} · <span className="ins-numeric">{amount(getTransferable(state, record.id))}</span></p></div>{can('transfer') ? button({ kind: 'transfer', taskId: task.id, recordId: record.id }, record.code) : badge('待 QC 转处理', 'pending')}</li>)}</ul> : empty('当前没有待转的不良记录', '已有不良可在下方核对处置依据和复验范围。')}</section><section>{heading('不良处置与复验', '仅已具备处置依据的范围可复验；本页不代填处置结果。')}{issues.length ? <ol className="ins-issue-list">{[...issues].reverse().map((issue) => {
      const original = records.find((item) => item.id === issue.recordId);
      const remaining = getReinspectable(state, issue.id);
      const waiting = Math.max(0, issue.quantity - issue.readyQuantity);
      const related = records.filter((item) => item.issueId === issue.id);
      return <li className="ins-issue" key={issue.id}><header className="ins-record-heading"><div><h3>{issue.phenomenon}</h3><p className="ins-code">{issue.code} · {t('原检验')} {original?.code ?? t('待核对')}</p></div>{badge(remaining > 0 ? '有待复验范围' : issue.readyQuantity > 0 ? '本次复验已登记' : '待处置', remaining > 0 || !issue.readyQuantity ? 'pending' : 'neutral')}</header><dl className="ins-quantities">{field('原不良', amount(issue.quantity))}{field('已处置可复验', amount(issue.readyQuantity))}{field('尚待复验', amount(remaining))}</dl>{waiting > 0 ? <p className="ins-note">{t('另有 {quantity} 尚待处置，不可直接复验。', { quantity: amount(waiting) })}</p> : null}<dl className="ins-evidence">{field('处置单', <span className="ins-code">{issue.dispositionCode ?? t('尚无处置依据')}</span>)}{issue.dispositionNote ? field('处置说明', issue.dispositionNote) : null}{issue.disposedAt ? field('处置确认时间', time(issue.disposedAt)) : null}{issue.description ? field('不良说明', issue.description) : null}</dl>{related.length ? <div className="ins-retest-results"><span>{t('本处置范围的复验记录')}</span>{related.map((record) => <p key={record.id}><strong className="ins-code">{record.code}</strong> · {t('检验')} {amount(record.quantity)} · {t('合格')} {amount(record.good)} · {t('不良')} {amount(record.bad)}</p>)}</div> : null}<div className="ins-row-actions"><span>{person(issue.actorId)} · <time dateTime={issue.at}>{time(issue.at)}</time></span>{can('reinspect') && remaining > 0 ? button({ kind: 'reinspect', taskId: task.id, issueId: issue.id }, issue.code) : null}</div></li>;
    })}</ol> : empty('本任务暂无不良处理记录', untransferred.length ? '从上方原检验记录转不良处理后，可继续跟踪处置和复验。' : '本任务发生检验不良时，在这里查看其处理和复验依据。')}<p className="ins-note">{t('新增转处理记录仍待处置，不能立即复验。P08 处置与外部协同后续接入，本页不发送任务或更新其他页面。')}</p></section></div>;
  }

  if (view === 'releases') return <div className="ins-sections"><section>{heading('独立 QA 放行', '检验通过与质量授权分别记录，放行不代表实际出货。')}<dl className="ins-release-totals">{field('累计检验合格', amount(progress.qualified))}{field('已记录放行', amount(progress.released))}{field('当前可记录放行', amount(progress.releasable))}</dl><div className="ins-release-condition">{task.stage !== 'final' ? <p>{t('当前为过程检任务，不在本页记录整机质量放行。')}</p> : progress.uninspected > 0 ? <p>{t('本任务仍有 {quantity} 尚未初检，完成本任务初检后再核对放行。', { quantity: amount(progress.uninspected) })}</p> : progress.unresolved > 0 ? <p>{t('本任务仍有 {quantity} 未解决不良，当前不能记录放行。', { quantity: amount(progress.unresolved) })}</p> : <p>{t(task.closed ? '历史记录只读，原放行结论保持不变。' : '需由 QA 核对授权依据和本次放行范围，不能仅凭合格数量自动放行。')}</p>}{can('release') && progress.releasable > 0 ? button({ kind: 'release', taskId: task.id }, task.code) : null}</div>{releases.length ? <ol className="ins-release-list">{[...releases].reverse().map((release) => <li key={release.id}><header className="ins-record-heading"><div><h3 className="ins-code">{release.code}</h3><p>{person(release.actorId)} · <time dateTime={release.at}>{time(release.at)}</time></p></div><strong className="ins-release-quantity">{amount(release.quantity)}</strong></header><dl className="ins-evidence">{field('放行依据', release.basis)}{release.note ? field('放行说明', release.note) : null}</dl></li>)}</ol> : empty('本任务尚无 QA 放行记录', '检验合格后仍须由具备权限的 QA 根据授权依据单独确认。')}<p className="ins-note">{t('本页演示放行不更新库存、出货或 P09 档案；历史档案仅作独立来源参考。')}</p></section></div>;

  const events = state.events.filter((item) => item.taskId === task.id);
  return <div className="ins-sections"><section>{heading('本任务操作记录', '按操作时间保留接受报检、初检、转处理、复验与 QA 放行。')}{events.length ? <ol className="ins-history">{[...events].reverse().map((event) => <li key={event.id}><History className="size-4" aria-hidden="true" /><div><header><h3>{t(inspectionActionLabels[event.kind])}</h3><span>{person(event.actorId)} · <time dateTime={event.at}>{time(event.at)}</time></span></header><p>{event.summary}</p></div></li>)}</ol> : empty('本任务暂无操作记录', '完成检验操作后，可在这里核对人员、时间和结果。')}</section></div>;
}
