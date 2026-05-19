import { useEffect, useState } from "react";

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

export function useUserAvatar(userId?: string | null) {
  const [avatar, setAvatar] = useState<string | null>(() => getStoredUserAvatar(userId));

  useEffect(() => {
    setAvatar(getStoredUserAvatar(userId));
    if (!userId || typeof window === "undefined") return;

    function handleUpdate(event: Event) {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (detail?.userId === userId) {
        setAvatar(getStoredUserAvatar(userId));
      }
    }

    window.addEventListener(AVATAR_EVENT, handleUpdate);
    return () => window.removeEventListener(AVATAR_EVENT, handleUpdate);
  }, [userId]);

  return avatar;
}
