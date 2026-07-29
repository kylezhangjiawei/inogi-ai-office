import type { RdTask } from "./rdApi";

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

function collectTextValues(
  value: unknown,
  output: string[],
  seen: WeakSet<object>,
): void {
  if (typeof value === "string") {
    if (value.trim()) output.push(value);
    return;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    output.push(String(value));
    return;
  }

  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectTextValues(item, output, seen);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    // 子任务会作为独立任务参与过滤；父任务不应因为子任务命中而被误判为命中。
    if (key === "subtasks") continue;
    collectTextValues(child, output, seen);
  }
}

/**
 * 匹配单个任务自身的全部文本值，包括描述、人员、审核/阻塞原因、工作项和最新进度摘要等。
 * 查询按空白拆为多个关键词，所有关键词均命中时才返回 true。
 */
export function rdTaskMatchesAllText(
  task: RdTask,
  keyword: string,
  extraTexts: readonly string[] = [],
): boolean {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) return true;

  const values: string[] = [];
  collectTextValues(task, values, new WeakSet<object>());
  values.push(...extraTexts);
  const searchableText = normalizeSearchText(values.join("\n"));

  return normalizedKeyword
    .split(" ")
    .filter(Boolean)
    .every((token) => searchableText.includes(token));
}
