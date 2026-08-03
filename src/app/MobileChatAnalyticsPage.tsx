import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageSquareText,
  RefreshCw,
  Repeat2,
  Search,
  Target,
  ThumbsDown,
  ThumbsUp,
  UserRoundX,
  Users,
  X,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { toast } from 'sonner';

import { cn } from './components/ui/utils';
import {
  closeMobileOverlay,
  pushMobileOverlayState,
  useBodyScrollLock,
  useMobileOverlayBack,
} from './hooks/useMobileOverlay';
import {
  chatAnalyticsApi,
  type ChatAnalyticsData,
  type ChatAnalyticsUserDetail,
  type ChatFeedbackRow,
} from './lib/chatAnalyticsApi';

type RangeDays = 7 | 30 | 90;
type MobileTab = 'overview' | 'people' | 'feedback';
type PeopleStage = 'all' | 'repeat' | 'light' | 'one_time' | 'not_used';
type FeedbackReaction = 'all' | ChatFeedbackRow['reaction'];
type FeedbackStatus = 'all' | ChatFeedbackRow['status'];

const PERSON_DETAIL_OVERLAY = 'chat-analytics-person-detail';

const RANGE_OPTIONS: Array<{ value: RangeDays; label: string }> = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
];

const STATUS_LABEL: Record<ChatFeedbackRow['status'], string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  ignored: '已忽略',
};

const STATUS_TONE: Record<ChatFeedbackRow['status'], string> = {
  open: 'bg-rose-50 text-rose-700',
  in_progress: 'bg-amber-50 text-amber-700',
  resolved: 'bg-emerald-50 text-emerald-700',
  ignored: 'bg-slate-100 text-slate-600',
};

const PEOPLE_STAGES: Array<{ value: PeopleStage; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'repeat', label: '跨天复用' },
  { value: 'light', label: '轻度使用' },
  { value: 'one_time', label: '仅试一次' },
  { value: 'not_used', label: '尚未使用' },
];

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function stageMeta(row: ChatAnalyticsData['userAdoption'][number]) {
  if (row.questions === 0) return { label: '尚未使用', className: 'bg-slate-100 text-slate-600' };
  if (row.activeDays >= 2) return { label: '跨天复用', className: 'bg-emerald-50 text-emerald-700' };
  if (row.questions === 1) return { label: '仅试一次', className: 'bg-amber-50 text-amber-700' };
  return { label: '轻度使用', className: 'bg-sky-50 text-sky-700' };
}

