import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

/**
 * 「今天」的取值回归。两条历史缺陷都在这里锁死：
 * 1. 模块级常量冻结「今天」→ 页面跨零点后逾期判定静默算错；
 * 2. toISOString() 取 UTC 日期 → UTC+8 每天 0–8 点整体错一天。
 */

const helperUrl = new URL("../src/app/lib/taskDue.ts", import.meta.url);
const helperSource = await readFile(helperUrl, "utf8");
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: helperUrl.pathname,
}).outputText;
const helperModuleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { daysUntilDue, isTaskOverdue, taskOverdueDays, todayLocalDateStr } = await import(helperModuleUrl);

test("todayLocalDateStr 取本地日历日，不受 UTC 偏移影响", () => {
  // 本地时间凌晨，UTC 仍是前一天：必须返回本地的今天
  assert.equal(todayLocalDateStr(new Date(2026, 7, 7, 0, 30)), "2026-08-07");
  assert.equal(todayLocalDateStr(new Date(2026, 7, 7, 7, 59)), "2026-08-07");
  assert.equal(todayLocalDateStr(new Date(2026, 7, 7, 23, 59)), "2026-08-07");
  assert.equal(todayLocalDateStr(new Date(2026, 0, 1, 0, 0)), "2026-01-01");
});

test("daysUntilDue 对今日到期返回 0（历史 UTC 实现会返回 1）", () => {
  const earlyMorning = new Date(2026, 7, 7, 7, 0);
  assert.equal(daysUntilDue("2026-08-07", earlyMorning), 0);
  assert.equal(daysUntilDue("2026-08-08", earlyMorning), 1);
  assert.equal(daysUntilDue("2026-08-06", earlyMorning), -1);
  assert.equal(daysUntilDue("2026-08-14", earlyMorning), 7);
});

test("daysUntilDue 跟随当前时间推移，不会被冻结", () => {
  // 同一个截止日，随着「今天」前进，剩余天数必须递减
  assert.equal(daysUntilDue("2026-08-08", new Date(2026, 7, 7, 15, 0)), 1);
  assert.equal(daysUntilDue("2026-08-08", new Date(2026, 7, 8, 9, 0)), 0);
  assert.equal(daysUntilDue("2026-08-08", new Date(2026, 7, 10, 9, 0)), -2);
});

test("daysUntilDue 处理空值与非法日期", () => {
  assert.equal(daysUntilDue(undefined), null);
  assert.equal(daysUntilDue(null), null);
  assert.equal(daysUntilDue(""), null);
  assert.equal(daysUntilDue("不是日期"), null);
});

test("逾期与今日到期互斥：同一任务不会被两个 KPI 同时统计", () => {
  const now = new Date(2026, 7, 7, 7, 0);
  // 工作台 dueStats 的两个判定条件，必须基于同一个「今天」
  const countBoth = (dueDate) => {
    const task = { status: "in_progress", due_date: dueDate };
    return {
      overdue: isTaskOverdue(task, now) ? 1 : 0,
      today: daysUntilDue(dueDate, now) === 0 ? 1 : 0,
    };
  };
  assert.deepEqual(countBoth("2026-08-06"), { overdue: 1, today: 0 }, "已过期只计逾期");
  assert.deepEqual(countBoth("2026-08-07"), { overdue: 0, today: 1 }, "今日到期只计今日");
  assert.deepEqual(countBoth("2026-08-09"), { overdue: 0, today: 0 }, "未来到期两者都不计");
});

test("taskOverdueDays 的方案 B 判定未被改动", () => {
  const now = new Date(2026, 7, 7, 10, 0);
  assert.equal(taskOverdueDays({ status: "in_progress", due_date: "2026-08-04" }, now), 3);
  assert.equal(taskOverdueDays({ status: "in_progress", due_date: "2026-08-07" }, now), 0);
  assert.equal(taskOverdueDays({ status: "completed", due_date: "2026-08-01" }, now), 0);
  assert.equal(taskOverdueDays({ archived: true, due_date: "2026-08-01" }, now), 0);
  // 待审核：按提交日是否晚于截止日判定，而非今天
  assert.equal(
    taskOverdueDays({ status: "pending_review", due_date: "2026-08-01", submitted_for_review_at: "2026-08-03" }, now),
    2,
  );
  assert.equal(
    taskOverdueDays({ status: "pending_review", due_date: "2026-08-05", submitted_for_review_at: "2026-08-01" }, now),
    0,
  );
  // 旧数据缺提交时间戳 → 视为按时
  assert.equal(taskOverdueDays({ status: "pending_review", due_date: "2026-08-01" }, now), 0);
});
