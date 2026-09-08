import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function sourceFile(path) {
  return ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
const page = sourceFile("src/app/procurement/ProcurementCockpitPage.tsx");
const card = sourceFile("src/app/procurement/components/ProcurementTaskCard.tsx");
const editor = sourceFile("src/app/procurement/components/TaskCriticalMaterials.tsx");

function find(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.equal(matches.length, 1, "Expected one matching implementation node");
  return matches[0];
}
function evaluate(expression, bindings = {}) {
  const code = ts.transpileModule(`return (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return Function(...Object.keys(bindings), code)(...Object.values(bindings));
}
function namedFunction(name) {
  return find(page, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(page);
}

// Execute the production hook with commit/cleanup scheduling and controllable browser measurements.
function masonryFixture(width, { coarse = false, narrow = false } = {}) {
  const slots = [];
  let cursor = 0;
  let changed = false;
  let pending = [];
  let paused = false;
  let result;
  let mounted = true;
  const container = { clientWidth: width };
  const queries = [coarse, narrow].map((matches) => ({
    matches,
    listeners: new Set(),
    addEventListener(_name, callback) { this.listeners.add(callback); },
    removeEventListener(_name, callback) { this.listeners.delete(callback); },
  }));
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const hook = evaluate(namedFunction("useMasonryColumns"), {
    useState(initial) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (update) => {
        const next = typeof update === "function" ? update(slot.value) : update;
        if (!Object.is(slot.value, next)) { slot.value = next; changed = true; }
      }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const slot = slots[index];
      if (!slot || dependencies.some((value, i) => !Object.is(value, slot.dependencies[i]))) {
        pending.push(() => {
          slot?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    },
    ResizeObserver: Observer,
    window: { matchMedia: (query) => query.includes("pointer") ? queries[0] : queries[1] },
  });
  function render() {
    assert.ok(mounted);
    let passes = 0;
    do {
      assert.ok(++passes < 10, "Hook must settle instead of looping on measurements");
      cursor = 0;
      changed = false;
      pending = [];
      result = hook(container, paused);
      pending.forEach((commit) => commit());
    } while (changed);
    return result;
  }
  render();
  return {
    observers,
    queries,
    get columns() { return result; },
    pause(value) { paused = value; return render(); },
    resize(value) {
      container.clientWidth = value;
      observers.filter((observer) => !observer.disconnected).forEach((observer) => observer.callback());
      return render();
    },
    media(index, matches) {
      queries[index].matches = matches;
      [...queries[index].listeners].forEach((callback) => callback());
      return render();
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
      mounted = false;
    },
  };
}

test("卡内弹层打开期间不换列，关闭后无需再次 resize 即按最新宽度恢复", () => {
  const feed = masonryFixture(930);
  assert.equal(feed.columns, 3);
  feed.pause(true);
  assert.equal(feed.resize(1240), 3, "保留原父列，避免卡片编辑草稿被重挂载清空");
  assert.equal(feed.resize(1550), 3);
  assert.equal(feed.pause(false), 5, "关闭后主动测量，不能等下次窗口事件才恢复");
  assert.equal(feed.resize(620), 2);
  feed.unmount();
});

test("触屏阅读、极窄容器和最大列数仍有边界，暂停也覆盖媒体查询变化", () => {
  const feed = masonryFixture(1900);
  assert.equal(feed.columns, 6);
  assert.equal(feed.resize(3800), 6);
  feed.pause(true);
  feed.media(0, true);
  feed.media(1, true);
  assert.equal(feed.columns, 6);
  assert.equal(feed.pause(false), 1);
  feed.media(0, false);
  assert.equal(feed.resize(250), 1);
  assert.equal(feed.resize(0), 1, "暂时隐藏的容器不产生零列或丢任务");
  feed.unmount();
});

test("暂停切换和卸载都释放旧尺寸观察器及媒体查询监听", () => {
  const feed = masonryFixture(930);
  const first = feed.observers[0];
  assert.deepEqual(feed.queries.map((query) => query.listeners.size), [1, 1]);
  feed.pause(true);
  assert.equal(first.disconnected, true);
  assert.deepEqual(feed.queries.map((query) => query.listeners.size), [1, 1], "effect 重建不能累积监听");
  feed.pause(false);
  feed.unmount();
  assert.ok(feed.observers.every((observer) => observer.disconnected));
  assert.deepEqual(feed.queries.map((query) => query.listeners.size), [0, 0]);
});

test("预览和库存编辑共同保持暂停，新卡片关闭通知不清除其他任务的弹层状态", () => {
  const registration = find(page, (node) => ts.isVariableDeclaration(node) && node.name.getText(page) === "onTaskOverlayOpenChange");
  let openIds = new Set();
  const notify = evaluate(registration.initializer.arguments[0].getText(page), {
    setOpenTaskOverlays: (update) => { openIds = update(openIds); },
  });
  const overlay = find(card, (node) => ts.isVariableDeclaration(node) && node.name.getText(card) === "overlayOpen");
  const reportEffect = find(card, (node) => ts.isCallExpression(node) && node.expression.getText(card) === "useEffect"
    && node.arguments[0]?.getText(card).includes("onOverlayOpenChange"));
  function mount(id, previewAttachment, criticalEditorOpen) {
    const overlayOpen = evaluate(overlay.initializer.getText(card), { previewAttachment, criticalEditorOpen });
    return evaluate(reportEffect.arguments[0].getText(card), { task: { id }, overlayOpen, onOverlayOpenChange: notify })();
  }
  const closePreviewCard = mount("preview", { id: "image" }, false);
  const firstSet = openIds;
  const closeIdleCard = mount("new-idle-card", null, false);
  assert.equal(openIds, firstSet, "无关 false 通知应保持原集合，避免额外重排");
  const editorReport = find(editor, (node) => ts.isCallExpression(node) && node.expression.getText(editor) === "useEffect"
    && node.arguments[0]?.getText(editor).includes("onOpenChange"));
  let editorOpen = false;
  evaluate(editorReport.arguments[0].getText(editor), { editorOpen: true, onOpenChange: (value) => { editorOpen = value; } })();
  const closeEditorCard = mount("editor", null, editorOpen);
  assert.deepEqual([...openIds], ["preview", "editor"]);
  closePreviewCard();
  closeIdleCard();
  assert.deepEqual([...openIds], ["editor"], "一个任务关闭或卸载不能解除另一个编辑器的保护");
  closeEditorCard();
  assert.equal(openIds.size, 0);
  assert.doesNotThrow(() => evaluate(editorReport.arguments[0].getText(editor), { editorOpen: false, onOpenChange: undefined })());
});

test("分批追加保留每列已有前缀，任务既不遗漏也不重复，并可按横向顺序还原原排序", () => {
  const distribute = evaluate(namedFunction("distributeIntoColumns"));
  const tasks = Array.from({ length: 23 }, (_, id) => Object.freeze({ id }));
  for (const count of [1, 2, 3, 6]) {
    const initial = distribute(tasks.slice(0, 9), count);
    const appended = distribute(tasks, count);
    for (let column = 0; column < count; column++) {
      assert.deepEqual(appended[column].slice(0, initial[column].length), initial[column]);
    }
    const restored = [];
    for (let row = 0; row < Math.ceil(tasks.length / count); row++) {
      for (const column of appended) if (column[row]) restored.push(column[row]);
    }
    assert.deepEqual(restored, tasks);
    assert.equal(new Set(appended.flat()).size, tasks.length);
  }
});
