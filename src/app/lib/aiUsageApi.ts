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

export interface UsageDetailItem {
  id: string;
  created_at: string;
  user_id: string;
  user_name: string;
  department: string | null;
  modality: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_yuan: number;
  cost_usd: number;
  cost_cny_approx: number;
  seconds: number;
  estimated: boolean;
  source: string;
  ref_id: string | null;
}

export interface UsageDetails {
  filters: {
    range: UsageRange;
    modality: string | null;
    model: string | null;
    user_id: string | null;
    date: string | null;
  };
  summary: {
    calls: number;
    chat_calls: number;
    image_calls: number;
    video_calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_yuan: number;
    cost_usd: number;
    cost_cny_approx: number;
    seconds: number;
  };
  items: UsageDetailItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export interface UsageDetailsParams {
  range: UsageRange;
  modality?: string;
  model?: string;
  user_id?: string;
  date?: string;
  page?: number;
  page_size?: number;
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

export async function fetchAiUsageDetails(params: UsageDetailsParams): Promise<UsageDetails> {
  const query = new URLSearchParams({ range: params.range });
  if (params.modality) query.set("modality", params.modality);
  if (params.model) query.set("model", params.model);
  if (params.user_id) query.set("user_id", params.user_id);
  if (params.date) query.set("date", params.date);
  query.set("page", String(params.page ?? 1));
  query.set("page_size", String(params.page_size ?? 20));
  const res = await authFetch(`/api/ai-usage/details?${query.toString()}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "读取用量明细失败"));
  }
  return (await res.json()) as UsageDetails;
}
