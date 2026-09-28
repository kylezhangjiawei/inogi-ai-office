import { Button } from "../ui/button";
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Sparkles } from 'lucide-react';
import { useLocation } from 'react-router';

import { useAuth } from '../../auth';
import { chatStreakApi, type MateChatStreak } from '../../lib/chatStreakApi';
import { useI18n } from '../../lib/i18n';
import { openMateChat } from './openMateChat';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

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

// 按账号隔离：同一浏览器切换账号时，各账号的提醒记录互不影响
function storageKey(userId: string, period: Period): string {
  return `matechat-reminder:${userId}:${todayKey()}:${period}`;
}

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 分钟检查一次（大多数情况仅本地判断，零网络）

function shouldDeferReminder(): boolean {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')
    || document.activeElement?.matches('input, textarea, select, [contenteditable="true"], [role="combobox"]'));
}

/**
 * MateChat 使用提醒弹窗：每天上/下午各弹一次，仅在「当天尚未使用」时提醒。
 * 全局挂载（Root）。性能：先做 localStorage + 时段本地判断，只有确需弹出时才请求接口
 * （且走 chatStreakApi 的 30s 共享缓存，与打卡卡片复用同一份数据）。
 */
export function MateChatReminderModal() {
  const { lang, t } = useI18n();
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MateChatStreak | null>(null);
  const checkingRef = useRef(false);
  const isReminderPreview = new URLSearchParams(location.search).get('matechatReminder') === 'preview';
  const latestContext = useRef({ userId: user?.id, open, isReminderPreview });
  latestContext.current = { userId: user?.id, open, isReminderPreview };

  // 切换账号（user.id 变化）时清掉共享缓存，避免读到上一个账号的连续数据
  useEffect(() => {
    chatStreakApi.invalidate();
  }, [user?.id]);

  const maybeShow = useCallback(async () => {
    if (!user || open || checkingRef.current || isReminderPreview) return;
    // 正在填写表单或操作其他弹窗时，延后使用提醒。
    if (shouldDeferReminder()) return;
    const period = currentPeriod();
    if (!period) return;
    const key = storageKey(user.id, period);
    if (localStorage.getItem(key)) return; // 本时段已处理：纯本地判断，不发请求
    checkingRef.current = true;
    try {
      const streak = await chatStreakApi.getMyStreak(); // 命中 30s 共享缓存则零网络
      // 读取期间用户可能已开始输入、打开弹窗或离开此账号/时段，延后且不消耗提醒次数。
      const current = latestContext.current;
      if (current.userId !== user.id || current.open || current.isReminderPreview
        || currentPeriod() !== period || storageKey(user.id, period) !== key || shouldDeferReminder()) return;
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
  }, [user, open, isReminderPreview]);

  // 预览/测试：URL 带 ?matechatReminder=preview 时，无视时段/是否已用/是否已弹，强制弹出一次
  useEffect(() => {
    if (!user) return;
    if (!isReminderPreview) return;
    let cancelled = false;
    void (async () => {
      try {
        const streak = await chatStreakApi.getMyStreak();
        if (!cancelled) {
          setData(streak);
          setOpen(true);
        }
      } catch {
        // 忽略
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isReminderPreview]);

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

  const goChat = () => {
    openMateChat();
    close();
  };

  const streak = data?.currentStreak ?? 0;

  return (
    <Dialog open={open && Boolean(data)} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      {data && (
        <DialogContent className="horizon-theme matechat-reminder-horizon gap-0 overflow-y-auto overflow-x-hidden border-[#e9edf7] bg-white p-0 shadow-xl sm:max-w-sm [&>button.absolute]:bg-white [&>button.absolute]:text-slate-600 [&>button.absolute]:opacity-100">
          {/* 保留线上提醒的每日吉祥物封面，与侧边打卡卡片共享素材。 */}
          <div className="relative h-44 shrink-0 overflow-hidden border-b border-[#e9edf7] bg-primary">
            {data.mascotUrl ? (
              <img
                src={data.mascotUrl}
                alt=""
                className="absolute inset-0 size-full object-cover"
              />
            ) : null}
            <div className="absolute inset-0 bg-slate-950/40" />
            <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-slate-950/60 px-3 py-1 text-white">
              <Flame className="size-4 fill-amber-400 text-amber-300" />
              <span className="text-sm font-bold tabular-nums">{t('{n} 天', { n: streak })}</span>
            </div>
          </div>

          <DialogHeader className="px-6 pb-1 pt-5 text-center sm:text-center">
            <DialogTitle className="text-balance text-lg font-bold text-slate-900">
              {streak > 0 ? t('别断了连续 {n} 天！', { n: streak }) : t('今天还没用 MateChat 哦')}
            </DialogTitle>
            <DialogDescription className="mt-2 flex items-start justify-center gap-1.5 text-pretty text-sm leading-6 text-slate-600">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{lang === 'en' ? t('今天也用 MateChat 保持连续记录吧！') : data.message}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 px-6 pb-6 pt-4">
            <Button
              type="button"
              onClick={goChat}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-bold shadow-sm"
            >
              {t('立即去用 MateChat')}
            </Button>
            <Button variant="unstyled"
              type="button"
              onClick={close}
              className="w-full rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              {t('稍后再说')}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
