import { authFetch, readErrorMessage } from "./authSession";

export type UsageRange = "today" | "month" | "year";

export interface UsageModelRow {
  model: string;
  modality: "chat" | "image" | "video";
  calls: number;
  tokens: number;
  cost_yuan: number;
  cost_usd: number;
  seconds: number;
  cost_cny_approx: number;
}

export interface UsageUserRow {
  user_id: string;
  name: string;
  department: string | null;
  calls: number;
  chat_calls: number;
  image_calls: number;
  video_calls: number;
  tokens: number;
  video_cost_yuan: number;
  image_cost_usd: number;
  cost_cny_approx: number;
}

export interface UsageDashboard {
  range: UsageRange;
  totals: {
    calls: number;
    chat_calls: number;
    image_calls: number;
    video_calls: number;
    tokens: number;
    video_cost_yuan: number;
    image_cost_usd: number;
    cost_cny_approx: number;
    active_users: number;
  };
  by_model: UsageModelRow[];
  by_user: UsageUserRow[];
  trend: Array<{ date: string; calls: number }>;
}

export async function fetchAiUsageDashboard(range: UsageRange): Promise<UsageDashboard> {
  const res = await authFetch(`/api/ai-usage/dashboard?range=${range}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "读取用量数据失败"));
  }
  return (await res.json()) as UsageDashboard;
}

export async function backfillAiUsage(): Promise<{ chat: number; image: number; video: number }> {
  const res = await authFetch("/api/ai-usage/backfill", { method: "POST" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "回填失败"));
  }
  return (await res.json()) as { chat: number; image: number; video: number };
}
