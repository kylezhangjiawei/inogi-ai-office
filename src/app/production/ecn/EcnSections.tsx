import type { ReactNode } from 'react';
import { FileText, History, Info } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { isEcnImpactVerified } from './ecnModel';
import { dispositionLabels, ecnActionLabels, ecnTeamLabels, legacyKindLabels, type EcnActionContext, type EcnDocument, type EcnState, type EcnTab } from './ecnTypes';
import './ecn-sections.css';

export interface EcnSectionsProps {
  state: EcnState;
  recordId: string;
  actorId: string;
  tab: EcnTab;
  readOnly?: boolean;
  onViewDocument: (id: string) => void;
  onAction: (context: EcnActionContext) => void;
}

export function EcnSections({ state, recordId, actorId, tab, readOnly = false, onViewDocument, onAction }: EcnSectionsProps) {
  const { t } = useI18n();
  const record = state.records.find((item) => item.id === recordId);
  const actor = state.actors.find((item) => item.id === actorId);
  if (!record) return <div className="ecs-empty"><FileText className="size-5" aria-hidden="true" /><div><strong>{t('未找到变更资料')}</strong><p>{t('请从变更清单重新选择。')}</p></div></div>;
  const editable = !readOnly && record.status === 'published' && Boolean(actor);
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const quantity = (value: number, unit: string) => `${number(value)} ${t(unit)}`;
  const time = (value?: string | null) => value ? new Date(value).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false }) : t('尚无记录');
  const person = (id: string) => state.actors.find((item) => item.id === id);
  const impact = (id: string) => record.impacts.find((item) => item.id === id);
  const document = (id: string) => record.documents.find((item) => item.id === id);
  const requiredImpacts = record.impacts.filter((item) => item.applicability === 'apply');
  const title = (name: string, description?: string) => <header className="ecs-heading"><h2>{t(name)}</h2>{description && <p>{t(description)}</p>}</header>;
  const status = (label: string, tone: 'neutral' | 'success' | 'warning' = 'neutral') => <span className={cn('ecs-status', `ecs-status-${tone}`)}>{t(label)}</span>;
  const cell = (label: string, value: ReactNode) => <td data-label={t(label)}>{value}</td>;
  const empty = (heading: string, description = '当前变更尚无此类记录，可查看其他已归集资料。') => <div className="ecs-empty"><FileText className="size-5" aria-hidden="true" /><div><strong>{t(heading)}</strong><p>{t(description)}</p></div></div>;
  const sourceButton = (id: string) => {
    const source = document(id);
    return source ? <Button key={id} variant="link" size="sm" className="ecs-source" onClick={() => onViewDocument(id)} aria-label={t('查看资料摘要 {code}', { code: source.code })}>{source.code} · {source.revision}</Button> : <span className="ecs-pending">{t('资料依据待补齐')}</span>;
  };
  const details = (label: string, content: ReactNode) => <details className="ecs-disclosure"><summary>{t(label)}</summary><div>{content}</div></details>;
  function table(headers: string[], rows: ReactNode, name: string) {
    return <div className="ecs-table-wrap"><table className="ecs-table"><caption className="sr-only">{t(name)}</caption><thead><tr>{headers.map((label) => <th scope="col" key={label}>{t(label)}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>;
  }
  function documentFacts(source: EcnDocument | undefined) {
    if (!source) return <span className="ecs-pending">{t('版本依据待补齐')}</span>;
    return <div className="ecs-compact-document"><Button variant="link" size="sm" className="ecs-source" onClick={() => onViewDocument(source.id)} aria-label={t('查看资料摘要 {code}', { code: source.code })}>{source.revision} · {t('查看版本依据')}</Button>{source.status === 'draft' && status('未发布草稿', 'warning')}</div>;
  }
  function snapshotValue(field: string, value: unknown): ReactNode {
    if (value === null || value === undefined || value === '') return t('尚无记录');
    if (Array.isArray(value)) return value.length ? <ul className="ecs-snapshot-list">{value.map((item, index) => <li key={index}>{snapshotValue(field, item)}</li>)}</ul> : t('尚无记录');
    if (typeof value === 'object') {
      const labels: Record<string, string> = { id:'记录编号', code:'待办编号', actorId:'操作人', ownerId:'责任人', resolvedBy:'处理人', impactId:'适用批次', impactIds:'适用批次', targetId:'旧版对象', evidenceId:'验证依据', kind:'操作', choice:'处置决定', result:'验证结果', status:'状态', reason:'依据与原因', note:'说明', description:'执行问题', resolution:'处理结果', at:'记录时间', dueDate:'完成期限', resolvedAt:'处理时间', archivedAt:'归档时间', archivedBy:'归档人', reviewed:'已阅核对' };
      return <dl className="ecs-snapshot-fields">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{t(labels[key] ?? key)}</dt><dd>{snapshotValue(key, item)}</dd></div>)}</dl>;
    }
    if (typeof value === 'boolean') return t(value ? '已确认' : '未确认');
    const raw = String(value);
    if (['actorId','ownerId','resolvedBy','archivedBy'].includes(field)) return person(raw)?.name ?? t('人员待确认');
    if (field === 'impactId' || field === 'impactIds') return impact(raw)?.batchNo ?? t('批次待确认');
    if (field === 'targetId') { const target = record!.legacyTargets.find((item) => item.id === raw); return target ? `${t(legacyKindLabels[target.kind])} · ${target.code}` : t('旧版对象待确认'); }
    if (field === 'evidenceId') return document(raw) ? sourceButton(raw) : t('依据待补齐');
    if (field === 'choice') return t(dispositionLabels[raw as keyof typeof dispositionLabels] ?? raw);
    if (field === 'kind') return t(ecnActionLabels[raw as keyof typeof ecnActionLabels] ?? raw);
    if (field === 'status') return t(({ open:'待处理', resolved:'已记录处理结果', published:'已发布', draft:'未发布草稿', archived:'已归档' } as Record<string,string>)[raw] ?? raw);
    if (field === 'result') return t(raw === 'passed' ? '验证通过' : raw === 'failed' ? '验证未通过' : raw);
    if (['at','resolvedAt','archivedAt'].includes(field)) return time(raw);
    return raw;
  }
  function snapshot(raw: string): ReactNode {
    if (!raw) return <p>{t('尚无记录')}</p>;
    try { return snapshotValue('', JSON.parse(raw)); } catch { return <p>{raw}</p>; }
  }

  if (tab === 'comparison') return <div className="ecs-sections">
    {title('变更内容对比', record.summary)}<p className="ecs-publication">{t('发布人')}：{record.publisher || t('待确认')} · {t('发布时间')}：{record.publishedAt ? time(record.publishedAt) : t('尚未发布')}</p>
    {record.differences.length ? record.differences.map((difference) => <section key={difference.id} className="ecs-difference"><h3>{difference.subject}</h3><div className="ecs-comparison-grid"><div><span className="ecs-eyebrow">{t('变更前')}</span><p className="ecs-difference-value">{difference.before || t('待补齐')}</p>{documentFacts(document(difference.beforeDocumentId))}</div><div className="ecs-current"><span className="ecs-eyebrow">{t('变更后')}</span><p className="ecs-difference-value">{difference.after || t('待补齐')}</p>{documentFacts(document(difference.afterDocumentId))}</div></div><p className="ecs-reason"><strong>{t('变更原因')}</strong>{difference.reason || t('待补齐')}</p></section>) : empty('暂无已归集的变更对比')}
    <section className="ecs-related-docs"><details className="ecs-disclosure"><summary>{t('关联 SOP、SIP 与 BOM')} · {record.documents.filter((item) => ['sop', 'sip', 'bom'].includes(item.kind)).length} {t('份')}</summary><div>{record.documents.filter((item) => ['sop', 'sip', 'bom'].includes(item.kind)).length ? <ul>{record.documents.filter((item) => ['sop', 'sip', 'bom'].includes(item.kind)).map((item) => <li key={item.id}><div><strong>{item.title}</strong><p>{item.summary}</p>{sourceButton(item.id)}</div>{status(item.status === 'published' ? '已发布' : '未发布草稿', item.status === 'published' ? 'neutral' : 'warning')}</li>)}</ul> : empty('暂无关联作业资料')}</div></details></section>
    <p className="ecs-note"><Info className="size-4" aria-hidden="true" />{t('实际图纸原文件待接入。此处仅展示资料摘要，未提供的图纸不生成预览或下载。')}</p>
  </div>;

  if (tab === 'scope') return <div className="ecs-sections">
    <section>{title('适用计划与生产批次', '指定范围使用新版；保留旧版与待判定范围分别记录。')}<p className="ecs-rule">{record.effectiveRule}</p>{record.impacts.length ? table(['批次 / 计划', '数量', '具体范围', '适用结论', '决定依据'], record.impacts.map((item) => <tr key={item.id}>
      {cell('批次 / 计划', <><strong>{item.batchNo}</strong><p>{item.planNo}</p><p>{item.product}</p></>)}{cell('数量', <span className="ecs-numeric">{quantity(item.quantity, item.unit)}</span>)}{cell('具体范围', item.range)}{cell('适用结论', status({ apply: '指定范围用新版', retain: '保留历史旧版', pending: '待技术判定' }[item.applicability], item.applicability === 'pending' ? 'warning' : 'neutral'))}{cell('决定依据', item.decision || <span className="ecs-pending">{t('待补齐')}</span>)}
    </tr>), '适用计划与批次') : empty('暂无明确适用范围')}</section>
    <section>{title('旧版本对象处置', '库存、在制品、旧采购订单分别决定；登记决定不会自动扣账或换版。')}{record.legacyTargets.length ? table(['对象 / 原单', '旧版 / 数量', '当前决定', '操作'], record.legacyTargets.map((target) => {
      const history = record.dispositions.filter((item) => item.targetId === target.id).slice().reverse();
      const latest = history[0];
      const canDecide = editable && (actor?.team === 'engineering' || actor?.team === 'quality');
      return <tr key={target.id}>{cell('对象 / 原单', <><span className="ecs-eyebrow">{t(legacyKindLabels[target.kind])}</span><strong>{target.code}</strong><p>{target.label}</p>{target.impactId && <p>{impact(target.impactId)?.batchNo || t('批次待确认')}</p>}</>)}{cell('旧版 / 数量', <><span>{target.oldVersion || t('版本待确认')}</span><p className="ecs-numeric">{quantity(target.quantity, target.unit)}</p></>)}{cell('当前决定', latest ? <><strong>{t(dispositionLabels[latest.choice])}</strong><p>{person(latest.actorId)?.name || t('人员待确认')} · {time(latest.at)}</p>{details('决定原因与历史', <ul className="ecs-small-history">{history.map((item) => <li key={item.id}><strong>{t(dispositionLabels[item.choice])}</strong><p>{item.reason}</p><small>{person(item.actorId)?.name || t('人员待确认')} · {time(item.at)}</small></li>)}</ul>)}</> : status('尚未决定', 'warning'))}{cell('操作', canDecide ? <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'disposition', targetId: target.id })} aria-label={t('记录处置 {code}', { code: target.code })}>{t('记录决定')}</Button> : <span className="ecs-muted">{t(editable ? '由授权岗位记录' : '只读查看')}</span>)}</tr>;
    }), '旧版本处置') : empty('暂无已关联旧版本对象', '未归集的旧库存、在制品与订单仍需在正式来源接入后核对。')}</section>
  </div>;

  if (tab === 'confirmations') return <div className="ecs-sections">
    <section>{title('岗位确认情况', '本人确认表示已阅及核对适用范围，不能代替执行验证。')}{record.requiredActorIds.length ? table(['岗位 / 人员', '确认范围', '确认时间 / 备注'], record.requiredActorIds.map((id) => {
      const required = person(id), rows = record.acknowledgements.filter((item) => item.actorId === id).slice().reverse();
      const covered = new Set(rows.flatMap((item) => item.impactIds));
      const complete = record.impacts.length > 0 && record.impacts.every((item) => covered.has(item.id));
      return <tr key={id}>{cell('岗位 / 人员', <><strong>{required?.name || t('人员待确认')}{id === actorId ? <span className="ecs-me">{t('本人')}</span> : null}</strong><p>{required?.role ?? t('岗位待确认')} · {required ? t(ecnTeamLabels[required.team]) : '—'}</p></>)}{cell('确认范围', <>{status(rows.length ? complete ? '适用范围已确认' : '部分范围已确认' : '待本人确认', complete ? 'success' : 'warning')}{covered.size > 0 && <p>{[...covered].map((impactId) => impact(impactId)?.batchNo || t('范围待确认')).join('、')}</p>}</>)}{cell('确认时间 / 备注', rows.length ? <><span className="ecs-numeric">{time(rows[0].at)}</span>{details('查看确认记录', <ul className="ecs-small-history">{rows.map((item) => <li key={item.id}><strong>{time(item.at)}</strong><p>{item.impactIds.map((impactId) => impact(impactId)?.batchNo || t('范围待确认')).join('、')}</p><p>{item.note || t('无备注')}</p></li>)}</ul>)}</> : <span className="ecs-muted">{t('尚无确认记录')}</span>)}</tr>;
    }), '岗位确认情况') : empty('尚未指定确认岗位')}</section>
    <section>{title('执行验证记录', '按实际适用范围记录结果，历史失败与后续验证分别保留。')}{requiredImpacts.length ? table(['适用批次 / 范围', '最近验证', '原始依据', '操作'], requiredImpacts.map((item) => {
      const history = record.verifications.filter((verification) => verification.impactId === item.id).slice().reverse(), latest = history[0];
      const canVerify = editable && actor?.team === 'quality';
      return <tr key={item.id}>{cell('适用批次 / 范围', <><strong>{item.batchNo}</strong><p>{item.range}</p><p className="ecs-numeric">{quantity(item.quantity, item.unit)}</p></>)}{cell('最近验证', latest ? <>{status(latest.result === 'passed' ? isEcnImpactVerified(record, item.id) ? '验证通过' : '待重新验证' : '验证未通过', latest.result === 'passed' && isEcnImpactVerified(record, item.id) ? 'success' : 'warning')}<p>{person(latest.actorId)?.name || t('人员待确认')} · {time(latest.at)}</p>{details('查看历次验证', <ul className="ecs-small-history">{history.map((verification) => <li key={verification.id}><strong>{t(verification.result === 'passed' ? '通过' : '未通过')}</strong><p>{verification.note}</p><small>{person(verification.actorId)?.name || t('人员待确认')} · {time(verification.at)}</small>{sourceButton(verification.evidenceId)}</li>)}</ul>)}</> : status('待执行验证', 'warning'))}{cell('原始依据', latest ? sourceButton(latest.evidenceId) : <span className="ecs-muted">{t('尚无验证依据')}</span>)}{cell('操作', canVerify ? <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'verify', impactId: item.id })} aria-label={t('登记验证 {batch}', { batch: item.batchNo })}>{t('登记验证')}</Button> : <span className="ecs-muted">{t(editable ? '由质量岗位验证' : '只读查看')}</span>)}</tr>;
    }), '执行验证记录') : empty('尚无明确采用新版的范围', '适用范围先经技术判定，执行验证与岗位已阅分别留存。')}</section>
  </div>;

  if (tab === 'tasks') return <div className="ecs-sections">{title('采购与产线协同待办', '反馈与处理结果保留在当前演示中，正式通知与业务任务尚未发送。')}{record.tasks.length ? table(['待办 / 适用批次', '处理人 / 期限', '当前状态', '操作'], record.tasks.slice().reverse().map((task) => {
    const owner = person(task.ownerId), canResolve = editable && task.status === 'open' && (task.ownerId === actorId || actor?.team === 'engineering' || actor?.team === 'quality');
    return <tr key={task.id}>{cell('待办 / 适用批次', <><strong>{task.code}</strong><p>{impact(task.impactId)?.batchNo || t('批次待确认')}</p>{details('查看问题与处理记录', <><p>{task.description}</p><p className="ecs-muted">{t('反馈人')}：{person(task.actorId)?.name || t('人员待确认')} · {time(task.at)}</p>{task.status === 'resolved' && <div className="ecs-resolution"><strong>{t('处理结果')}</strong><p>{task.resolution || t('待补齐')}</p><p className="ecs-muted">{person(task.resolvedBy ?? '')?.name || t('人员待确认')} · {time(task.resolvedAt)}</p></div>}</>)}</>)}{cell('处理人 / 期限', <><strong>{owner?.name || t('人员待确认')}</strong><p>{owner ? t(ecnTeamLabels[owner.team]) : t('岗位待确认')}</p><p className="ecs-numeric">{task.dueDate}</p></>)}{cell('当前状态', status(task.status === 'resolved' ? '已记录处理结果' : '待处理', task.status === 'resolved' ? 'success' : 'warning'))}{cell('操作', canResolve ? <Button size="sm" variant="outline" onClick={() => onAction({ kind: 'resolve-task', taskId: task.id })} aria-label={t('处理待办 {code}', { code: task.code })}>{t('记录处理')}</Button> : <span className="ecs-muted">{t(task.status === 'resolved' ? '保留原结果' : editable ? '由责任人处理' : '只读查看')}</span>)}</tr>;
  }), '协同待办') : empty('暂无协同待办', editable ? '遇到无法执行的问题，可在右侧反馈并指定下一责任人。' : '当前没有已归集的问题待办，可继续查看适用范围与确认记录。')}<p className="ecs-note"><Info className="size-4" aria-hidden="true" />{t('记录处理结果不自动表示验证通过；后续结果在执行验证中单独核对。')}</p></div>;

  return <div className="ecs-sections">{title('操作历史', '记录确认、处置、协同和验证的人员、时间及前后内容。')}{record.events.length ? <ol className="ecs-event-list">{record.events.slice().reverse().map((event) => <li key={event.id}><History className="size-4" aria-hidden="true" /><div><div className="ecs-event-head"><h3>{t(ecnActionLabels[event.kind])}</h3><span>{person(event.actorId)?.name || t('人员待确认')}</span></div><p className="ecs-muted ecs-numeric">{time(event.at)}</p><p>{event.summary}</p>{details('查看操作前后', <div className="ecs-event-comparison"><div><strong>{t('操作前')}</strong><div>{snapshot(event.before)}</div></div><div><strong>{t('操作后')}</strong><div>{snapshot(event.after)}</div></div></div>)}</div></li>)}</ol> : empty('暂无操作历史', '岗位确认和后续执行记录会按时间保留；当前资料不会自动生成完成记录。')}</div>;
}
