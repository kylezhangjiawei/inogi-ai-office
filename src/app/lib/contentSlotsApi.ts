import { authFetch, readErrorMessage } from "./authSession";

export type SlotMode = "ai_daily" | "static" | "off";

export interface ContentSlot {
  key: string;
  name: string;
  location: string;
  type: "image" | "text" | "list";
  modes: SlotMode[];
  prompt_vars: string[];
  note: string;
  default_prompt: string;
  mode: SlotMode;
  prompt_template: string;
  static_text: string;
  static_list: string[];
  has_static_image: boolean;
  static_image_pool: Array<{ object_key: string; url: string | null }>;
  current: { image_url: string | null; text: string | null; list: string[] | null; date: string | null } | null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  if (!res.ok) throw new Error(await readErrorMessage(res, "请求失败"));
  return (await res.json()) as T;
}

/** 上传固定素材图片（持久业务类型），返回 objectKey */
export async function uploadSlotImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("businessType", "content-slots-static");
  const res = await authFetch("/api/files/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(await readErrorMessage(res, "上传失败"));
  const data = (await res.json()) as { objectKey: string };
  return data.objectKey;
}

export const contentSlotsApi = {
  list() {
    return json<{ items: ContentSlot[] }>("/api/content-slots");
  },
  updateConfig(
    key: string,
    payload: {
      mode?: SlotMode;
      promptTemplate?: string;
      staticText?: string;
      staticImageObjectKey?: string;
      staticImagePool?: string[];
      staticList?: string[];
    },
  ) {
    return json<{ ok: boolean }>(`/api/content-slots/${key}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  regenerate(key: string) {
    return json<{ image_url?: string | null; sample_text?: string }>(`/api/content-slots/${key}/regenerate`, {
      method: "POST",
    });
  },
  history(key: string) {
    return json<{ items: Array<{ date: string; url: string | null; source: string }> }>(
      `/api/content-slots/${key}/history`,
    );
  },
  getGenBudget() {
    return json<{ monthly_cap: number; used_this_month: number }>("/api/content-slots/gen-budget");
  },
  saveGenBudget(monthlyCap: number) {
    return json<{ monthly_cap: number }>("/api/content-slots/gen-budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyCap }),
    });
  },
};