function MobilePager({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <span className="text-xs text-slate-500">共 {total} 条 · 第 {safePage}/{totalPages} 页</span>
      <div className="flex gap-2">
        <button type="button" aria-label="上一页" disabled={safePage <= 1} onClick={() => onChange(safePage - 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 active:bg-slate-100 disabled:opacity-35"><ChevronLeft size={18} /></button>
        <button type="button" aria-label="下一页" disabled={safePage >= totalPages} onClick={() => onChange(safePage + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 active:bg-slate-100 disabled:opacity-35"><ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, tone = 'indigo' }: { label: string; value: string; detail: string; tone?: 'indigo' | 'teal' | 'amber' | 'rose' }) {
  const toneClass = {
    indigo: 'bg-indigo-50 text-indigo-700',
    teal: 'bg-teal-50 text-teal-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
  }[tone];
  return (
    <article className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={cn('mt-2 inline-flex rounded-lg px-2 py-1 text-xl font-black tracking-tight', toneClass)}>{value}</p>
      <p className="mt-2 text-[11px] leading-4 text-slate-400">{detail}</p>
    </article>
  );
}

function PersonDetail({
  detail,
  loading,
  onClose,
}: {
  detail: ChatAnalyticsUserDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [activityQuery, setActivityQuery] = useState('');
  const [activityScenario, setActivityScenario] = useState('all');
  const [activityPage, setActivityPage] = useState(1);
  const [feedbackReaction, setFeedbackReaction] = useState<FeedbackReaction>('all');
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>('all');
  const [feedbackPage, setFeedbackPage] = useState(1);
  const pageSize = 5;
  useBodyScrollLock(true);

  const scenarios = [...new Set((detail?.recentActivity ?? []).map((row) => row.scenario))].sort();
  const filteredActivity = (detail?.recentActivity ?? []).filter((row) => {
    const keyword = activityQuery.trim().toLowerCase();
    return (!keyword || [row.question, row.answer, row.model].some((value) => String(value ?? '').toLowerCase().includes(keyword)))
      && (activityScenario === 'all' || row.scenario === activityScenario);
  });
  const safeActivityPage = Math.min(activityPage, Math.max(1, Math.ceil(filteredActivity.length / pageSize)));
  const pagedActivity = filteredActivity.slice((safeActivityPage - 1) * pageSize, safeActivityPage * pageSize);
  const filteredFeedback = (detail?.feedback ?? []).filter((row) =>
    (feedbackReaction === 'all' || row.reaction === feedbackReaction)
    && (feedbackStatus === 'all' || row.status === feedbackStatus));
  const safeFeedbackPage = Math.min(feedbackPage, Math.max(1, Math.ceil(filteredFeedback.length / pageSize)));
  const pagedFeedback = filteredFeedback.slice((safeFeedbackPage - 1) * pageSize, safeFeedbackPage * pageSize);

  useEffect(() => setActivityPage(1), [activityQuery, activityScenario]);
  useEffect(() => setFeedbackPage(1), [feedbackReaction, feedbackStatus]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overscroll-none bg-[#f5f7fb]" role="dialog" aria-modal="true" aria-label="人员使用详情">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-3 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur">
        <button type="button" aria-label="返回" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 active:bg-slate-100"><ArrowLeft size={21} /></button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-slate-950">{detail?.person.name ?? '人员详情'}</h2>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{detail ? `${detail.person.department}${detail.person.position ? ` · ${detail.person.position}` : ''}` : '正在加载'}</p>
        </div>
        <button type="button" aria-label="关闭" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 active:bg-slate-100"><X size={20} /></button>
      </header>

      <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {loading ? (
          <div className="space-y-3"><div className="h-28 animate-pulse rounded-2xl bg-white" /><div className="h-80 animate-pulse rounded-2xl bg-white" /></div>
        ) : detail ? (
          detail.summary.questions === 0 ? (
            <section className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><UserRoundX size={27} /></span>
              <h3 className="mt-4 text-lg font-bold text-slate-900">近 {detail.range.days} 天尚未使用</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">该人员已有完整组织档案，但当前周期没有提交问题。</p>
            </section>
          ) : (
            <div className="space-y-3">
              <section className="rounded-3xl bg-slate-950 p-4 text-white shadow-lg">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[['提问', detail.summary.questions], ['会话', detail.summary.conversations], ['活跃天', detail.summary.activeDays], ['回答', detail.summary.answers]].map(([label, value]) => <div key={label}><p className="text-xl font-black">{value}</p><p className="mt-1 text-[10px] text-white/55">{label}</p></div>)}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-[11px] text-white/60"><span>首次 {formatDate(detail.summary.firstUsedAt)}</span><span className="text-right">最近 {formatDateTime(detail.summary.lastActiveAt)}</span></div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">近期使用记录</h3>
                <div className="mt-3 space-y-2">
                  <label className="relative block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="搜索问题或回答" className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-indigo-300" /></label>
                  <select value={activityScenario} onChange={(event) => setActivityScenario(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"><option value="all">全部使用场景</option>{scenarios.map((scenario) => <option key={scenario} value={scenario}>{scenario}</option>)}</select>
                </div>
                <div className="mt-3 space-y-3">
                  {pagedActivity.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">{row.scenario}</span><span className="text-[10px] text-slate-400">{formatDateTime(row.createdAt)}</span></div><p className="mt-2 text-sm font-medium leading-6 text-slate-800">{row.question}</p>{row.answer && <p className="mt-2 line-clamp-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">AI：{row.answer}</p>}</article>)}
                  {filteredActivity.length === 0 && <p className="py-8 text-center text-xs text-slate-400">暂无匹配记录</p>}
                </div>
                <div className="mt-3"><MobilePager page={safeActivityPage} pageSize={pageSize} total={filteredActivity.length} onChange={setActivityPage} /></div>
              </section>

              {detail.feedback.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-900">个人反馈</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <select value={feedbackReaction} onChange={(event) => setFeedbackReaction(event.target.value as FeedbackReaction)} className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-xs"><option value="all">全部类型</option><option value="like">有帮助</option><option value="dislike">需改进</option></select>
                    <select value={feedbackStatus} onChange={(event) => setFeedbackStatus(event.target.value as FeedbackStatus)} className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-xs"><option value="all">全部状态</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  </div>
                  <div className="mt-3 space-y-2">{pagedFeedback.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 p-3 text-xs"><div className="flex items-center justify-between"><span className={cn('rounded-full px-2 py-1 font-semibold', row.reaction === 'like' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{row.reaction === 'like' ? '有帮助' : '需改进'}</span><span className={cn('rounded-full px-2 py-1', STATUS_TONE[row.status])}>{STATUS_LABEL[row.status]}</span></div>{(row.reasonLabels ?? []).length > 0 && <p className="mt-2 leading-5 text-slate-700">{(row.reasonLabels ?? []).join('、')}</p>}{row.comment && <p className="mt-1 leading-5 text-slate-500">“{row.comment}”</p>}</article>)}</div>
                  <div className="mt-3"><MobilePager page={safeFeedbackPage} pageSize={pageSize} total={filteredFeedback.length} onChange={setFeedbackPage} /></div>
                </section>
              )}
            </div>
          )
        ) : <p className="rounded-2xl bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">人员详情加载失败</p>}
      </div>
    </div>
  );
}

export function MobileChatAnalyticsPage() {
  const [days, setDays] = useState<RangeDays>(30);
  const [data, setData] = useState<ChatAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MobileTab>('overview');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleDepartment, setPeopleDepartment] = useState('all');
  const [peopleStage, setPeopleStage] = useState<PeopleStage>('all');
  const [peoplePage, setPeoplePage] = useState(1);
  const [feedbackQuery, setFeedbackQuery] = useState('');
  const [feedbackReaction, setFeedbackReaction] = useState<FeedbackReaction>('all');
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>('all');
  const [feedbackDepartment, setFeedbackDepartment] = useState('all');
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<ChatAnalyticsUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const dashboardRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const pageSize = 8;

  const load = useCallback(async () => {
    const requestId = ++dashboardRequestRef.current;
    setLoading(true);
    try {
      const next = await chatAnalyticsApi.getDashboard(days);
      if (mountedRef.current && requestId === dashboardRequestRef.current) setData(next);
    } catch (error) {
      if (mountedRef.current && requestId === dashboardRequestRef.current) {
        toast.error(error instanceof Error ? error.message : '使用数据加载失败');
      }
    } finally {
      if (mountedRef.current && requestId === dashboardRequestRef.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      dashboardRequestRef.current += 1;
    };
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedUserId) { setUserDetail(null); return; }
    let active = true;
    setDetailLoading(true);
    void chatAnalyticsApi.getUserDetail(selectedUserId, days)
      .then((detail) => { if (active) setUserDetail(detail); })
      .catch((error) => { if (active) toast.error(error instanceof Error ? error.message : '人员详情加载失败'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [days, selectedUserId]);

  const dismissPersonDetail = useCallback(() => {
    setSelectedUserId(null);
    setUserDetail(null);
  }, []);
  useMobileOverlayBack(Boolean(selectedUserId), PERSON_DETAIL_OVERLAY, dismissPersonDetail);

  const openPersonDetail = (userId: string) => {
    pushMobileOverlayState(PERSON_DETAIL_OVERLAY);
    setUserDetail(null);
    setSelectedUserId(userId);
  };

  const closePersonDetail = () => closeMobileOverlay(PERSON_DETAIL_OVERLAY, dismissPersonDetail);

  const selectRange = (nextDays: RangeDays) => {
    if (nextDays === days) return;
    // 立即隐藏旧周期数据，并让尚未返回的旧请求失效，避免标签与数据周期错位。
    dashboardRequestRef.current += 1;
    setData(null);
    setLoading(true);
    setDays(nextDays);
  };

  const departments = useMemo(() => [...new Set((data?.userAdoption ?? []).map((row) => row.department))].sort(), [data]);
  const feedbackDepartments = useMemo(() => [...new Set((data?.recentFeedback ?? []).map((row) => row.department))].sort(), [data]);
  const filteredPeople = useMemo(() => {
    const keyword = peopleQuery.trim().toLowerCase();
    return (data?.userAdoption ?? []).filter((row) => {
      const matchesKeyword = !keyword || [row.name, row.department, row.role, row.primaryScenario]
        .some((value) => String(value ?? '').toLowerCase().includes(keyword));
      const matchesDepartment = peopleDepartment === 'all' || row.department === peopleDepartment;
      const matchesStage = peopleStage === 'all'
        || (peopleStage === 'repeat' && row.activeDays >= 2)
        || (peopleStage === 'light' && row.questions > 1 && row.activeDays < 2)
        || (peopleStage === 'one_time' && row.questions === 1)
        || (peopleStage === 'not_used' && row.questions === 0);
      return matchesKeyword && matchesDepartment && matchesStage;
    });
  }, [data, peopleDepartment, peopleQuery, peopleStage]);
  const safePeoplePage = Math.min(peoplePage, Math.max(1, Math.ceil(filteredPeople.length / pageSize)));
  const pagedPeople = filteredPeople.slice((safePeoplePage - 1) * pageSize, safePeoplePage * pageSize);

  const filteredFeedback = useMemo(() => {
    const keyword = feedbackQuery.trim().toLowerCase();
    return (data?.recentFeedback ?? []).filter((row) => {
      const matchesKeyword = !keyword || [row.user, row.department, row.question, row.answer, row.comment, ...(row.reasonLabels ?? [])]
        .some((value) => String(value ?? '').toLowerCase().includes(keyword));
      return matchesKeyword
        && (feedbackReaction === 'all' || row.reaction === feedbackReaction)
        && (feedbackStatus === 'all' || row.status === feedbackStatus)
        && (feedbackDepartment === 'all' || row.department === feedbackDepartment);
    });
  }, [data, feedbackDepartment, feedbackQuery, feedbackReaction, feedbackStatus]);
  const safeFeedbackPage = Math.min(feedbackPage, Math.max(1, Math.ceil(filteredFeedback.length / pageSize)));
  const pagedFeedback = filteredFeedback.slice((safeFeedbackPage - 1) * pageSize, safeFeedbackPage * pageSize);

  useEffect(() => setPeoplePage(1), [peopleQuery, peopleDepartment, peopleStage, days]);
  useEffect(() => setFeedbackPage(1), [feedbackQuery, feedbackReaction, feedbackStatus, feedbackDepartment, days]);

  const summary = data?.summary;
  const comparison = data?.comparison;
  const activeDelta = summary && comparison ? summary.activeUsers - comparison.activeUsers : 0;
  const repeatDelta = summary && comparison ? summary.repeatUsers - comparison.repeatUsers : 0;
  const notUsed = summary ? Math.max(0, summary.eligibleUsers - summary.activeUsers) : 0;
  const oneTime = data?.userAdoption.filter((row) => row.questions === 1).length ?? 0;
  const trend = data?.trend.map((row) => ({ ...row, day: row.date.slice(5) })) ?? [];
  const sampleInsufficient = Boolean(summary && (summary.activeUsers < 10 || summary.feedbackCount < 30));
  const adoptionTitle = !summary
    ? '暂无使用数据'
    : summary.coverageRate >= 60 && summary.repeatRate >= 40
      ? '采用已形成规模，重点转向质量'
      : summary.activeUsers > 0 && summary.repeatRate < 40
        ? '采用正在起步，复用仍不足'
        : summary.activeUsers > 0 ? '仍处于早期验证阶段' : '尚未形成实际使用';

  const selectTab = (nextTab: MobileTab) => {
    setTab(nextTab);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  };

  const openPeople = (stage: PeopleStage) => {
    setPeopleQuery('');
    setPeopleDepartment('all');
    setPeopleStage(stage);
    setPeoplePage(1);
    selectTab('people');
  };

  const openFeedback = () => {
    setFeedbackQuery('');
    setFeedbackReaction('all');
    setFeedbackStatus(summary?.openFeedback ? 'open' : 'all');
    setFeedbackDepartment('all');
    setFeedbackPage(1);
    selectTab('feedback');
  };

  return (
    <div className="min-h-full bg-[#f5f7fb] pb-[max(24px,env(safe-area-inset-bottom))]">
      <section className="border-b border-slate-200 bg-white px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">MateChat 使用观察</p>
            <p className="mt-1 text-[11px] text-slate-400">更新于 {formatDateTime(data?.dataFreshness.generatedAt ?? null)}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-600 active:bg-slate-100 disabled:opacity-40" aria-label="刷新数据"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
          {RANGE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => selectRange(option.value)} className={cn('h-11 rounded-xl text-xs font-bold transition', days === option.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500')}>{option.label}</button>)}
        </div>
      </section>

      <nav className="sticky top-0 z-20 grid grid-cols-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur" aria-label="移动端数据视图">
        {([
          ['overview', '概览', BarChart3],
          ['people', '人员', Users],
          ['feedback', '反馈', MessageSquareText],
        ] as const).map(([value, label, Icon]) => <button key={value} type="button" onClick={() => selectTab(value)} className={cn('relative flex h-12 items-center justify-center gap-1.5 text-xs font-bold', tab === value ? 'text-indigo-700' : 'text-slate-400')}><Icon size={15} />{label}{tab === value && <span className="absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-indigo-600" />}</button>)}
      </nav>

      {loading && !data ? (
        <div className="space-y-3 px-3 py-4"><div className="h-52 animate-pulse rounded-3xl bg-white" /><div className="grid grid-cols-2 gap-3"><div className="h-28 animate-pulse rounded-2xl bg-white" /><div className="h-28 animate-pulse rounded-2xl bg-white" /></div></div>
      ) : summary && data && comparison ? (
        <main className="px-3 py-4">
          {tab === 'overview' && (
            <div className="space-y-3">
              <section className="relative overflow-hidden rounded-3xl bg-slate-950 p-5 text-white shadow-[0_16px_40px_-20px_rgba(15,23,42,0.8)]">
                <div className="absolute -right-12 -top-14 h-40 w-40 rounded-full bg-indigo-500/25 blur-2xl" />
                <div className="relative">
                  <div className="flex items-center gap-2"><span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-indigo-200">管理结论</span>{sampleInsufficient && <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[10px] font-bold text-amber-200">样本积累期</span>}</div>
                  <h1 className="mt-4 text-[25px] font-black leading-tight tracking-tight">{adoptionTitle}</h1>
                  <p className="mt-3 text-xs leading-5 text-white/60">近 {days} 天覆盖 {summary.coverageRate}% 的在用账号，共产生 {summary.questions} 个真实问题。</p>
                  <div className="mt-5 grid grid-cols-3 divide-x divide-white/10 rounded-2xl bg-white/[0.06] py-3 text-center">
                    <div><p className="text-xl font-black">{summary.activeUsers}</p><p className="mt-1 text-[10px] text-white/50">活跃人数 {activeDelta === 0 ? '持平' : `${activeDelta > 0 ? '+' : ''}${activeDelta}`}</p></div>
                    <div><p className="text-xl font-black">{summary.repeatUsers}</p><p className="mt-1 text-[10px] text-white/50">跨天复用 {repeatDelta === 0 ? '持平' : `${repeatDelta > 0 ? '+' : ''}${repeatDelta}`}</p></div>
                    <div><p className="text-xl font-black">{summary.openFeedback}</p><p className="mt-1 text-[10px] text-white/50">待处理反馈</p></div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <MetricCard label="采用覆盖" value={`${summary.coverageRate}%`} detail={`${summary.activeUsers}/${summary.eligibleUsers} 个在用账号`} />
                <MetricCard label="跨天复用率" value={`${summary.repeatRate}%`} detail={`${summary.repeatUsers} 人形成复用`} tone="teal" />
                <MetricCard label="真实问题" value={`${summary.questions}`} detail={`较上期 ${summary.questions - comparison.questions >= 0 ? '+' : ''}${summary.questions - comparison.questions}`} tone="amber" />
                <MetricCard label="有效反馈" value={`${summary.feedbackCount}`} detail={`有帮助率 ${summary.helpfulRate}%`} tone={summary.openFeedback > 0 ? 'rose' : 'indigo'} />
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-bold text-slate-900">管理关注</h2><p className="mt-1 text-[11px] text-slate-400">点击查看对应人员或反馈</p></div>
                <button type="button" onClick={() => openPeople('not_used')} className="flex min-h-16 w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left active:bg-slate-50"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-xs font-black text-rose-600">1</span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">{notUsed} 人尚未形成使用</strong><span className="mt-1 block text-[11px] text-slate-400">查看部门覆盖缺口</span></span><ChevronRight size={17} className="text-slate-300" /></button>
                <button type="button" onClick={() => openPeople(oneTime > 0 ? 'one_time' : 'repeat')} className="flex min-h-16 w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left active:bg-slate-50"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-xs font-black text-amber-700">2</span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">{oneTime > 0 ? `${oneTime} 人仅尝试一次` : `${summary.repeatUsers} 人跨天复用`}</strong><span className="mt-1 block text-[11px] text-slate-400">当前复用率 {summary.repeatRate}%</span></span><ChevronRight size={17} className="text-slate-300" /></button>
                <button type="button" onClick={openFeedback} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-xs font-black text-sky-700">3</span><span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">{summary.openFeedback > 0 ? `${summary.openFeedback} 条问题待闭环` : `有效反馈 ${summary.feedbackCount}/30`}</strong><span className="mt-1 block text-[11px] text-slate-400">查看真实问答与评价</span></span><ChevronRight size={17} className="text-slate-300" /></button>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between"><div><h2 className="text-sm font-bold text-slate-900">采用趋势</h2><p className="mt-1 text-[11px] text-slate-400">每日提问量</p></div><Activity size={18} className="text-indigo-500" /></div>
                <div className="mt-3 h-44">
                  <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}><defs><linearGradient id="mobileTrend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} /><stop offset="95%" stopColor="#4f46e5" stopOpacity={0.02} /></linearGradient></defs><XAxis dataKey="day" axisLine={false} tickLine={false} minTickGap={28} tick={{ fontSize: 9, fill: '#94a3b8' }} /><Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', fontSize: 11 }} /><Area type="monotone" dataKey="questions" name="提问" stroke="#4f46e5" strokeWidth={2.2} fill="url(#mobileTrend)" /></AreaChart></ResponsiveContainer>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2"><Building2 size={17} className="text-indigo-500" /><h2 className="text-sm font-bold text-slate-900">部门采用</h2></div>
                <div className="mt-4 space-y-3">{data.departments.slice(0, 5).map((department) => <button key={department.department} type="button" onClick={() => { setPeopleDepartment(department.department); setPeopleStage('all'); selectTab('people'); }} className="block min-h-11 w-full rounded-xl px-1 py-1 text-left active:bg-slate-50"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-700">{department.department}</span><span className="font-bold text-slate-900">{department.adoptionRate}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${department.adoptionRate}%` }} /></div><p className="mt-1 text-[10px] text-slate-400">{department.activeUsers}/{department.eligibleUsers} 人 · 较上期 {department.adoptionRate - department.previousAdoptionRate >= 0 ? '+' : ''}{Number((department.adoptionRate - department.previousAdoptionRate).toFixed(1))}pp</p></button>)}</div>
              </section>

              <section className={cn('rounded-2xl border p-4 shadow-sm', sampleInsufficient ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
                <div className="flex items-start gap-3"><span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', sampleInsufficient ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}><Target size={20} /></span><div><h2 className="text-sm font-bold text-slate-900">样本门槛</h2><p className="mt-1 text-xs leading-5 text-slate-600">活跃人员 {summary.activeUsers}/10 · 有效反馈 {summary.feedbackCount}/30</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{sampleInsufficient ? '样本不足，暂不启动模型共性优化。' : '达到初步门槛，可开始问题归因。'}</p></div></div>
              </section>
            </div>
          )}

          {tab === 'people' && (
            <div className="space-y-3">
              <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between"><div><h1 className="text-base font-black text-slate-950">人员使用</h1><p className="mt-1 text-[11px] text-slate-400">共 {filteredPeople.length} 人</p></div>{(peopleQuery || peopleDepartment !== 'all' || peopleStage !== 'all') && <button type="button" onClick={() => { setPeopleQuery(''); setPeopleDepartment('all'); setPeopleStage('all'); }} className="h-11 rounded-xl px-3 text-xs font-bold text-indigo-600 active:bg-indigo-50">重置</button>}</div>
                <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input value={peopleQuery} onChange={(event) => setPeopleQuery(event.target.value)} placeholder="搜索姓名、部门、职位或场景" className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-300" /></label>
                <select value={peopleDepartment} onChange={(event) => setPeopleDepartment(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"><option value="all">全部部门</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</select>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{PEOPLE_STAGES.map((stage) => <button key={stage.value} type="button" onClick={() => setPeopleStage(stage.value)} className={cn('h-11 shrink-0 rounded-full px-3.5 text-xs font-bold', peopleStage === stage.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}>{stage.label}</button>)}</div>
              </section>
              <div className="space-y-3">{pagedPeople.map((row) => { const stage = stageMeta(row); return <button key={row.userId} type="button" onClick={() => openPersonDetail(row.userId)} className="block w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.99]"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-base font-black text-indigo-700">{String(row.name ?? '').slice(0, 1) || '?'}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="truncate text-sm text-slate-950">{row.name}</strong><span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-bold', stage.className)}>{stage.label}</span></span><span className="mt-1 block truncate text-[11px] text-slate-400">{row.department}{row.role ? ` · ${row.role}` : ''}</span></span><ChevronRight size={18} className="mt-2 shrink-0 text-slate-300" /></div><div className="mt-4 grid grid-cols-3 divide-x divide-slate-100 rounded-xl bg-slate-50 py-2.5 text-center"><span><strong className="block text-sm text-slate-900">{row.questions}</strong><small className="text-[10px] text-slate-400">提问</small></span><span><strong className="block text-sm text-slate-900">{row.activeDays}</strong><small className="text-[10px] text-slate-400">活跃天</small></span><span><strong className="block truncate px-1 text-xs text-slate-700">{row.primaryScenario}</strong><small className="text-[10px] text-slate-400">主要用途</small></span></div><p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400"><Clock3 size={12} />最近使用 {formatDateTime(row.lastActiveAt)}</p></button>; })}{filteredPeople.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-sm text-slate-400">没有符合条件的人员</div>}</div>
              <MobilePager page={safePeoplePage} pageSize={pageSize} total={filteredPeople.length} onChange={setPeoplePage} />
            </div>
          )}

          {tab === 'feedback' && (
            <div className="space-y-3">
              <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between"><div><h1 className="text-base font-black text-slate-950">反馈与问题</h1><p className="mt-1 text-[11px] text-slate-400">共 {filteredFeedback.length} 条</p></div>{(feedbackQuery || feedbackReaction !== 'all' || feedbackStatus !== 'all' || feedbackDepartment !== 'all') && <button type="button" onClick={() => { setFeedbackQuery(''); setFeedbackReaction('all'); setFeedbackStatus('all'); setFeedbackDepartment('all'); }} className="h-11 rounded-xl px-3 text-xs font-bold text-indigo-600 active:bg-indigo-50">重置</button>}</div>
                <label className="relative mt-3 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><input value={feedbackQuery} onChange={(event) => setFeedbackQuery(event.target.value)} placeholder="搜索人员、问题、回答或反馈" className="h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-300" /></label>
                <div className="mt-2 grid grid-cols-2 gap-2"><select value={feedbackReaction} onChange={(event) => setFeedbackReaction(event.target.value as FeedbackReaction)} className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-xs"><option value="all">全部类型</option><option value="like">有帮助</option><option value="dislike">需改进</option></select><select value={feedbackStatus} onChange={(event) => setFeedbackStatus(event.target.value as FeedbackStatus)} className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-xs"><option value="all">全部状态</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                <select value={feedbackDepartment} onChange={(event) => setFeedbackDepartment(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="all">全部部门</option>{feedbackDepartments.map((department) => <option key={department} value={department}>{department}</option>)}</select>
              </section>
              <div className="space-y-3">{pagedFeedback.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-2"><button type="button" onClick={() => openPersonDetail(row.userId)} className="min-h-11 min-w-0 py-1 text-left"><strong className="block truncate text-sm text-slate-950">{row.user}</strong><span className="mt-1 block text-[11px] text-slate-400">{row.department}</span></button><span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold', STATUS_TONE[row.status])}>{STATUS_LABEL[row.status]}</span></div><div className="mt-3 flex items-center gap-2"><span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold', row.reaction === 'like' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{row.reaction === 'like' ? <ThumbsUp size={11} /> : <ThumbsDown size={11} />}{row.reaction === 'like' ? '有帮助' : '需改进'}</span><span className="text-[10px] text-slate-400">{formatDateTime(row.submittedAt)}</span></div>{(row.reasonLabels ?? []).length > 0 && <p className="mt-3 text-xs font-semibold leading-5 text-slate-700">{(row.reasonLabels ?? []).join('、')}</p>}{row.comment && <p className="mt-1 text-xs leading-5 text-slate-500">“{row.comment}”</p>}<div className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3 text-xs leading-5"><p className="line-clamp-2 text-slate-700"><strong className="text-slate-400">问：</strong>{row.question || '—'}</p><p className="line-clamp-3 text-slate-500"><strong className="text-slate-400">答：</strong>{row.answer || '—'}</p></div>{row.resolutionNote && <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">处理结论：{row.resolutionNote}</p>}</article>)}{filteredFeedback.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center"><AlertTriangle size={22} className="mx-auto text-slate-300" /><p className="mt-2 text-sm text-slate-400">没有符合条件的反馈</p></div>}</div>
              <MobilePager page={safeFeedbackPage} pageSize={pageSize} total={filteredFeedback.length} onChange={setFeedbackPage} />
            </div>
          )}
        </main>
      ) : <div className="px-3 py-16 text-center"><p className="text-sm text-rose-600">使用数据暂时无法加载</p><button type="button" onClick={() => void load()} className="mt-4 min-h-11 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white active:bg-indigo-700">重新加载</button></div>}

      {selectedUserId && <PersonDetail detail={userDetail} loading={detailLoading} onClose={closePersonDetail} />}
    </div>
  );
}
