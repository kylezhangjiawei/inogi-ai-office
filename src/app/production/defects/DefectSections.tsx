import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, ClipboardCheck, History, ImageIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { canOperateDefect, getDefectProgress, getHandoffAvailable } from './defectModel';
import { defectActionLabels, defectDirectionLabels, type DefectActionContext, type DefectPhoto, type DefectState, type DefectView } from './defectTypes';
import './defect-sections.css';

export interface DefectSectionsProps {
  state: DefectState; issueId: string; view: DefectView; readOnly: boolean; actorId: string;
  onAction: (context: DefectActionContext) => void;
  onPhoto: (photo: DefectPhoto) => void;
}

export function DefectSections({ state, issueId, view, readOnly, actorId, onAction, onPhoto }: DefectSectionsProps) {
  const { t } = useI18n();
  const issue = state.issues.find((item) => item.id === issueId);
  const amount = (value: number) => `${value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 })} ${t(issue?.unit ?? '')}`.trim();
  const person = (id: string | null) => state.actors.find((item) => item.id === id)?.name ?? t('待指派');
  const time = (value: string) => new Date(value).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false });
  const date = (value: string) => new Date(`${value}T00:00:00+08:00`).toLocaleDateString(i18nLocale(), { timeZone: 'Asia/Shanghai' });
  const heading = (title: string, description: string) => <header className="dfs-heading"><h2>{t(title)}</h2><p>{t(description)}</p></header>;
  const empty = (title: string, description: string, action?: ReactNode) => <div className="dfs-empty"><ClipboardCheck className="size-5" aria-hidden="true" /><div><strong>{t(title)}</strong><p>{t(description)}</p>{action}</div></div>;
  const field = (label: string, value: ReactNode) => <div><dt>{t(label)}</dt><dd>{value}</dd></div>;
  const badge = (label: string, tone: 'neutral' | 'positive' | 'pending' = 'neutral') => <span className={cn('dfs-badge', `dfs-badge-${tone}`)}>{t(label)}</span>;
  const button = (context: DefectActionContext, code: string, label = defectActionLabels[context.kind]) => <Button type="button" size="sm" variant="outline" className="dfs-action" aria-label={t('{label} {code}', { label: t(label), code })} onClick={() => onAction(context)}>{t(label)}</Button>;
  if (!issue) return empty('未找到不良记录', '请从上方异常列表重新选择。');
  const can = (kind: DefectActionContext['kind']) => !readOnly && canOperateDefect(state, actorId, issue.id, kind);
  const progress = getDefectProgress(state, issue.id);
  const repairs = state.repairs.filter((item) => item.issueId === issue.id);
  const handoffs = state.handoffs.filter((item) => item.issueId === issue.id);
  const receipts = state.receipts.filter((item) => item.issueId === issue.id);
  const sourceUrl = issue.sourceTaskId
    ? issue.sourceType === 'field'
      ? `/__preview/field-tasks?task=${encodeURIComponent(issue.sourceTaskId)}&tab=defects`
      : `/__preview/production-inspections?task=${encodeURIComponent(issue.sourceTaskId)}&tab=records`
    : null;
  const photos = (items: DefectPhoto[]) => items.length ? <div className="dfs-photos" aria-label={t('现场整改照片')}>{items.map((photo) => <button key={photo.id} type="button" className="dfs-photo" aria-label={t('查看照片 {name}', { name: photo.name })} onClick={() => onPhoto(photo)}><img src={photo.dataUrl} alt={photo.name} loading="lazy" /><span><ImageIcon className="size-3" aria-hidden="true" />{photo.name}</span></button>)}</div> : <p className="dfs-muted">{t('未附现场照片')}</p>;

  if (view === 'overview') {
    const collaborations = state.collaborations.filter((item) => item.issueId === issue.id);
    return <div className="dfs-sections">
      <section>{heading('问题现象与原因', '原因未明确时可继续整改或转交，由下一责任人持续跟进。')}
        <dl className="dfs-evidence">{field('不良现象', issue.phenomenon)}{field('问题描述', issue.description || t('尚未补充说明'))}</dl>
        <div className="dfs-cause"><div>{badge(issue.causeStatus === 'confirmed' ? '原因已确认' : '原因待确认', issue.causeStatus === 'confirmed' ? 'neutral' : 'pending')}<strong>{t(defectDirectionLabels[issue.direction])}</strong></div><p>{issue.cause || t('尚无已确认原因，保留原始现象，不强行判断责任。')}</p></div>
        {issue.closedAt ? <div className="dfs-closed"><strong>{t('已关闭')}</strong><p>{issue.closeSummary || t('历史关闭说明待核对')}</p><span>{person(issue.closedBy ?? null)} · {time(issue.closedAt)}</span></div> : null}
      </section>
      <section>{heading('来源与批次', '按原记录核对不良范围；现场自检与 QC 检验分别留存。')}
        <dl className="dfs-context">{field('来源类型', t(issue.sourceType === 'field' ? '现场不良' : issue.sourceType === 'process' ? '过程检不良' : '终检不良'))}{field('原业务单号', <span className="dfs-code">{issue.sourceCode}</span>)}{field('原不良范围', amount(issue.quantity))}</dl>
        {sourceUrl || issue.archiveId ? <div className="dfs-links">{sourceUrl ? <Link to={sourceUrl} className="dfs-source">{t(issue.sourceType === 'field' ? '查看现场来源' : '查看检验来源')}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link> : null}{issue.archiveId ? <Link to={`/__preview/batch-archives?tab=inspections&batch=${encodeURIComponent(issue.archiveId)}`} className="dfs-source">{t('查看历史批次档案')}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link> : null}</div> : null}
        <p className="dfs-note">{t('来源页面为独立预览，本页新增处置与交接不会同步修改原检验、报工或档案。')}</p>
      </section>
      <section>{heading('研发与采购协同', '保留同一异常号、发起人与当前处理人，转交不增加不良数量。')}
        {collaborations.length ? <ol className="dfs-record-list">{[...collaborations].reverse().map((record) => <li className="dfs-record" key={record.id}><header className="dfs-record-heading"><div><h3>{t(defectDirectionLabels[record.direction])} · {person(record.ownerId)}</h3><p className="dfs-code">{record.code}</p></div>{badge('本页协同记录')}</header><p className="dfs-prose">{record.description}</p><p className="dfs-muted">{t('发起人')} {person(record.actorId)} · <time dateTime={record.at}>{time(record.at)}</time></p></li>)}</ol> : empty('暂无外部协同记录', '需要跨部门支持时，从右侧操作区确定处理方向与下一责任人。')}
        {collaborations.some((entry) => entry.direction === 'rd') ? <Link to={`/__preview/production-rd?issue=${encodeURIComponent(issue.id)}`} className="dfs-source">{t('进入研发协同 P04')}<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link> : null}
        <p className="dfs-note">{t('协同尚未发送给研发或采购；P04 与本页共用本次会话的原异常，可继续演示技术意见与现场验证。')}</p>
      </section>
    </div>;
  }

  if (view === 'repairs') return <div className="dfs-sections"><section>{heading('现场整改记录', '先记录实际完成范围和依据，再提交复验；整改完成不等于检验合格。')}
    <dl className="dfs-quantities">{field('尚待整改', amount(progress.availableToRepair))}{field('整改后待交接', amount(progress.ready))}{field('已送待复验', amount(progress.pendingReinspection))}</dl>
    {repairs.length ? <ol className="dfs-record-list">{[...repairs].reverse().map((repair) => {
      const available = getHandoffAvailable(state, repair.id);
      return <li className="dfs-record" key={repair.id}>
        <header className="dfs-record-heading"><div><h3 className="dfs-code">{repair.code}</h3><p>{date(repair.date)} · {person(repair.actorId)}</p></div>{badge(available > 0 ? '待提交复验' : '已交接复验', available > 0 ? 'pending' : 'neutral')}</header>
        <dl className="dfs-quantities">{field('本次整改', amount(repair.quantity))}{field('已提交复验', amount(repair.quantity - available))}{field('尚可提交', amount(available))}</dl>
        <p className="dfs-prose">{repair.description}</p>
        <details className="dfs-details"><summary>{t('查看整改依据与照片')}</summary><div><dl className="dfs-evidence">{field('完成依据', repair.basis)}{field('登记时间', time(repair.at))}</dl>{photos(repair.photos)}</div></details>
        {can('handoff') && available > 0 ? <div className="dfs-row-actions"><span>{t('仅提交本条已完成的整改范围')}</span>{button({ kind: 'handoff', issueId: issue.id, repairId: repair.id }, repair.code)}</div> : null}
      </li>;
    })}</ol> : empty('尚无现场整改记录', '核对本次实际处理数量、措施和完成依据后登记。', can('repair') && progress.availableToRepair > 0 ? button({ kind: 'repair', issueId: issue.id }, issue.code) : undefined)}
  </section></div>;

  if (view === 'reinspection') return <div className="dfs-sections"><section>{heading('复验交接与回执', '交接按整改记录取量；复验结果须有 QC 记录，不能用送检数量代替合格数量。')}
    <dl className="dfs-quantities">{field('整改后待交接', amount(progress.ready))}{field('已送待复验', amount(progress.pendingReinspection))}{field('复验合格', amount(progress.resolved))}</dl>
    {handoffs.length ? <ol className="dfs-record-list">{[...handoffs].reverse().map((handoff) => {
      const repair = repairs.find((item) => item.id === handoff.repairId);
      const related = receipts.filter((item) => item.handoffId === handoff.id);
      const pending = Math.max(0, handoff.quantity - related.reduce((sum, item) => sum + item.quantity, 0));
      return <li className="dfs-record" key={handoff.id}>
        <header className="dfs-record-heading"><div><h3 className="dfs-code">{handoff.code}</h3><p>{person(handoff.actorId)} · <time dateTime={handoff.at}>{time(handoff.at)}</time></p></div>{badge(pending > 0 ? '等待 QC 回执' : '已有复验回执', pending > 0 ? 'pending' : 'neutral')}</header>
        <dl className="dfs-quantities">{field('本次交接', amount(handoff.quantity))}{field('尚待复验', amount(pending))}{field('整改来源', <span className="dfs-code">{repair?.code ?? t('待核对')}</span>)}</dl>
        {related.length ? <div className="dfs-receipts">{related.map((receipt) => <article key={receipt.id}><header className="dfs-record-heading"><div><h3 className="dfs-code">{receipt.code}</h3><p>{date(receipt.date)} · {receipt.inspector}</p></div>{badge(receipt.bad > 0 ? '仍有不良' : '本次合格', receipt.bad > 0 ? 'pending' : 'positive')}</header><dl className="dfs-quantities">{field('复验量', amount(receipt.quantity))}{field('合格', amount(receipt.good))}{field('不良', amount(receipt.bad))}</dl><dl className="dfs-evidence">{field('SIP 版本', receipt.sipVersion)}{field('复验依据', receipt.evidence)}</dl>{receipt.bad > 0 ? <p className="dfs-note">{t('未通过部分继续在原异常内处理，不另加一份不良数。')}</p> : null}</article>)}</div> : <p className="dfs-note">{t('尚未收到 QC 复验结果，原异常继续保留未解决数量。')}</p>}
      </li>;
    })}</ol> : empty('尚未提交复验', '先完成现场整改，再从对应整改记录提交实际送检范围。')}
    <p className="dfs-note">{t('回执为已有检验事实的只读摘要。本页新交接仍等待接口接入，不自动产生 QC 结果、QA 放行或库存变化。')}</p>
  </section></div>;

  const events = state.events.filter((item) => item.issueId === issue.id);
  return <div className="dfs-sections"><section>{heading('本异常操作记录', '保留责任分派、处理方向、整改、复验交接与关闭说明。')}
    {events.length ? <ol className="dfs-history">{[...events].reverse().map((event) => <li key={event.id}><History className="size-4" aria-hidden="true" /><div><header><h3>{t(defectActionLabels[event.kind])}</h3><span>{person(event.actorId)} · <time dateTime={event.at}>{time(event.at)}</time></span></header><p>{event.summary}</p></div></li>)}</ol> : empty('本异常暂无操作记录', '完成处理操作后，可在这里核对人员、时间与结果。')}
  </section></div>;
}
