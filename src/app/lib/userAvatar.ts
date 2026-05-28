import { useEffect, useState } from "react";
import { useAuth } from "../auth";

const AVATAR_EVENT = "inogi-user-avatar-updated";
const AVATAR_KEY_PREFIX = "inogi-user-avatar:";

function avatarKey(userId: string) {
  return `${AVATAR_KEY_PREFIX}${userId}`;
}

export function getStoredUserAvatar(userId?: string | null) {
  if (!userId || typeof window === "undefined") return null;
  return window.localStorage.getItem(avatarKey(userId));
}

export function saveStoredUserAvatar(userId: string, dataUrl: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(avatarKey(userId), dataUrl);
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { userId } }));
}

export function clearStoredUserAvatar(userId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(avatarKey(userId));
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { userId } }));
}

/**
 * 取当前展示头像：
 * - 优先 user.avatarUrl（OSS 签名 URL，跨设备跨浏览器同步）
 * - 兜底 localStorage（兼容旧版本本地缓存）
 * 当 PersonalCenter 调 saveStoredUserAvatar/clearStoredUserAvatar 时本组件也会自动刷新
 */
export function useUserAvatar(userId?: string | null) {
  const { user } = useAuth();
  const remote = user?.id === userId ? user.avatarUrl ?? null : null;
  const [local, setLocal] = useState<string | null>(() => getStoredUserAvatar(userId));

  useEffect(() => {
    setLocal(getStoredUserAvatar(userId));
    if (!userId || typeof window === "undefined") return;

    function handleUpdate(event: Event) {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId === userId) {
        setLocal(getStoredUserAvatar(userId));
      }
    }

    window.addEventListener(AVATAR_EVENT, handleUpdate);
    return () => window.removeEventListener(AVATAR_EVENT, handleUpdate);
  }, [userId]);

  return remote ?? local;
}
