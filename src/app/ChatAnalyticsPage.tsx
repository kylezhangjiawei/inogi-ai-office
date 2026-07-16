import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Gauge,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Repeat2,
  Search,
  Share2,
  Sparkles,
  Target,
  ThumbsDown,
  ThumbsUp,
  UserRoundCheck,
  UserRoundX,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';
import { cn } from './components/ui/utils';
import { useAuth } from './auth';
import {
  chatAnalyticsApi,
  type ChatAnalyticsData,
  type ChatAnalyticsUserDetail,
  type ChatFeedbackRow,
} from './lib/chatAnalyticsApi';
import { hasPermission } from './lib/permissions';

type RangeDays = 7 | 30 | 90;
type FeedbackFilter = 'all' | ChatFeedbackRow['status'];
type FeedbackReactionFilter = 'all' | ChatFeedbackRow['reaction'];
type PeopleFilter = 'all' | 'repeat' | 'light' | 'one_time' | 'not_used';

const RANGE_OPTIONS: Array<{ value: RangeDays; label: string }> = [
  { value: 7, label: '近 7 天' },
  { value: 30, label: '近 30 天' },
  { value: 90, label: '近 90 天' },
];

const STATUS_META: Record<ChatFeedbackRow['status'], { label: string; className: string }> = {
  open: { label: '待处理', className: 'border-rose-200 bg-rose-50 text-rose-700' },
  in_progress: { label: '处理中', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  resolved: { label: '已解决', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  ignored: { label: '已忽略', className: 'border-slate-200 bg-slate-100 text-slate-600' },
};

const PEOPLE_FILTERS: Array<{ value: PeopleFilter; label: string }> = [
  { value: 'all', label: '全部人员' },
  { value: 'repeat', label: '跨天复用' },
  { value: 'light', label: '轻度使用' },
  { value: 'one_time', label: '仅尝试一次' },
  { value: 'not_used', label: '尚未使用' },
];

function adoptionStage(row: ChatAnalyticsData['userAdoption'][number]) {
  if (row.questions === 0) return { label: '尚未使用', className: 'bg-slate-100 text-slate-600' };
  if (row.activeDays >= 2) return { label: '跨天复用', className: 'bg-emerald-50 text-emerald-700' };
  if (row.questions === 1) return { label: '仅尝试一次', className: 'bg-amber-50 text-amber-700' };
  return { label: '轻度使用', className: 'bg-sky-50 text-sky-700' };
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatMs(value: number | null) {
  if (value === null) return '—';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function signed(value: number, suffix = '') {
  if (value === 0) return `持平`;
  return `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}${suffix}`;
}

function SectionHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {aside}
    </div>
  );
}

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return <span className="text-slate-400">较上期持平</span>;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5', value > 0 ? 'text-emerald-600' : 'text-rose-600')}>
      <Icon className="h-3.5 w-3.5" />较上期 {signed(value, suffix)}
    </span>
  );
}

