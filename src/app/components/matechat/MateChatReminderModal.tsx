import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { useAuth } from '../../auth';
import { chatStreakApi, type MateChatStreak } from '../../lib/chatStreakApi';
import { openMateChat } from './openMateChat';

type Period = 'am' | 'pm';

/** 上午 09:00–12:00、下午 14:00–18:00，各提醒一次 */
function currentPeriod(): Period | null {
  const h = new Date().getHours();
  if (h >= 9 && h < 12) return 'am';
  if (h >= 14 && h < 18) return 'pm';
  return null;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function storageKey(period: Period): string {
  return `matechat-reminder:${todayKey()}:${period}`;
}

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟检查一次（大多数情况仅本地判断，零网络）

/**
 * MateChat 使用提醒弹窗：每天上/下午各弹一次，仅在「当天尚未使用」时提醒。
 * 全局挂载（Root）。性能：先做 localStorage + 时段本地判断，只有确需弹出时才请求接口
 * （且走 chatStreakApi 的 30s 共享缓存，与打卡卡片复用同一份数据）。
 */
export function MateChatReminderModal() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MateChatStreak | null>(null);
  const checkingRef = useRef(false);

  const maybeShow = useCallback(async () => {
    if (!user || open || checkingRef.current) return;
    const period = currentPeriod();
    if (!period) return;
    const key = storageKey(period);
    if (localStorage.getItem(key)) return; // 本时段已处理：纯本地判断，不发请求
    checkingRef.current = true;
    try {
      const streak = await chatStreakApi.getMyStreak(); // 命中 30s 共享缓存则零网络
      if (streak.todayDone) {
        localStorage.setItem(key, 'used'); // 今天已用过，本时段不再打扰、也不再请求
        return;
      }
      setData(streak);
      setOpen(true);
      localStorage.setItem(key, 'shown');
    } catch {
      // 静默失败，不打扰用户
    } finally {
      checkingRef.current = false;
    }
  }, [user, open]);

  useEffect(() => {
    if (!user) return;
    const timer = setTimeout(() => void maybeShow(), 3000); // 进页面 3s 后再考虑，避免打扰首屏
    const interval = setInterval(() => void maybeShow(), CHECK_INTERVAL);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void maybeShow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, maybeShow]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const goChat = () => {
    openMateChat();
    close();
  };

  const streak = data?.currentStreak ?? 0;

  return (
    <AnimatePresence>
      {open && data && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="matechat-reminder-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={close}
        >
          <motion.div
            className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: 28 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 14 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头图：复用当天吉祥物场景图，融入白色内容区 */}
            <div className="relative h-44 overflow-hidden">
              {data.mascotUrl ? (
                <motion.img
                  src={data.mascotUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  initial={reduce ? false : { scale: 1.12, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 via-blue-700 to-[#026fc2]" />
              )}
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white via-white/70 to-transparent" />
              <motion.div
                className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-white backdrop-brightness-95"
                initial={reduce ? false : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <motion.span
                  animate={reduce ? undefined : { scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Flame className="h-4 w-4 fill-amber-400 text-amber-300" />
                </motion.span>
                <span className="text-sm font-bold tabular-nums">{streak} 天</span>
              </motion.div>
            </div>

            <button
              type="button"
              onClick={close}
              aria-label="关闭"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/25 text-white transition-colors hover:bg-black/40"
            >
              <X className="h-4 w-4" />
            </button>

            {/* 内容 */}
            <div className="px-6 pb-6 pt-1 text-center">
              <motion.h2
                id="matechat-reminder-title"
                className="text-lg font-bold text-slate-900"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                {streak > 0 ? `别断了连续 ${streak} 天！` : '今天还没用 MateChat 哦'}
              </motion.h2>
              <motion.p
                className="mt-2 flex items-start justify-center gap-1.5 text-sm leading-6 text-slate-600"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
              >
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                <span>{data.message}</span>
              </motion.p>
              <div className="mt-5 flex flex-col gap-2">
                <motion.button
                  type="button"
                  onClick={goChat}
                  whileHover={reduce ? undefined : { scale: 1.02 }}
                  whileTap={reduce ? undefined : { scale: 0.98 }}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700"
                >
                  立即去用 MateChat
                </motion.button>
                <button
                  type="button"
                  onClick={close}
                  className="w-full rounded-xl px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-600"
                >
                  稍后再说
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
