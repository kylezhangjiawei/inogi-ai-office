import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/rd/RdProcurementProgressDialog.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
const primitives = new Proxy({}, { get: (_target, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? key);
function expand(tree) {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== "object") return tree;
  if (typeof tree.type === "function") return expand(tree.type(tree.props));
  return { ...tree, props: { ...tree.props, children: expand(tree.props?.children) } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}
const find = (tree, type, label) => nodes(tree).find((node) => node.type === type && (label === undefined || text(node) === label));
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const task = (extra = {}) => ({ id: "proc-1", rdTaskId: "rd-1", code: "PROC-001", materialName: "精密阀体", spec: "316L / 20 mm", status: "testing", quantity: 20, unit: "件", buyer: "采购李工", needDate: "2026-10-01", expectedArrivalDate: "2026-09-29", logs: [], ...extra });

function fixture() {
  const slots = []; const requests = [];
  let cursor = 0; let effects = []; let dirty = false; let closed = 0;
  let user = { id: "researcher-1", roleId: "rd", departmentCode: "RND", permissions: ["page:rd-my-workspace"] };
  let location = { key: "workspace" };
  const props = { rdTaskId: null, rdTaskTitle: "研发阀体验证", onClose: () => { closed += 1; props.rdTaskId = null; } };
  const hooks = {
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (value) => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useEffect(callback, deps) {
      const index = cursor++; const previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        const next = { deps }; slots[index] = next;
        effects.push(() => { previous?.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const dependencies = {
    "./RdOriginalRecordLinks": { RdOriginalRecordLinks: "RdOriginalRecordLinks" },
    react: hooks, "react/jsx-runtime": { jsx, jsxs: jsx }, "react-router": { useLocation: () => location }, "lucide-react": primitives,
    "../auth": { useAuth: () => ({ user }) }, "../lib/i18n": { useI18n: () => ({ t: translate }) },
    "../components/TranslatableText": { AutoTranslatedText: ({ text: content }) => jsx("span", { children: content }) },
    "../components/ui/button": primitives, "../components/ui/dialog": primitives,
    "../procurement/components/common": primitives, "../procurement/components/rdInsertion": primitives,
    "../lib/procurementApi": { getProcTaskByRdTask: (id, signal) => new Promise((resolve, reject) => { requests.push({ id, signal, resolve, reject }); }) },
  };
  const exports = {};
  new Function("exports", "require", code)(exports, (name) => {
    assert.ok(name in dependencies, `Unexpected runtime dependency: ${name}`);
    return dependencies[name];
  });
  return {
    requests, props, get closed() { return closed; },
    setUser(value) { user = value; },
    navigate(key) { location = { key }; },
    render() {
      let tree; let rounds = 0;
      do {
        assert.ok(rounds++ < 6, "Render effects should settle");
        cursor = 0; effects = []; dirty = false;
        tree = expand(exports.RdProcurementProgressDialog(props));
        effects.forEach((effect) => effect());
      } while (dirty);
      return tree;
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("关闭时不查询，打开后按研发 ID 重新读取并展示允许字段，复用原权限活动区", async () => {
  const f = fixture(); assert.equal(find(f.render(), "Dialog").props.open, false); assert.equal(f.requests.length, 0);
  f.props.rdTaskId = "rd-1";
  assert.match(text(f.render()), /正在读取采购进度/);
  assert.equal(f.requests[0].id, "rd-1"); assert.equal(f.requests[0].signal.aborted, false);
  const record = task();
  for (const key of ["paymentStatus", "paymentDate", "selectedQuotationId", "quotationTotal", "purchaseOrders"]) {
    Object.defineProperty(record, key, { get() { throw new Error(`Private field read: ${key}`); } });
  }
  f.requests[0].resolve(record); await settle();
  const tree = f.render();
  for (const value of ["研发任务：研发阀体验证", "采购任务编号 · PROC-001", "精密阀体", "316L / 20 mm", "20 件", "采购李工"]) assert.ok(text(tree).includes(value));
  assert.deepEqual(nodes(tree).filter((node) => node.type === "time").map((node) => node.props.dateTime), ["2026-10-01", "2026-09-29"]);
  assert.equal(find(tree, "StatusPill").props.status, "testing");
  assert.equal(find(tree, "ProcurementActivitySection").props.task, record);
  assert.doesNotMatch(text(tree), /付款|报价|订单|%/);
  assert.match(find(tree, "DialogContent").props.className, /sm:max-w-\[760px\]/);
  assert.ok(nodes(tree).some((node) => node.props.className?.includes("overflow-y-auto")));
  f.unmount();
});

test("任务切换取消旧请求，旧成功与失败均不能覆盖当前任务", async () => {
  const f = fixture(); f.props.rdTaskId = "rd-1"; f.render(); const old = f.requests[0];
  f.props.rdTaskId = "rd-2"; f.render(); assert.equal(old.signal.aborted, true);
  old.resolve(task({ materialName: "不应出现的旧任务" })); await settle();
  assert.doesNotMatch(text(f.render()), /不应出现的旧任务/);
  assert.match(text(f.render()), /正在读取采购进度/);
  const second = f.requests[1];
  f.props.rdTaskId = "rd-3"; f.render(); assert.equal(second.signal.aborted, true);
  second.reject(new Error("不应出现的旧错误"));
  f.requests[2].resolve(task({ rdTaskId: "rd-3", materialName: "当前研发任务" })); await settle();
  assert.match(text(f.render()), /当前研发任务/); assert.doesNotMatch(text(f.render()), /不应出现的旧错误/);
  f.unmount();
});

test("账号或权限变化立即隔离之前结果，权限撤销后不保留旧详情", async () => {
  const f = fixture(); f.props.rdTaskId = "rd-1"; f.render();
  f.requests[0].resolve(task()); await settle(); assert.match(text(f.render()), /精密阀体/);
  f.setUser({ id: "researcher-2", roleId: "rd", permissions: ["page:rd-my-workspace"] });
  assert.doesNotMatch(text(f.render()), /精密阀体/); assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests.length, 2);
  f.setUser({ id: "researcher-2", roleId: "rd", permissions: [] }); f.render();
  assert.equal(f.requests[1].signal.aborted, true); assert.equal(f.requests.length, 3);
  f.requests[1].resolve(task({ materialName: "前一权限范围" }));
  f.requests[2].reject(new Error("无权访问该研发任务")); await settle();
  assert.match(text(f.render()), /无权访问该研发任务/); assert.doesNotMatch(text(f.render()), /前一权限范围|精密阀体/);
  f.setUser(null); const signedOut = f.render();
  assert.match(text(signedOut), /当前账号不可用/); assert.equal(f.requests.length, 3);
  assert.equal(find(signedOut, "Button", "重新读取"), undefined);
  f.unmount();
});

test("请求失败可重试，无关联独立空态，缺失日期不推算，刷新重新读取", async () => {
  const f = fixture(); f.props.rdTaskId = "rd-1"; f.render();
  f.requests[0].reject(new Error("暂时无法连接")); await settle();
  const failed = f.render(); assert.match(text(failed), /采购进度读取失败.*暂时无法连接/);
  assert.ok(nodes(failed).some((node) => node.props.role === "alert"));
  find(failed, "Button", "重新读取").props.onClick(); f.render();
  assert.equal(f.requests[1].id, "rd-1"); f.requests[1].resolve(null); await settle();
  assert.match(text(f.render()), /该研发任务暂未关联采购任务/);
  f.props.rdTaskId = null; f.render(); f.props.rdTaskId = "rd-1"; f.render();
  assert.equal(f.requests.length, 3);
  f.requests[2].resolve(task({ needDate: "", expectedArrivalDate: null, quantity: NaN, buyer: "" })); await settle();
  const ready = f.render(); assert.equal(nodes(ready).filter((node) => node.type === "time").length, 0);
  assert.equal((text(ready).match(/待确认/g) ?? []).length, 2); assert.match(text(ready), /待核对.*未指派/);
  find(ready, "Button", "刷新采购进度").props.onClick(); f.render();
  assert.equal(f.requests.length, 4); assert.match(text(f.render()), /正在读取采购进度/);
  f.unmount();
});

test("关闭或卸载终止请求，重新打开同任务重新读取；样品动作导航后释放当前弹窗", async () => {
  const f = fixture(); f.props.rdTaskId = "rd-1"; f.render(); const first = f.requests[0];
  find(f.render(), "Dialog").props.onOpenChange(false); f.render();
  assert.equal(f.closed, 1); assert.equal(first.signal.aborted, true);
  first.resolve(task()); await settle(); assert.equal(find(f.render(), "Dialog").props.open, false);
  f.props.rdTaskId = "rd-1"; assert.match(text(f.render()), /正在读取采购进度/);
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve(task()); await settle(); f.render();
  f.navigate("workspace-sample-test"); f.render();
  assert.equal(f.closed, 2); assert.equal(f.requests[1].signal.aborted, true);
  f.render(); f.props.rdTaskId = "rd-2"; f.render(); const pending = f.requests[2];
  f.unmount(); assert.equal(pending.signal.aborted, true);
  pending.resolve(task({ materialName: "卸载后的结果" })); await settle();
});