function ProgressMetric({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  const progress = Math.min(100, Math.round((value / target) * 100));
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{value}<span className="text-sm font-medium text-slate-400">/{target} {unit}</span></p>
        </div>
        <span className="text-xs font-medium text-slate-400">{progress}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function ListPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const firstItem = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastItem = Math.min(totalItems, safePage * pageSize);
  const firstPage = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const visiblePages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => firstPage + index);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/55 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between lg:px-6">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>第 {firstItem}–{lastItem} 条，共 {totalItems} 条</span>
        <label className="flex items-center gap-2">
          每页
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          >
            {pageSizeOptions.map((size) => <option key={size} value={size}>{size} 条</option>)}
          </select>
        </label>
      </div>
      <nav className="flex items-center gap-1" aria-label="列表分页">
        <button
          type="button"
          aria-label="上一页"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {visiblePages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            aria-label={`第 ${pageNumber} 页`}
            aria-current={safePage === pageNumber ? 'page' : undefined}
            onClick={() => onPageChange(pageNumber)}
            className={cn(
              'h-8 min-w-8 rounded-lg px-2 text-xs font-semibold transition-colors',
              safePage === pageNumber ? 'bg-indigo-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600',
            )}
          >
            {pageNumber}
          </button>
        ))}
        <button
          type="button"
          aria-label="下一页"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-indigo-200 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </nav>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function ChatAnalyticsPage() {
  const { user } = useAuth();
  const canManageFeedback = hasPermission(user?.permissions ?? [], 'chat-feedback:manage');
  const [days, setDays] = useState<RangeDays>(30);
  const [data, setData] = useState<ChatAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [userQuery, setUserQuery] = useState('');
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null);
  const [scenarioFilter, setScenarioFilter] = useState('all');
  const [peoplePage, setPeoplePage] = useState(1);
  const [peoplePageSize, setPeoplePageSize] = useState(10);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<ChatAnalyticsUserDetail | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackFilter>('all');
  const [feedbackReaction, setFeedbackReaction] = useState<FeedbackReactionFilter>('all');
  const [feedbackDepartment, setFeedbackDepartment] = useState('all');
  const [feedbackQuery, setFeedbackQuery] = useState('');
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackPageSize, setFeedbackPageSize] = useState(10);
  const [activityQuery, setActivityQuery] = useState('');
  const [activityScenario, setActivityScenario] = useState('all');
  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = useState(5);
  const [personFeedbackReaction, setPersonFeedbackReaction] = useState<FeedbackReactionFilter>('all');
  const [personFeedbackStatus, setPersonFeedbackStatus] = useState<FeedbackFilter>('all');
  const [personFeedbackPage, setPersonFeedbackPage] = useState(1);
  const [personFeedbackPageSize, setPersonFeedbackPageSize] = useState(5);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<{
    row: ChatFeedbackRow;
    status: ChatFeedbackRow['status'];
    resolutionNote: string;
  } | null>(null);
  const peopleSectionRef = useRef<HTMLElement>(null);
  const feedbackSectionRef = useRef<HTMLElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await chatAnalyticsApi.getDashboard(days));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedUserId) {
      setUserDetail(null);
      return;
    }
    let active = true;
    setUserDetailLoading(true);
    setUserDetail(null);
    void chatAnalyticsApi.getUserDetail(selectedUserId, days)
      .then((detail) => {
        if (active) setUserDetail(detail);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : '加载人员详情失败');
      })
      .finally(() => {
        if (active) setUserDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days, selectedUserId]);

  const filteredUsers = useMemo(() => {
    const keyword = userQuery.trim().toLowerCase();
    return (data?.userAdoption ?? []).filter((row) => {
      const matchesKeyword = !keyword || [row.name, row.department, row.role, row.primaryScenario]
        .some((value) => value.toLowerCase().includes(keyword));
      const matchesDepartment = !departmentFilter || row.department === departmentFilter;
      const matchesScenario = scenarioFilter === 'all' || row.primaryScenario === scenarioFilter;
      const matchesSegment = peopleFilter === 'all'
        || (peopleFilter === 'repeat' && row.activeDays >= 2)
        || (peopleFilter === 'light' && row.questions > 1 && row.activeDays < 2)
        || (peopleFilter === 'one_time' && row.questions === 1)
        || (peopleFilter === 'not_used' && row.questions === 0);
      return matchesKeyword && matchesDepartment && matchesScenario && matchesSegment;
    });
  }, [data, departmentFilter, peopleFilter, scenarioFilter, userQuery]);

  const filteredFeedback = useMemo(() => {
    const keyword = feedbackQuery.trim().toLowerCase();
    return (data?.recentFeedback ?? []).filter((row) => {
      const matchesKeyword = !keyword || [row.user, row.department, row.comment, row.question, row.answer, ...row.reasonLabels]
        .some((value) => value.toLowerCase().includes(keyword));
      const matchesStatus = feedbackStatus === 'all' || row.status === feedbackStatus;
      const matchesReaction = feedbackReaction === 'all' || row.reaction === feedbackReaction;
      const matchesDepartment = feedbackDepartment === 'all' || row.department === feedbackDepartment;
      return matchesKeyword && matchesStatus && matchesReaction && matchesDepartment;
    });
  }, [data, feedbackDepartment, feedbackQuery, feedbackReaction, feedbackStatus]);

  const departmentOptions = useMemo(() => [...new Set((data?.userAdoption ?? []).map((row) => row.department))].sort(), [data]);
  const scenarioOptions = useMemo(() => [...new Set((data?.userAdoption ?? [])
    .filter((row) => row.questions > 0)
    .map((row) => row.primaryScenario))].sort(), [data]);
  const feedbackDepartmentOptions = useMemo(() => [...new Set((data?.recentFeedback ?? []).map((row) => row.department))].sort(), [data]);
  const peopleTotalPages = Math.max(1, Math.ceil(filteredUsers.length / peoplePageSize));
  const feedbackTotalPages = Math.max(1, Math.ceil(filteredFeedback.length / feedbackPageSize));
  const safePeoplePage = Math.min(peoplePage, peopleTotalPages);
  const safeFeedbackPage = Math.min(feedbackPage, feedbackTotalPages);
  const pagedUsers = filteredUsers.slice((safePeoplePage - 1) * peoplePageSize, safePeoplePage * peoplePageSize);
  const pagedFeedback = filteredFeedback.slice((safeFeedbackPage - 1) * feedbackPageSize, safeFeedbackPage * feedbackPageSize);
  const activityScenarioOptions = [...new Set((userDetail?.recentActivity ?? []).map((row) => row.scenario))].sort();
  const filteredActivity = (userDetail?.recentActivity ?? []).filter((row) => {
    const keyword = activityQuery.trim().toLowerCase();
    const matchesKeyword = !keyword || [row.question, row.answer, row.scenario, row.model ?? '']
      .some((value) => value.toLowerCase().includes(keyword));
    return matchesKeyword && (activityScenario === 'all' || row.scenario === activityScenario);
  });
  const activityTotalPages = Math.max(1, Math.ceil(filteredActivity.length / activityPageSize));
  const safeActivityPage = Math.min(activityPage, activityTotalPages);
  const pagedActivity = filteredActivity.slice((safeActivityPage - 1) * activityPageSize, safeActivityPage * activityPageSize);
  const filteredPersonFeedback = (userDetail?.feedback ?? []).filter((row) =>
    (personFeedbackReaction === 'all' || row.reaction === personFeedbackReaction)
    && (personFeedbackStatus === 'all' || row.status === personFeedbackStatus));
  const personFeedbackTotalPages = Math.max(1, Math.ceil(filteredPersonFeedback.length / personFeedbackPageSize));
  const safePersonFeedbackPage = Math.min(personFeedbackPage, personFeedbackTotalPages);
  const pagedPersonFeedback = filteredPersonFeedback.slice(
    (safePersonFeedbackPage - 1) * personFeedbackPageSize,
    safePersonFeedbackPage * personFeedbackPageSize,
  );

  useEffect(() => {
    setPeoplePage(1);
  }, [userQuery, peopleFilter, departmentFilter, scenarioFilter, peoplePageSize, days]);

  useEffect(() => {
    setFeedbackPage(1);
  }, [feedbackQuery, feedbackStatus, feedbackReaction, feedbackDepartment, feedbackPageSize, days]);

  useEffect(() => {
    setActivityQuery('');
    setActivityScenario('all');
    setActivityPage(1);
    setPersonFeedbackReaction('all');
    setPersonFeedbackStatus('all');
    setPersonFeedbackPage(1);
  }, [selectedUserId, days]);

  useEffect(() => {
    setActivityPage(1);
  }, [activityQuery, activityScenario, activityPageSize]);

  useEffect(() => {
    setPersonFeedbackPage(1);
  }, [personFeedbackReaction, personFeedbackStatus, personFeedbackPageSize]);

  const requestStatusUpdate = (row: ChatFeedbackRow, status: ChatFeedbackRow['status']) => {
    if (status === row.status) return;
    setStatusDraft({ row, status, resolutionNote: row.resolutionNote });
  };

  const updateStatus = async () => {
    if (!statusDraft) return;
    const resolutionNote = statusDraft.resolutionNote.trim();
    if ((statusDraft.status === 'resolved' || statusDraft.status === 'ignored') && !resolutionNote) {
      toast.error('解决或忽略反馈时必须填写处理结论');
      return;
    }
    setUpdatingId(statusDraft.row.id);
    try {
      const updated = await chatAnalyticsApi.updateFeedback(statusDraft.row.id, {
        status: statusDraft.status,
        resolutionNote,
      });
      setData((current) => current ? {
        ...current,
        recentFeedback: current.recentFeedback.map((item) => item.id === statusDraft.row.id
          ? { ...item, status: statusDraft.status, resolutionNote: updated.resolutionNote }
          : item),
        feedbackStatus: current.feedbackStatus.map((item) => item.status === statusDraft.row.status
          ? { ...item, count: Math.max(0, item.count - 1) }
          : item.status === statusDraft.status
            ? { ...item, count: item.count + 1 }
            : item),
      } : current);
      setStatusDraft(null);
      toast.success('处理状态已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败');
    } finally {
      setUpdatingId(null);
    }
  };

  const scrollToPeople = (filter: PeopleFilter, department: string | null = null) => {
    setUserQuery('');
    setPeopleFilter(filter);
    setDepartmentFilter(department);
    setScenarioFilter('all');
    setPeoplePage(1);
    window.requestAnimationFrame(() => peopleSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const resetPeopleFilters = () => {
    setUserQuery('');
    setPeopleFilter('all');
    setDepartmentFilter(null);
    setScenarioFilter('all');
    setPeoplePage(1);
  };

  const resetFeedbackFilters = () => {
    setFeedbackQuery('');
    setFeedbackStatus('all');
    setFeedbackReaction('all');
    setFeedbackDepartment('all');
    setFeedbackPage(1);
  };

  const scrollToFeedback = () => {
    window.requestAnimationFrame(() => feedbackSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const summary = data?.summary;
  const comparison = data?.comparison;
  const trendData = data?.trend.map((row) => ({ ...row, day: row.date.slice(5) })) ?? [];
  const topScenario = data?.scenarios[0];
  const sampleInsufficient = Boolean(summary && (summary.activeUsers < 10 || summary.feedbackCount < 30));
  const activeDelta = summary && comparison ? summary.activeUsers - comparison.activeUsers : 0;
  const questionDelta = summary && comparison ? summary.questions - comparison.questions : 0;
  const repeatDelta = summary && comparison ? summary.repeatUsers - comparison.repeatUsers : 0;
  const notUsedCount = summary ? Math.max(0, summary.eligibleUsers - summary.activeUsers) : 0;
  const oneTimeCount = data?.userAdoption.filter((row) => row.questions === 1).length ?? 0;
  const sustainedUsers = (data?.userAdoption ?? [])
    .filter((row) => row.activeDays >= 2)
    .sort((a, b) => b.activeDays - a.activeDays || b.questions - a.questions);
  const lowAdoptionDepartment = [...(data?.departments ?? [])]
    .filter((row) => row.eligibleUsers > 0)
    .sort((a, b) => a.adoptionRate - b.adoptionRate || b.eligibleUsers - a.eligibleUsers)[0];
  const activeFeedbackStatuses = data?.feedbackStatus.filter((row) => row.count > 0) ?? [];
  const showFeedback = Boolean(summary && (summary.feedbackCount > 0 || summary.openFeedback > 0));
  const hasPeopleFilters = Boolean(userQuery || peopleFilter !== 'all' || departmentFilter || scenarioFilter !== 'all');
  const hasFeedbackFilters = Boolean(feedbackQuery || feedbackStatus !== 'all' || feedbackReaction !== 'all' || feedbackDepartment !== 'all');
  const adoptionTitle = !summary
    ? '暂无使用数据'
    : summary.coverageRate >= 60 && summary.repeatRate >= 40
      ? '采用已形成规模，重点转向使用质量'
      : summary.activeUsers > 0 && summary.repeatRate < 40
        ? '采用正在起步，但复用仍不足'
        : summary.activeUsers > 0
          ? '采用范围仍小，尚处于验证阶段'
          : '尚未形成实际使用';

  return (
    <main className="min-h-full bg-[#f5f7fb] px-4 py-5 lg:px-7">
      <div className="mx-auto max-w-[1580px]">
        <header className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">
              <Activity className="h-4 w-4" />MateChat 使用观察
            </div>
            {data && <span className="text-xs text-slate-400">数据更新于 {formatDateTime(data.dataFreshness.generatedAt)}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" aria-label="统计周期">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDays(option.value)}
                  className={cn(
                    'cursor-pointer rounded-lg px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                    days === option.value ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />刷新
            </button>
          </div>
        </header>

        {loading && !data ? (
          <div className="mt-5 space-y-4">
            <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.8fr)]">
              <div className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-white" />
              <div className="h-96 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            </div>
          </div>
        ) : summary && data && comparison ? (
          summary.eligibleUsers === 0 ? (
            <section className="mt-5 rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <Users className="mx-auto h-10 w-10 text-slate-300" />
              <h2 className="mt-4 text-lg font-semibold text-slate-900">暂无可观察的在用账号</h2>
              <p className="mt-2 text-sm text-slate-500">请先同步组织人员与账号状态。</p>
            </section>
          ) : (
            <>
              <section className="relative mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
                <div className="absolute inset-y-0 left-0 w-1 bg-indigo-500" />
                <div className="grid xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.75fr)]">
                  <div className="px-6 py-6 lg:px-7">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">管理结论</span>
                      {sampleInsufficient && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">样本积累期</span>}
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 lg:text-[28px]">{adoptionTitle}</h2>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
                      <span><strong className="font-semibold text-slate-950">{summary.activeUsers} 人</strong>活跃 <span className="ml-1 text-xs"><Delta value={activeDelta} /></span></span>
                      <span className="hidden h-4 w-px bg-slate-200 sm:block" />
                      <span><strong className="font-semibold text-slate-950">{summary.repeatUsers} 人</strong>跨天复用 <span className="ml-1 text-xs"><Delta value={repeatDelta} /></span></span>
                      <span className="hidden h-4 w-px bg-slate-200 sm:block" />
                      <span><strong className="font-semibold text-slate-950">{summary.openFeedback} 条</strong>待处理反馈</span>
                    </div>
                    <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-500">
                      近 {days} 天覆盖 {summary.coverageRate}% 的在用账号，共产生 {summary.questions} 个真实问题。
                      {topScenario ? `最常见用途是“${topScenario.label}”，涉及 ${topScenario.users} 人。` : ''}
                    </p>
                  </div>
                  <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-5 xl:border-l xl:border-t-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">优化判断</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{sampleInsufficient ? '暂不启动模型优化' : '可进入问题归因阶段'}</p>
                      </div>
                      <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', sampleInsufficient ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                        {sampleInsufficient ? <Target className="h-5 w-5" /> : <BadgeCheck className="h-5 w-5" />}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {sampleInsufficient ? '先补足多部门真实使用与有效反馈，再判断共性问题。' : '样本已达到初步门槛，可按场景和反馈原因评估优化优先级。'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.8fr)]">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.035)] lg:p-6">
                  <SectionHeader
                    title="采用趋势"
                    description="提问量与每日活跃人数放在同一视图，观察使用增长是否具有连续性。"
                    aside={<span className="text-xs"><Delta value={questionDelta} /></span>}
                  />
                  <div className="mt-5 h-[310px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData} margin={{ top: 8, right: 5, left: -22, bottom: 0 }}>
                        <defs>
                          <linearGradient id="questionsArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.22} />
                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 5" stroke="#e8edf4" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#7c899d' }} axisLine={false} tickLine={false} minTickGap={28} />
                        <YAxis yAxisId="questions" allowDecimals={false} tick={{ fontSize: 11, fill: '#7c899d' }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="users" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#7c899d' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#e2e8f0', boxShadow: '0 10px 30px rgba(15,23,42,.08)', fontSize: 12 }} />
                        <Area yAxisId="questions" type="monotone" dataKey="questions" name="提问量" stroke="#4f46e5" strokeWidth={2.2} fill="url(#questionsArea)" />
                        <Line yAxisId="users" type="monotone" dataKey="activeUsers" name="日活人数" stroke="#0f8c88" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-1 flex items-center gap-5 border-t border-slate-100 pt-3 text-xs text-slate-500">
                    <span className="flex items-center gap-2"><i className="h-0.5 w-5 rounded-full bg-indigo-600" />提问量</span>
                    <span className="flex items-center gap-2"><i className="h-0.5 w-5 rounded-full bg-teal-600" />日活人数</span>
                    <span className="ml-auto">最近使用 {formatDateTime(data.dataFreshness.lastQuestionAt)}</span>
                  </div>
                </article>

                <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.035)]">
                  <div className="border-b border-slate-100 px-5 py-4.5">
                    <SectionHeader title="管理关注" description="由当前数据自动识别，点击可下钻查看对应对象。" />
                  </div>
                  <div className="divide-y divide-slate-100">
                    <button type="button" onClick={() => scrollToPeople('not_used')} className="group flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-sm font-semibold text-rose-600">1</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">{notUsedCount > 0 ? `${notUsedCount} 人尚未形成使用` : '所有在用账号均已尝试'}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{notUsedCount > 0 ? `占全部在用账号 ${Number(((notUsedCount / summary.eligibleUsers) * 100).toFixed(1))}%，需结合部门判断覆盖缺口。` : '覆盖已完成，下一步关注复用与质量。'}</span>
                      </span>
                      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                    </button>
                    <button type="button" onClick={() => scrollToPeople(oneTimeCount > 0 ? 'one_time' : 'repeat')} className="group flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-sm font-semibold text-amber-700">2</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">{oneTimeCount > 0 ? `${oneTimeCount} 人仅尝试过一次` : `${summary.repeatUsers} 人已跨天复用`}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">当前复用率 {summary.repeatRate}%，{summary.repeatRate < 40 ? '尚未形成稳定使用习惯。' : '已具备初步持续使用基础。'}</span>
                      </span>
                      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />
                    </button>
                    <button type="button" onClick={showFeedback ? scrollToFeedback : undefined} className="group flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-50">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sm font-semibold text-sky-700">3</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">{summary.openFeedback > 0 ? `${summary.openFeedback} 条问题尚未闭环` : `有效反馈 ${summary.feedbackCount}/30 条`}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{summary.openFeedback > 0 ? '需查看具体问答和原因，避免问题长期悬空。' : summary.feedbackCount < 30 ? '质量样本仍少，暂不宜据此判断模型共性问题。' : '反馈样本达到初步分析门槛。'}</span>
                      </span>
                      {showFeedback && <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-500" />}
                    </button>
                  </div>
                  {lowAdoptionDepartment && (
                    <button type="button" onClick={() => scrollToPeople('all', lowAdoptionDepartment.department)} className="flex w-full cursor-pointer items-center justify-between gap-3 border-t border-indigo-100 bg-indigo-50/60 px-5 py-3 text-left text-xs text-indigo-700 transition-colors hover:bg-indigo-50">
                      <span><Building2 className="mr-1.5 inline h-3.5 w-3.5" />采用率最低：<strong>{lowAdoptionDepartment.department} {lowAdoptionDepartment.adoptionRate}%</strong></span>
                      <span className="font-semibold">查看人员</span>
                    </button>
                  )}
                </article>
              </section>

              <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(290px,0.8fr)_minmax(430px,1.05fr)_minmax(300px,0.75fr)]">
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.03)]">
                  <SectionHeader title="真实用途 Top 3" description="按近期开启的真实问题归类" />
                  <div className="mt-4 divide-y divide-slate-100">
                    {data.scenarios.slice(0, 3).map((scenario, index) => (
                      <div key={scenario.key} className="flex items-center gap-3 py-3 first:pt-1">
                        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', index === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{scenario.label}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{scenario.users} 人参与</p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-semibold text-slate-950">{scenario.questions}</p>
                          <p className="text-[11px] text-slate-400">个问题</p>
                        </div>
                      </div>
                    ))}
                    {data.scenarios.length === 0 && <p className="py-8 text-center text-sm text-slate-400">暂无真实用途样本</p>}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.03)]">
                  <SectionHeader title="部门采用变化" description="采用率 = 活跃人数 ÷ 部门在用账号" />
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-100">
                    <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-400">
                      <span>部门</span><span className="text-right">本期</span><span className="text-right">较上期</span>
                    </div>
                    {data.departments.slice(0, 5).map((department) => {
                      const delta = department.adoptionRate - department.previousAdoptionRate;
                      return (
                        <button key={department.department} type="button" onClick={() => scrollToPeople('all', department.department)} className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_72px_72px] items-center border-t border-slate-100 px-3 py-3 text-left transition-colors hover:bg-indigo-50/40">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-700">{department.department}</span>
                            <span className="mt-0.5 block text-[11px] text-slate-400">{department.activeUsers}/{department.eligibleUsers} 人</span>
                          </span>
                          <span className="text-right text-sm font-semibold text-slate-900">{department.adoptionRate}%</span>
                          <span className={cn('text-right text-xs font-medium', delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-rose-600' : 'text-slate-400')}>{signed(delta, 'pp')}</span>
                        </button>
                      );
                    })}
                  </div>
                </article>

                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_20px_rgba(15,23,42,0.03)]">
                  <SectionHeader title="持续使用人员" description="统计周期内跨天复用" />
                  <div className="mt-4 space-y-2.5">
                    {sustainedUsers.slice(0, 4).map((row) => (
                      <button key={row.userId} type="button" onClick={() => setSelectedUserId(row.userId)} className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-slate-50">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-700">{row.name.slice(0, 1)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{row.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{row.department}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm font-semibold text-slate-900">{row.activeDays} 天</span>
                          <span className="block text-[11px] text-slate-400">{row.questions} 问</span>
                        </span>
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500" />
                      </button>
                    ))}
                    {sustainedUsers.length === 0 && (
                      <div className="rounded-xl bg-amber-50 px-4 py-5 text-center">
                        <Repeat2 className="mx-auto h-5 w-5 text-amber-500" />
                        <p className="mt-2 text-sm font-medium text-amber-800">尚无跨天复用人员</p>
                        <button type="button" onClick={() => scrollToPeople('one_time')} className="mt-2 text-xs font-semibold text-amber-700">查看试用人员</button>
                      </div>
                    )}
                  </div>
                </article>
              </section>

              <section className="mt-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-[0_4px_20px_rgba(15,23,42,0.025)] lg:px-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                  <div className="lg:w-56">
                    <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Target className="h-4 w-4 text-indigo-500" />样本门槛进度</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">达到门槛后再评估模型共性优化</p>
                  </div>
                  <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
                    <ProgressMetric label="真实活跃人员" value={summary.activeUsers} target={10} unit="人" />
                    <span className="hidden h-10 w-px bg-slate-200 sm:block" />
                    <ProgressMetric label="有效反馈" value={summary.feedbackCount} target={30} unit="条" />
                  </div>
                  <div className={cn('rounded-xl border px-4 py-3 text-xs leading-5 lg:w-64', sampleInsufficient ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
                    {sampleInsufficient ? '样本尚不足，优先扩大真实使用与反馈覆盖。' : '样本达到初步门槛，可开始问题归因分析。'}
                  </div>
                </div>
              </section>

              <section ref={peopleSectionRef} className="mt-4 scroll-mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.03)]">
                <div className="border-b border-slate-100 px-5 py-4 lg:px-6">
                  <SectionHeader
                    title="人员使用明细"
                    description="覆盖全部在用账号；点击人员查看具体使用记录与反馈。"
                  />
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.3fr)_minmax(160px,0.8fr)_minmax(180px,0.9fr)_auto]">
                    <label className="relative block">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="搜索姓名、部门、职位或场景" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
                    </label>
                    <select value={departmentFilter ?? 'all'} onChange={(event) => setDepartmentFilter(event.target.value === 'all' ? null : event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按部门筛选人员">
                      <option value="all">全部部门</option>
                      {departmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}
                    </select>
                    <select value={scenarioFilter} onChange={(event) => setScenarioFilter(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按使用场景筛选人员">
                      <option value="all">全部使用场景</option>
                      {scenarioOptions.map((scenario) => <option key={scenario} value={scenario}>{scenario}</option>)}
                    </select>
                    <button type="button" onClick={resetPeopleFilters} disabled={!hasPeopleFilters} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                      <RefreshCw className="h-3.5 w-3.5" />重置
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    {PEOPLE_FILTERS.map((filter) => (
                      <button key={filter.value} type="button" onClick={() => setPeopleFilter(filter.value)} className={cn('rounded-full px-3 py-1.5 text-xs font-medium transition-colors', peopleFilter === filter.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                        {filter.label}
                      </button>
                    ))}
                    <span className="ml-auto text-xs text-slate-400">共 {filteredUsers.length} 人</span>
                  </div>
                </div>
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80">
                        <TableHead className="min-w-56">姓名 / 部门</TableHead>
                        <TableHead>采用阶段</TableHead>
                        <TableHead>提问</TableHead>
                        <TableHead>活跃天数</TableHead>
                        <TableHead className="min-w-40">主要用途</TableHead>
                        <TableHead>最近使用</TableHead>
                        <TableHead className="w-20 text-right">详情</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedUsers.map((row) => {
                        const stage = adoptionStage(row);
                        return (
                          <TableRow key={row.userId} tabIndex={0} role="button" aria-label={`查看 ${row.name} 的使用详情`} onClick={() => setSelectedUserId(row.userId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedUserId(row.userId); } }} className="cursor-pointer transition-colors hover:bg-indigo-50/45 focus:bg-indigo-50/60 focus:outline-none">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold', row.questions > 0 ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500')}>{row.name.slice(0, 1)}</span>
                              <div>
                                <p className="font-semibold text-slate-900">{row.name}</p>
                                <p className="mt-0.5 text-xs text-slate-500">{row.department}{row.role ? ` · ${row.role}` : ''}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-medium', stage.className)}>{stage.label}</span></TableCell>
                          <TableCell className="font-semibold text-slate-900">{row.questions}</TableCell>
                          <TableCell>{row.activeDays}</TableCell>
                          <TableCell><span className="text-xs text-slate-600">{row.primaryScenario}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(row.lastActiveAt)}</TableCell>
                          <TableCell className="text-right"><span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">查看<ChevronRight className="h-4 w-4" /></span></TableCell>
                          </TableRow>
                        );
                      })}
                      {filteredUsers.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="py-12 text-center text-sm text-slate-400">没有符合当前筛选条件的人员</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <ListPagination page={safePeoplePage} pageSize={peoplePageSize} totalItems={filteredUsers.length} onPageChange={setPeoplePage} onPageSizeChange={setPeoplePageSize} />
              </section>

              {showFeedback && (
                <section ref={feedbackSectionRef} className="mt-4 scroll-mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.03)]">
                  <div className="border-b border-slate-100 px-5 py-4 lg:px-6">
                    <SectionHeader title="反馈与问题跟进" description="点赞作为质量信号；点踩进入问题处理流程并保留处理结论。" />
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1.25fr)_140px_150px_minmax(150px,0.75fr)_auto]">
                      <label className="relative block">
                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                        <input value={feedbackQuery} onChange={(event) => setFeedbackQuery(event.target.value)} placeholder="搜索人员、问题、回答或反馈" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
                      </label>
                      <select value={feedbackReaction} onChange={(event) => setFeedbackReaction(event.target.value as FeedbackReactionFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按反馈类型筛选">
                        <option value="all">全部反馈类型</option>
                        <option value="like">有帮助</option>
                        <option value="dislike">需改进</option>
                      </select>
                      <select value={feedbackStatus} onChange={(event) => setFeedbackStatus(event.target.value as FeedbackFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按处理状态筛选">
                        <option value="all">全部处理状态</option>
                        {Object.entries(STATUS_META).map(([status, meta]) => {
                          const count = activeFeedbackStatuses.find((row) => row.status === status)?.count ?? 0;
                          return <option key={status} value={status}>{meta.label}（{count}）</option>;
                        })}
                      </select>
                      <select value={feedbackDepartment} onChange={(event) => setFeedbackDepartment(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按部门筛选反馈">
                        <option value="all">全部部门</option>
                        {feedbackDepartmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}
                      </select>
                      <button type="button" onClick={resetFeedbackFilters} disabled={!hasFeedbackFilters} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw className="h-3.5 w-3.5" />重置</button>
                    </div>
                    <p className="mt-3 border-t border-slate-100 pt-3 text-right text-xs text-slate-400">共 {filteredFeedback.length} 条</p>
                  </div>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader><TableRow className="bg-slate-50/80"><TableHead>人员</TableHead><TableHead className="min-w-56">反馈</TableHead><TableHead className="min-w-72">对应问答</TableHead><TableHead>时间</TableHead><TableHead>处理状态</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {pagedFeedback.map((row) => (
                          <TableRow key={row.id} className="align-top">
                            <TableCell><button type="button" onClick={() => setSelectedUserId(row.userId)} className="cursor-pointer text-left"><p className="font-semibold text-slate-900">{row.user}</p><p className="mt-1 text-xs text-slate-500">{row.department}</p></button></TableCell>
                            <TableCell>
                              <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium', row.reaction === 'like' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{row.reaction === 'like' ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}{row.reaction === 'like' ? '有帮助' : '需改进'}</span>
                              {row.reasonLabels.length > 0 && <p className="mt-2 text-xs leading-5 text-slate-700">{row.reasonLabels.join('、')}</p>}
                              {row.comment && <p className="mt-1 text-xs leading-5 text-slate-500">“{row.comment}”</p>}
                              {row.resolutionNote && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-600">处理结论：{row.resolutionNote}</p>}
                            </TableCell>
                            <TableCell><p className="line-clamp-2 text-xs leading-5 text-slate-700"><strong className="text-slate-500">问：</strong>{row.question || '—'}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500"><strong>答：</strong>{row.answer || '—'}</p></TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(row.submittedAt)}</TableCell>
                            <TableCell>{row.reaction === 'like' ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">正向信号</span> : canManageFeedback ? (
                              <select aria-label={`更新 ${row.user} 的反馈状态`} value={row.status} disabled={updatingId === row.id} onChange={(event) => requestStatusUpdate(row, event.target.value as ChatFeedbackRow['status'])} className={cn('rounded-lg border px-2 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-60', STATUS_META[row.status].className)}>{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
                            ) : <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs font-medium', STATUS_META[row.status].className)}>{STATUS_META[row.status].label}</span>}</TableCell>
                          </TableRow>
                        ))}
                        {filteredFeedback.length === 0 && <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-slate-400">没有符合当前筛选条件的反馈</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                  <ListPagination page={safeFeedbackPage} pageSize={feedbackPageSize} totalItems={filteredFeedback.length} onPageChange={setFeedbackPage} onPageSizeChange={setFeedbackPageSize} />
                </section>
              )}

              <details className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm">
                <summary className="cursor-pointer font-medium text-slate-600">数据口径与采集状态</summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <p className="leading-5">{Object.values(data.definitions).join('；')}。</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.dataQuality.checks.map((check) => <div key={check.key} className="rounded-lg bg-slate-50 px-3 py-2"><span className="font-medium text-slate-700">{check.label}</span><span className="float-right">{check.value}</span><p className="mt-1 text-[11px] leading-4 text-slate-400">{check.detail}</p></div>)}
                  </div>
                </div>
              </details>
            </>
          )
        ) : (
          <section className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-6 py-12 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-rose-400" />
            <p className="mt-3 text-sm text-rose-700">使用数据暂时无法加载，请稍后重试。</p>
          </section>
        )}
      </div>

      <Sheet open={Boolean(selectedUserId)} onOpenChange={(open) => !open && setSelectedUserId(null)}>
        <SheetContent className="w-full gap-0 overflow-hidden border-slate-200 bg-[#f5f7fb] p-0 sm:max-w-[720px]">
          <SheetHeader className="border-b border-slate-200 bg-white px-6 py-5 pr-12 text-left">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-lg font-semibold text-indigo-700">{(userDetail?.person.name ?? '人').slice(0, 1)}</span>
              <div>
                <SheetTitle className="text-xl text-slate-950">{userDetail?.person.name ?? '人员使用详情'}</SheetTitle>
                <SheetDescription className="mt-1 text-xs text-slate-500">{userDetail ? `${userDetail.person.department}${userDetail.person.position ? ` · ${userDetail.person.position}` : ''}` : `近 ${days} 天使用情况`}</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {userDetailLoading ? (
              <div className="space-y-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-white" />)}</div><div className="h-72 animate-pulse rounded-2xl bg-white" /></div>
            ) : userDetail ? (
              userDetail.summary.questions === 0 ? (
                <section className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500"><UserRoundX className="h-6 w-6" /></span>
                  <h2 className="mt-4 text-lg font-semibold text-slate-900">近 {days} 天尚未使用 MateChat</h2>
                  <p className="mt-2 text-sm text-slate-500">该人员已有完整组织档案，但当前周期没有提交过问题。</p>
                </section>
              ) : (
                <div className="space-y-4">
                  <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <DetailMetric label="提问" value={`${userDetail.summary.questions}`} />
                    <DetailMetric label="会话" value={`${userDetail.summary.conversations}`} />
                    <DetailMetric label="活跃天数" value={`${userDetail.summary.activeDays}`} />
                    <DetailMetric label="AI 回答" value={`${userDetail.summary.answers}`} />
                  </section>
                  <section className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="grid gap-3 text-xs sm:grid-cols-2">
                      <div className="flex items-center gap-2 text-slate-600"><CalendarDays className="h-4 w-4 text-indigo-500" />首次使用：<strong className="font-medium text-slate-900">{formatDate(userDetail.summary.firstUsedAt)}</strong></div>
                      <div className="flex items-center gap-2 text-slate-600"><Clock3 className="h-4 w-4 text-indigo-500" />最近使用：<strong className="font-medium text-slate-900">{formatDateTime(userDetail.summary.lastActiveAt)}</strong></div>
                    </div>
                  </section>
                  {userDetail.scenarios.length > 0 && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-4">
                      <SectionHeader title="主要使用场景" />
                      <div className="mt-4 space-y-3">{userDetail.scenarios.map((scenario) => <div key={scenario.key}><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-slate-700">{scenario.label}</span><span className="font-semibold text-slate-900">{scenario.questions} 问 · {scenario.share}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${scenario.share}%` }} /></div></div>)}</div>
                    </section>
                  )}
                  {userDetail.recentActivity.length > 0 && (
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <div className="p-4">
                        <SectionHeader title="近期使用记录" description="查看该人员在什么时间、用 AI 处理了什么问题。" />
                        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="搜索问题、回答或模型" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></label>
                          <select value={activityScenario} onChange={(event) => setActivityScenario(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按个人使用场景筛选"><option value="all">全部使用场景</option>{activityScenarioOptions.map((scenario) => <option key={scenario} value={scenario}>{scenario}</option>)}</select>
                        </div>
                        <div className="mt-4 space-y-3">{pagedActivity.map((row) => <article key={row.id} className="rounded-xl border border-slate-200 p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700">{row.scenario}</span><span className="text-[11px] text-slate-400">{formatDateTime(row.createdAt)}</span></div><p className="mt-2 text-sm leading-6 text-slate-800">{row.question}</p>{row.hasAttachments && <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><Paperclip className="h-3 w-3" />含附件</p>}{row.answer && <p className="mt-2 line-clamp-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">AI：{row.answer}</p>}{row.reaction && <div className="mt-2 flex justify-end text-[11px]">{row.reaction === 'like' ? <span className="flex items-center gap-1 text-emerald-600"><ThumbsUp className="h-3 w-3" />有帮助</span> : <span className="flex items-center gap-1 text-rose-600"><ThumbsDown className="h-3 w-3" />需改进</span>}</div>}</article>)}</div>
                        {filteredActivity.length === 0 && <p className="py-10 text-center text-sm text-slate-400">没有符合当前筛选条件的使用记录</p>}
                      </div>
                      <ListPagination page={safeActivityPage} pageSize={activityPageSize} totalItems={filteredActivity.length} onPageChange={setActivityPage} onPageSizeChange={setActivityPageSize} pageSizeOptions={[5, 10, 20]} />
                    </section>
                  )}
                  {userDetail.feedback.length > 0 && (
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <div className="p-4">
                        <SectionHeader title="该人员提交的反馈" />
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <select value={personFeedbackReaction} onChange={(event) => setPersonFeedbackReaction(event.target.value as FeedbackReactionFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按个人反馈类型筛选"><option value="all">全部反馈类型</option><option value="like">有帮助</option><option value="dislike">需改进</option></select>
                          <select value={personFeedbackStatus} onChange={(event) => setPersonFeedbackStatus(event.target.value as FeedbackFilter)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" aria-label="按个人反馈状态筛选"><option value="all">全部处理状态</option>{Object.entries(STATUS_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select>
                        </div>
                        <div className="mt-4 space-y-3">{pagedPersonFeedback.map((row) => <article key={row.id} className="rounded-xl border border-slate-200 p-3.5 text-xs"><div className="flex items-center justify-between gap-3"><span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium', row.reaction === 'like' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{row.reaction === 'like' ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}{row.reaction === 'like' ? '有帮助' : '需改进'}</span><span className="text-slate-400">{formatDateTime(row.submittedAt)}</span></div>{row.reasonLabels.length > 0 && <p className="mt-2 text-slate-700">{row.reasonLabels.join('、')}</p>}{row.comment && <p className="mt-1 text-slate-500">“{row.comment}”</p>}{row.resolutionNote && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-slate-600">处理结论：{row.resolutionNote}</p>}</article>)}</div>
                        {filteredPersonFeedback.length === 0 && <p className="py-10 text-center text-sm text-slate-400">没有符合当前筛选条件的反馈</p>}
                      </div>
                      <ListPagination page={safePersonFeedbackPage} pageSize={personFeedbackPageSize} totalItems={filteredPersonFeedback.length} onPageChange={setPersonFeedbackPage} onPageSizeChange={setPersonFeedbackPageSize} pageSizeOptions={[5, 10, 20]} />
                    </section>
                  )}
                  {(userDetail.summary.avgResponseMs !== null || userDetail.summary.successRate !== null || userDetail.models.length > 0 || userDetail.sources.length > 0) && (
                    <details className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
                      <summary className="cursor-pointer font-medium text-slate-700">查看回答运行信息</summary>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {(userDetail.summary.avgResponseMs !== null || userDetail.summary.successRate !== null) && <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-2 font-semibold text-slate-800"><Gauge className="h-4 w-4 text-indigo-500" />回答表现</p><p className="mt-2">完成率 {userDetail.summary.successRate ?? '—'}% · 平均耗时 {formatMs(userDetail.summary.avgResponseMs)}</p></div>}
                        {userDetail.models.length > 0 && <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-2 font-semibold text-slate-800"><Sparkles className="h-4 w-4 text-indigo-500" />模型</p><p className="mt-2">{userDetail.models.map((row) => `${row.model} ${row.answers}条`).join(' · ')}</p></div>}
                        {userDetail.sources.length > 0 && <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-2 font-semibold text-slate-800"><FileText className="h-4 w-4 text-indigo-500" />信息来源</p><p className="mt-2">{userDetail.sources.map((row) => `${row.source} ${row.answers}条`).join(' · ')}</p></div>}
                        {userDetail.summary.copyCount + userDetail.summary.shareCount + userDetail.summary.regenerateCount > 0 && <div className="rounded-xl bg-slate-50 p-3"><p className="flex items-center gap-2 font-semibold text-slate-800"><ArrowRight className="h-4 w-4 text-indigo-500" />后续动作</p><div className="mt-2 flex gap-3"><span><Copy className="mr-1 inline h-3 w-3" />{userDetail.summary.copyCount}</span><span><Share2 className="mr-1 inline h-3 w-3" />{userDetail.summary.shareCount}</span><span><RefreshCw className="mr-1 inline h-3 w-3" />{userDetail.summary.regenerateCount}</span></div></div>}
                      </div>
                    </details>
                  )}
                </div>
              )
            ) : <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-10 text-center text-sm text-rose-700">人员详情加载失败</div>}
          </div>
        </SheetContent>
      </Sheet>

      {statusDraft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="feedback-status-title">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-6 py-4"><h2 id="feedback-status-title" className="font-semibold text-slate-950">更新问题处理状态</h2><p className="mt-1 text-xs text-slate-500">{statusDraft.row.user} · {STATUS_META[statusDraft.status].label}</p></div>
            <div className="px-6 py-5"><label className="block text-sm font-medium text-slate-700">处理结论{(statusDraft.status === 'resolved' || statusDraft.status === 'ignored') && <span className="text-rose-500"> *</span>}<textarea value={statusDraft.resolutionNote} onChange={(event) => setStatusDraft({ ...statusDraft, resolutionNote: event.target.value })} rows={4} maxLength={500} placeholder="说明处理动作、核查结果或忽略原因" className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" /></label></div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4"><button type="button" onClick={() => setStatusDraft(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">取消</button><button type="button" onClick={() => void updateStatus()} disabled={updatingId === statusDraft.row.id} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">确认更新</button></div>
          </div>
        </div>
      )}
    </main>
  );
}
