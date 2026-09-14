import type { ReactNode } from 'react';
import { ClipboardList, History, ImageIcon, Package } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/ui/utils';
import { i18nLocale, useI18n } from '../../lib/i18n';
import { getReportUnregistered, getReturnable } from './fieldModel';
import { fieldActionLabels, type FieldActionContext, type FieldPhoto, type FieldState, type FieldView } from './fieldTypes';
import './field-sections.css';

export interface FieldSectionsProps {
  state: FieldState;
  taskId: string;
  view: FieldView;
  readOnly: boolean;
  onAction: (context: FieldActionContext) => void;
  onPhoto: (photo: FieldPhoto) => void;
}

export function FieldSections({ state, taskId, view, readOnly, onAction, onPhoto }: FieldSectionsProps) {
  const { t } = useI18n();
  const task = state.tasks.find((item) => item.id === taskId);
  const number = (value: number) => value.toLocaleString(i18nLocale(), { maximumFractionDigits: 3 });
  const amount = (value: number, unit = task?.unit ?? '') => `${number(value)}${unit ? ` ${t(unit)}` : ''}`;
  const person = (id: string) => state.actors.find((item) => item.id === id)?.name ?? t('人员待确认');
  const time = (value: string) => new Date(value).toLocaleString(i18nLocale(), { timeZone: 'Asia/Shanghai', hour12: false });
  const date = (value: string) => new Date(`${value}T00:00:00+08:00`).toLocaleDateString(i18nLocale(), { timeZone: 'Asia/Shanghai' });
  const heading = (title: string, description: string) => <header className="ft-heading"><h2>{t(title)}</h2><p>{t(description)}</p></header>;
  const empty = (title: string, description: string, action?: ReactNode) => <div className="ft-empty"><ClipboardList className="size-5" aria-hidden="true" /><div><strong>{t(title)}</strong><p>{t(description)}</p>{action}</div></div>;
  const cell = (label: string, content: ReactNode) => <td data-label={t(label)}><div>{content}</div></td>;
  const table = (headers: string[], rows: ReactNode, caption: string) => <div className="ft-table-wrap"><table className="ft-table"><caption className="sr-only">{t(caption)}</caption><thead><tr>{headers.map((label) => <th key={label} scope="col">{t(label)}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>;
  if (!task) return empty('未找到现场任务', '请从上方任务列表重新选择。');

  const canWrite = !readOnly && !task.closed && Boolean(task.acceptedAt);
  const reports = state.reports.filter((item) => item.taskId === task.id);
  const issues = state.issues.filter((item) => item.taskId === task.id);
  const defects = state.defects.filter((item) => item.taskId === task.id);
  const returns = state.returns.filter((item) => item.taskId === task.id);
  const actionButton = (label: string, context: FieldActionContext, code: string) => <Button type="button" size="sm" variant="outline" className="ft-action" aria-label={t('{label} {code}', { label: t(label), code })} onClick={() => onAction(context)}>{t(label)}</Button>;
  const status = (label: string, pending = false) => <span className={cn('ft-status', pending && 'ft-status-pending')}>{t(label)}</span>;
  const lot = (code: string | null) => code ? <span className="ft-code">{code}</span> : <span className="ft-missing">{t('来料批次缺码 · 待补齐')}</span>;

  if (view === 'reports') return <div className="ft-sections"><section>{heading('本任务报工', '按本次实际量记录现场合格与不良；不良登记补充现象，不再次增加不良数量。')}{reports.length ? table(['日期 / 报工单', '本次数量', '不良登记', '填报 / 备注', '操作'], [...reports].reverse().map((report) => {
    const unregistered = getReportUnregistered(state, report.id);
    return <tr key={report.id}>{cell('日期 / 报工单', <><strong className="ft-numeric">{date(report.date)}</strong><p className="ft-code">{report.code}</p></>)}{cell('本次数量', <dl className="ft-report-numbers"><div><dt>{t('实际')}</dt><dd>{amount(report.actual)}</dd></div><div><dt>{t('合格')}</dt><dd>{amount(report.good)}</dd></div><div><dt>{t('不良')}</dt><dd>{amount(report.bad)}</dd></div></dl>)}{cell('不良登记', <><strong className={cn('ft-numeric', unregistered > 0 && 'ft-missing')}>{amount(unregistered)}</strong><p>{t('尚未登记现象')}</p></>)}{cell('填报 / 备注', <><strong>{person(report.actorId)}</strong><p className="ft-numeric">{time(report.at)}</p>{report.note ? <details className="ft-details"><summary>{t('查看备注')}</summary><p>{report.note}</p></details> : <p>{t('未填写备注')}</p>}</>)}{cell('操作', canWrite && unregistered > 0 ? actionButton('登记不良', { kind: 'defect', taskId: task.id, reportId: report.id }, report.code) : <span className="ft-muted">{t(report.bad === 0 ? '无不良' : unregistered === 0 ? '已登记完整' : '仅查看')}</span>)}</tr>;
  }), '当前现场任务的报工记录') : empty('本任务暂无报工记录', task.acceptedAt ? '确认本次实际、合格和不良数量后提交报工。' : '请先接收派工，再填写本次报工。', canWrite ? actionButton('提交报工', { kind: 'report', taskId: task.id }, task.code) : undefined)}<p className="ft-note">{t('现场合格不代表最终检验或 QA 放行；各组件与工序分别记录，不相加作为整机完工。')}</p></section></div>;

  if (view === 'materials') return <div className="ft-sections"><section>{heading('本任务领料', '核对物料、来料批次和原单数量后签收。剩余申请上限不代表实际未耗用库存。')}{issues.length ? table(['领料单 / 物料', '来料批次', '签收情况', '退料申请', '操作'], issues.map((issue) => {
    const requested = returns.filter((item) => item.issueId === issue.id).reduce((sum, item) => sum + item.quantity, 0);
    const returnable = getReturnable(state, issue.id);
    return <tr key={issue.id}>{cell('领料单 / 物料', <><strong className="ft-code">{issue.code}</strong><p>{issue.materialName}</p><p className="ft-code">{issue.materialCode}</p><p>{t('发料')} · {time(issue.issuedAt)}</p></>)}{cell('来料批次', lot(issue.lotCode))}{cell('签收情况', <>{status(issue.signedAt ? '已签收' : '待签收', !issue.signedAt)}<p className="ft-numeric">{t('原发料')} {amount(issue.quantity, issue.unit)}</p>{issue.signedAt ? <><p>{person(issue.signedBy ?? '')}</p><p className="ft-numeric">{time(issue.signedAt)}</p></> : <p>{t('签收前请核对实物数量')}</p>}</>)}{cell('退料申请', <dl className="ft-material-numbers"><div><dt>{t('已申请')}</dt><dd>{amount(requested, issue.unit)}</dd></div><div><dt>{t('剩余申请上限')}</dt><dd>{amount(returnable, issue.unit)}</dd></div></dl>)}{cell('操作', canWrite && !issue.signedAt ? actionButton('签收领料', { kind: 'sign', taskId: task.id, issueId: issue.id }, issue.code) : canWrite && issue.signedAt && returnable > 0 ? actionButton('申请退料', { kind: 'return', taskId: task.id, issueId: issue.id }, issue.code) : <span className="ft-muted">{t(issue.signedAt && returnable === 0 ? '无剩余申请额度' : '仅查看')}</span>)}</tr>;
  }), '当前现场任务的领料与申请上限') : empty('本任务暂无领料单', '请等待仓库发料记录，再按原单核对签收。')}<p className="ft-note">{t('签收只确认生产接收，不再次扣仓库。申请退料前须核对现场未耗用余料；本页不根据 BOM 推定真实耗用。')}</p></section><section>{heading('本任务退料申请', '申请已记录后等待仓库核对，尚未完成实际收料或入库。')}{returns.length ? table(['退料申请 / 来源', '申请量', '原因', '申请人 / 时间', '状态'], [...returns].reverse().map((item) => {
    const issue = issues.find((source) => source.id === item.issueId);
    return <tr key={item.id}>{cell('退料申请 / 来源', <><strong className="ft-code">{item.code}</strong><p className="ft-code">{issue?.code ?? t('原领料单待核对')}</p><p>{issue?.materialName ?? t('物料待核对')}</p>{issue ? <p>{lot(issue.lotCode)}</p> : null}</>)}{cell('申请量', <strong className="ft-numeric">{amount(item.quantity, issue?.unit ?? '')}</strong>)}{cell('原因', <p className="ft-preserve">{item.reason}</p>)}{cell('申请人 / 时间', <><strong>{person(item.actorId)}</strong><p className="ft-numeric">{time(item.at)}</p></>)}{cell('状态', <>{status('待仓库处理', true)}<p>{t('未扣签收量，未加仓库量')}</p></>)}</tr>;
  }), '当前现场任务的退料申请') : empty('本任务暂无退料申请', '有未耗用余料时，可从上方已签收领料单发起申请。')}</section></div>;

  if (view === 'defects') {
    const availableReport = reports.find((item) => getReportUnregistered(state, item.id) > 0);
    return <div className="ft-sections"><section>{heading('本任务不良记录', '每条记录对应原报工中尚未登记的一组实物；关联来料仅作追溯线索，原因仍待分析。')}{defects.length ? <ol className="ft-defect-list">{[...defects].reverse().map((defect) => {
      const report = reports.find((item) => item.id === defect.reportId);
      const issue = issues.find((item) => item.id === defect.issueId);
      return <li className="ft-defect" key={defect.id}><div className="ft-defect-heading"><div><h3>{defect.phenomenon}</h3><p className="ft-code">{defect.code}</p></div><div className="ft-defect-quantity"><strong>{amount(defect.quantity)}</strong>{status('待质量处理', true)}</div></div><dl className="ft-defect-context"><div><dt>{t('原报工单')}</dt><dd className="ft-code">{report?.code ?? t('原报工待核对')}</dd></div><div><dt>{t('生产批次')}</dt><dd className="ft-code">{task.batchCode}</dd></div><div><dt>{t('原领料单')}</dt><dd className="ft-code">{issue?.code ?? t('未关联领料单')}</dd></div><div><dt>{t('来料批次')}</dt><dd>{defect.missingLot ? <span className="ft-missing">{t('来料批次待补齐')}</span> : issue ? lot(issue.lotCode) : t('未关联来料批次')}</dd></div>{issue ? <div className="ft-context-wide"><dt>{t('关联物料')}</dt><dd>{issue.materialName} · <span className="ft-code">{issue.materialCode}</span></dd></div> : null}</dl>{defect.description ? <p className="ft-defect-description">{defect.description}</p> : null}{defect.photos.length ? <div className="ft-photos" aria-label={t('不良现场照片')}>{defect.photos.map((photo) => <button key={photo.id} type="button" className="ft-photo" aria-label={t('查看照片 {name}', { name: photo.name })} onClick={() => onPhoto(photo)}><img src={photo.dataUrl} alt={photo.name} loading="lazy" /><span><ImageIcon className="size-3" aria-hidden="true" />{photo.name}</span></button>)}</div> : <p className="ft-muted">{t('未附现场照片')}</p>}<p className="ft-record-meta">{person(defect.actorId)} · <span className="ft-numeric">{time(defect.at)}</span></p></li>;
    })}</ol> : empty('本任务暂无不良记录', availableReport ? '从原报工选择尚未登记的不良数量，补充现象和追溯资料。' : '存在现场不良时，先提交包含不良数量的报工。', canWrite && availableReport ? actionButton('登记不良', { kind: 'defect', taskId: task.id, reportId: availableReport.id }, availableReport.code) : undefined)}<p className="ft-note">{t('质量协助与处置记录后续接入 P08。本页登记尚未派发质量任务，不代表质量已受理或验证通过。')}</p></section></div>;
  }

  const events = state.events.filter((item) => item.taskId === task.id);
  return <div className="ft-sections"><section>{heading('本任务操作记录', '按操作时间保留接收、报工、签收、不良登记和退料申请。')}{events.length ? <ol className="ft-history">{[...events].reverse().map((event) => <li key={event.id}><History className="size-4" aria-hidden="true" /><div><div className="ft-history-heading"><h3>{t(fieldActionLabels[event.kind])}</h3><span>{person(event.actorId)} · <time dateTime={event.at}>{time(event.at)}</time></span></div><p>{event.summary}</p></div></li>)}</ol> : <div className="ft-empty"><Package className="size-5" aria-hidden="true" /><div><strong>{t('本任务暂无操作记录')}</strong><p>{t('完成现场操作后，可在这里核对人员、时间和结果。')}</p></div></div>}</section></div>;
}
