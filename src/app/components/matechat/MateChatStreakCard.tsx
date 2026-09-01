import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Flame, Sparkles } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';

import { cn } from '../ui/utils';
import type { MateChatStreak } from '../../lib/chatStreakApi';
import { useI18n } from '../../lib/i18n';
import { openMateChat } from './openMateChat';

const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const CONFETTI_COLORS = ['#002fa7', '#9db6f5', '#ffffff', '#fbbf24'];

function todayWeekIndex(): number {
  // 周一=0 ... 周日=6
  return (new Date().getDay() + 6) % 7;
}

/** 弹簧滚动计数 */
function AnimatedNumber({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    const unsub = rounded.on('change', (v) => setDisplay(v));
    return () => {
      controls.stop();
      unsub();
    };
  }, [value, reduce, mv, rounded]);

  return <>{display}</>;
}

/** 里程碑撒花 */
function Confetti() {
  const reduce = useReducedMotion();
  const particles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        angle: (i / 18) * Math.PI * 2,
        distance: 54 + (i % 5) * 14,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: (i % 6) * 0.03,
        size: 5 + (i % 3) * 2,
      })),
    [],
  );
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute left-14 top-12 z-10">
      {particles.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-[2px]"
          style={{ width: p.size, height: p.size, backgroundColor: p.color }}
          initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          animate={{
            opacity: [1, 1, 0],
            x: Math.cos(p.angle) * p.distance,
            y: Math.sin(p.angle) * p.distance,
            scale: [1, 1.1, 0.4],
            rotate: (i % 2 ? 1 : -1) * 220,
          }}
          transition={{ duration: 1.1, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** 每日 AI 卡通动物图，作为整卡背景铺满；叠加可读性遮罩保证白字对比。 */
function CardBackground({ url }: { url: string | null }) {
  const reduce = useReducedMotion();
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <motion.div
      className="absolute inset-0"
      initial={reduce ? false : { opacity: 0, scale: 1.06 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
    >
      <img src={url} alt="" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      {/* 单色遮罩保证白字在任意图片上都清晰。 */}
      <div className="absolute inset-0 bg-slate-950/65" />
    </motion.div>
  );
}

/** 本周打卡条 */
function WeekStrip({ weekActivity, todayDone }: { weekActivity: boolean[]; todayDone: boolean }) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const todayIdx = todayWeekIndex();
  return (
    <div className="relative mt-4 flex items-center justify-between gap-1">
      {DAY_LABELS.map((label, i) => {
        const done = weekActivity[i];
        const isToday = i === todayIdx;
        const isFuture = i > todayIdx;
        const pendingToday = isToday && !todayDone;
        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <span className={cn('text-[11px] font-medium', isToday ? 'text-white' : 'text-white/55')}>{t(label)}</span>
            <motion.span
              initial={reduce ? false : { scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.05, type: 'spring', stiffness: 500, damping: 22 }}
              className={cn(
                'flex size-7 items-center justify-center rounded-full text-white',
                done
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : pendingToday
                    ? 'border-2 border-dashed border-amber-300/90 bg-white/5'
                    : isFuture
                      ? 'border border-white/15 bg-white/[0.03]'
                      : 'border border-white/20 bg-white/[0.04]',
              )}
            >
              {done ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : pendingToday ? (
                <motion.span
                  animate={reduce ? undefined : { scale: [1, 1.35, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="h-1.5 w-1.5 rounded-full bg-amber-300"
                />
              ) : null}
            </motion.span>
          </div>
        );
      })}
    </div>
  );
}

export type MateChatStreakCardProps = {
  data: MateChatStreak | null;
  loading?: boolean;
  /** full=工作台大卡；compact=头部/侧栏药丸 */
  variant?: 'full' | 'compact';
  /** 点击 CTA 的回调；默认唤起 MateChat 悬浮窗 */
  onGoChat?: () => void;
  className?: string;
};

/**
 * MateChat 连续使用打卡卡片（多邻国式 streak）。纯展示组件，只吃 props、无数据副作用，
 * 便于在任意页面复用与测试。数据自取请用 MateChatStreakCardConnected。
 */
export function MateChatStreakCard({ data, loading, variant = 'full', onGoChat, className }: MateChatStreakCardProps) {
  const { lang, t } = useI18n();
  const reduce = useReducedMotion();
  const streak = data?.currentStreak ?? 0;
  const active = streak > 0;
  const goChat = onGoChat ?? openMateChat;

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={goChat}
        aria-label={t('MateChat 连续使用 {n} 天，点击去使用', { n: streak })}
        className={cn(
          'matechat-streak-horizon inline-flex items-center gap-1.5 rounded-full border border-[#bfd0fa] bg-[#eef3ff] px-3 py-1 text-sm font-semibold tabular-nums text-[#002fa7]',
          className,
        )}
      >
        <Flame className={cn('size-4', active ? 'fill-amber-500 text-amber-500' : 'text-slate-400')} />
        {loading ? <span className="text-[#9db6f5]">…</span> : <span>{streak} {t('天')}</span>}
      </button>
    );
  }

  return (
    <section
      className={cn(
        'matechat-streak-horizon relative overflow-hidden rounded-2xl border border-[#00267f] bg-[#002fa7] p-5 text-white shadow-md',
        className,
      )}
      aria-label={t('MateChat 连续使用 {n} 天，点击去使用', { n: streak })}
    >
      {/* 每日 AI 卡通动物作为整卡背景。 */}
      <CardBackground url={data?.mascotUrl ?? null} />

      {data?.milestone && <Confetti />}

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* 火苗 */}
          <motion.div
            animate={reduce || !active ? undefined : { scale: [1, 1.12, 1], rotate: [-3, 3, -3] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            className="relative"
          >
            <Flame
              className={cn('size-10', active ? 'fill-amber-400 text-amber-300' : 'text-white/40')}
              strokeWidth={1.5}
            />
          </motion.div>
          <div>
            <div className="flex items-end gap-1.5">
              <span className="text-4xl font-black leading-none tabular-nums">
                {loading ? '–' : <AnimatedNumber value={streak} />}
              </span>
              <span className="mb-0.5 text-base font-semibold text-white/90">{t('天')}</span>
            </div>
            <p className="mt-1 text-pretty text-xs font-medium text-white/80">
              {t('连续使用 MateChat')}{data && data.bestStreak > 0 ? <> · {t('最长 {n} 天', { n: data.bestStreak })}</> : null}
            </p>
          </div>
        </div>
      </div>

      <WeekStrip weekActivity={data?.weekActivity ?? [false, false, false, false, false, false, false]} todayDone={data?.todayDone ?? false} />

      {/* AI 每日文案 */}
      <div className="relative mt-4 min-h-[20px]">
        <AnimatePresence mode="wait">
          {loading || !data ? (
            <motion.div
              key="shimmer"
              exit={{ opacity: 0 }}
              className="h-4 w-4/5 animate-pulse rounded bg-white/20"
            />
          ) : (
            <motion.p
              key={data.message}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-1.5 text-pretty text-sm font-medium leading-5 text-white/95"
            >
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <span>{lang === 'en' ? t('今天也用 MateChat 保持连续记录吧！') : data.message}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* CTA */}
      <motion.button
        type="button"
        onClick={goChat}
        className="relative mt-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#002fa7] shadow-sm"
      >
        <span className="relative">{data?.todayDone ? t('再问 MateChat 一个问题') : t('立即去用 MateChat')}</span>
        <ArrowRight className="relative size-4" />
      </motion.button>
    </section>
  );
}
