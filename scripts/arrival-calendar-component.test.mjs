import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const output = {};
  new Function("exports", "require", code)(output, (name) => {
    assert.ok(name in dependencies, `Unexpected component dependency: ${name}`);
    return dependencies[name];
  });
  return output;
}
const model = compile("../src/app/procurement/arrivals/arrivalCalendarModel.ts");
const jsx = (type, props, key) => ({ type, props, key });
let nextId = 0;
const { ArrivalCalendar } = compile("../src/app/procurement/arrivals/ArrivalCalendar.tsx", {
  react: { useMemo: (factory) => factory(), useId: () => `id-${nextId++}` },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "lucide-react": { ChevronLeft: "ChevronLeft", ChevronRight: "ChevronRight" },
  "../../lib/i18n": { useI18n: () => ({ t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? key) }) },
  "./arrivalCalendarModel": model, "./arrivalCalendar.css": {},
});
const nodes = (tree) => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const text = (tree) => Array.isArray(tree) ? tree.map(text).join("") : tree == null || typeof tree === "boolean" ? "" : typeof tree === "object" ? text(tree.props?.children) : String(tree);
const render = (overrides = {}) => ArrivalCalendar({ rows: [], month: "2026-09", selection: "all", onMonthChange() {}, onSelect() {}, ...overrides });
const dayButton = (tree, date) => nodes(tree).find((node) => node.type === "button" && node.props["aria-label"]?.startsWith(`${date}，`));

test("每个本月日期包含空日都是原生可键盘操作的选择按钮，选中与周末可读", () => {
  const selected = [];
  const tree = render({ selection: "2026-09-06", onSelect: (value) => selected.push(value) });
  const days = nodes(tree).filter((node) => node.type === "button" && /^2026-09-\d{2}，/.test(node.props["aria-label"] ?? ""));
  assert.equal(days.length, 30);
  const empty = dayButton(tree, "2026-09-06");
  assert.match(empty.props["aria-label"], /周日，0 行/);
  assert.equal(empty.props["aria-pressed"], true);
  assert.equal(empty.props.disabled, false);
  assert.equal(empty.props.type, "button");
  empty.props.onClick();
  assert.deepEqual(selected, ["2026-09-06"]);
  assert.match(text(tree), /已选 2026-09-06：0 行/);
  assert.equal(dayButton(tree, "2026-08-31"), undefined, "月外日期通过独立入口而非相邻格改变月份");
});

test("全部/月外/日期待确认入口保留完整计数且点击传回明确选择", () => {
  const selections = [];
  const tree = render({ rows: [{ etaDate: "2026-09-18" }, { etaDate: "" }, { etaDate: "2026-10-01" }], onSelect: (value) => selections.push(value) });
  for (const [label, expected] of [["全部关联", "all"], ["日期待确认", "undated"], ["月外日期", "outside"]]) {
    const button = nodes(tree).find((node) => node.type === "button" && text(node).startsWith(label));
    assert.ok(button, label);
    assert.equal(button.props["aria-pressed"], expected === "all");
    button.props.onClick();
  }
  assert.deepEqual(selections, ["all", "undated", "outside"]);
  assert.match(text(tree), /全部关联3行/);
  assert.match(text(tree), /日期待确认1行/);
  assert.match(text(tree), /月外日期1行/);
  assert.match(text(tree), /按任务关联预计到货归日/);
  assert.match(text(tree), /已收完或已取消的关联记录也保留/);
  assert.match(text(tree), /不代表未到货义务/);
});

test("月份导航只产生合法月份并保护首尾年；禁用状态不会调用回调", () => {
  const months = [];
  const selections = [];
  const tree = render({ month: "2026-12", onMonthChange: (value) => months.push(value) });
  const monthButtons = nodes(tree).filter((node) => node.type === "button" && /一个到货月份/.test(node.props["aria-label"] ?? ""));
  monthButtons.forEach((button) => button.props.onClick());
  assert.deepEqual(months, ["2026-11", "2027-01"]);
  const input = nodes(tree).find((node) => node.type === "input");
  input.props.onChange({ target: { value: "" } });
  input.props.onChange({ target: { value: "0000-01" } });
  input.props.onChange({ target: { value: "2026-13" } });
  input.props.onChange({ target: { value: "2027-02" } });
  assert.deepEqual(months, ["2026-11", "2027-01", "2027-02"]);
  for (const [month, name] of [["0001-01", "上一个到货月份"], ["9999-12", "下一个到货月份"]]) {
    const edge = render({ month, onMonthChange: () => assert.fail("Boundary navigation must remain disabled") });
    const button = nodes(edge).find((node) => node.props?.["aria-label"] === name);
    assert.equal(button.props.disabled, true);
    button.props.onClick();
  }
  const disabled = render({ disabled: true, onSelect: (value) => selections.push(value), onMonthChange: (value) => months.push(value) });
  for (const button of nodes(disabled).filter((node) => node.type === "button")) {
    assert.equal(button.props.disabled, true);
    button.props.onClick();
  }
  nodes(disabled).find((node) => node.type === "input").props.onChange({ target: { value: "2030-01" } });
  assert.deepEqual(selections, []);
  assert.deepEqual(months, ["2026-11", "2027-01", "2027-02"]);
});

test("今天以文字和 aria-current 标识，不只靠颜色；非法月不会抛出组件错误", () => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const date = `${month}-${String(now.getDate()).padStart(2, "0")}`;
  const today = dayButton(render({ month }), date);
  assert.equal(today.props["aria-current"], "date");
  assert.match(today.props["aria-label"], /今天/);
  assert.match(text(today), /今/);
  const invalid = render({ month: "0000-01" });
  assert.equal(invalid.props.role, "status");
  assert.equal(text(invalid), "请选择有效的到货月份。");
});
