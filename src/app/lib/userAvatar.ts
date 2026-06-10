import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth";
import { authFetch } from "./authSession";

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
  // 当前用户改了自己头像 → 让跨用户头像目录失效，驾驶舱等界面随即拿到新头像
  invalidateAvatarDirectory();
}

export function clearStoredUserAvatar(userId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(avatarKey(userId));
  window.dispatchEvent(new CustomEvent(AVATAR_EVENT, { detail: { userId } }));
  invalidateAvatarDirectory();
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

// ─── 跨用户头像目录 ──────────────────────────────────────────────────────────
// useUserAvatar 只能解析「当前登录用户」自己的头像。驾驶舱等界面要展示「他人」头像，
// 需要一份「有头像用户」目录（来自 GET /api/auth/avatars，按 user_id / 姓名解析）。
// 用模块级单例 + Promise 去重：无论多少个 OwnerAvatar 同时挂载，只发一次请求。

const AVATAR_DIRECTORY_EVENT = "inogi-user-avatar-directory-updated";

type AvatarDirectory = { byId: Map<string, string>; byName: Map<string, string> };
type AvatarDirectoryEntry = { id?: string; name?: string; avatarUrl?: string };

let directoryCache: AvatarDirectory | null = null;
let directoryPromise: Promise<AvatarDirectory> | null = null;

/** 归一化姓名用于兜底匹配：去掉「(组长)」「（备注）」等括注、去空白、转小写。 */
function normalizeAvatarName(name?: string | null): string {
  if (!name) return "";
  return name
    .replace(/\(.+?\)/g, "")
    .replace(/（.+?）/g, "")
    .trim()
    .toLowerCase();
}

async function fetchAvatarDirectory(): Promise<AvatarDirectory> {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  try {
    const res = await authFetch("/api/auth/avatars");
    if (res.ok) {
      const list = (await res.json()) as AvatarDirectoryEntry[];
      for (const u of Array.isArray(list) ? list : []) {
        if (!u?.avatarUrl) continue;
        if (u.id) byId.set(u.id, u.avatarUrl);
        // 同名只保留第一个，避免重名互相覆盖（user_id 命中优先，姓名仅兜底）
        const key = normalizeAvatarName(u.name);
        if (key && !byName.has(key)) byName.set(key, u.avatarUrl);
      }
    }
  } catch {
    // 网络/权限失败时退化为空目录 → OwnerAvatar 回退文字首字母，不影响页面
  }
  return { byId, byName };
}

function loadDirectoryOnce(): Promise<AvatarDirectory> {
  if (directoryCache) return Promise.resolve(directoryCache);
  if (!directoryPromise) {
    directoryPromise = fetchAvatarDirectory()
      .then((dir) => {
        directoryCache = dir;
        return dir;
      })
      .catch((err) => {
        directoryPromise = null; // 失败可重试
        throw err;
      });
  }
  return directoryPromise;
}

/** 失效目录缓存（有人改了头像时），并通知所有 hook 重新加载。 */
export function invalidateAvatarDirectory() {
  directoryCache = null;
  directoryPromise = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AVATAR_DIRECTORY_EVENT));
  }
}

/**
 * 返回 resolve(name, userId?) → 签名头像 URL 或 null，用于展示「他人」头像。
 * 优先按 user_id 精确匹配，其次按归一化姓名兜底（兼容仅按姓名指派的历史任务）。
 */
export function useAvatarDirectory() {
  const [dir, setDir] = useState<AvatarDirectory | null>(directoryCache);

  useEffect(() => {
    let active = true;
    const load = () => {
      loadDirectoryOnce()
        .then((d) => { if (active) setDir(d); })
        .catch(() => { /* 已在 fetch 内吞掉，留作防御 */ });
    };
    load();
    if (typeof window !== "undefined") {
      window.addEventListener(AVATAR_DIRECTORY_EVENT, load);
    }
    return () => {
      active = false;
      if (typeof window !== "undefined") {
        window.removeEventListener(AVATAR_DIRECTORY_EVENT, load);
      }
    };
  }, []);

  return useCallback(
    (name?: string | null, userId?: string | null): string | null => {
      if (!dir) return null;
      // 有 user_id 就只按 id 精确匹配：命不中（该用户没传头像）直接回退文字，
      // 绝不退化到「按姓名」匹配，避免把同名同事的头像张冠李戴。
      if (userId) return dir.byId.get(userId) ?? null;
      // 仅当没有 user_id（历史上只按姓名指派的任务）才用归一化姓名兜底。
      const key = normalizeAvatarName(name);
      return key ? dir.byName.get(key) ?? null : null;
    },
    [dir],
  );
}
