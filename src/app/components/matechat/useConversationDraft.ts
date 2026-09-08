import { useCallback, useEffect, useState, type SetStateAction } from "react";
import type { MateChatPageContext } from "./pageContext";

type Draft<T> = { text: string; attachments: T[]; pageContext?: MateChatPageContext | null };
const emptyDraft = <T,>(): Draft<T> => ({ text: "", attachments: [] });

/** Setters capture their conversation key, so an upload finishing after a switch cannot affect the new draft. */
export function useConversationDraft<T>(userId: string | undefined, conversationId: string | null) {
  const [drafts, setDrafts] = useState<Record<string, Draft<T>>>({});
  const pendingKey = `${userId ?? "anonymous"}:pending`;
  const key = conversationId ? `${userId ?? "anonymous"}:${conversationId}` : pendingKey;
  const value = drafts[key] ?? emptyDraft<T>();
  useEffect(() => {
    if (!conversationId) return;
    setDrafts((current) => {
      if (!current[pendingKey]) return current;
      const { [pendingKey]: pending, ...rest } = current;
      return { ...rest, [key]: current[key] ?? pending };
    });
  }, [conversationId, key, pendingKey]);
  const setField = useCallback(<K extends keyof Draft<T>>(field: K, update: SetStateAction<Draft<T>[K]>) => {
    setDrafts((current) => {
      const previous = current[key] ?? emptyDraft<T>();
      const next = typeof update === "function" ? (update as (old: Draft<T>[K]) => Draft<T>[K])(previous[field]) : update;
      return { ...current, [key]: { ...previous, [field]: next } };
    });
  }, [key]);
  const setDraft = useCallback((update: SetStateAction<string>) => setField("text", update), [setField]);
  const setAttachments = useCallback((update: SetStateAction<T[]>) => setField("attachments", update), [setField]);
  const setPageContext = useCallback((update: SetStateAction<MateChatPageContext | null | undefined>) => setField("pageContext", update), [setField]);
  return { draft: value.text, attachments: value.attachments, pageContext: value.pageContext, setDraft, setAttachments, setPageContext };
}
