import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("RDTaskManagementPage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useCockpitSearchKeyword");
assert.ok(hook);
let input;
let clearButton;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input"
    && node.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "aria-label" && prop.initializer?.getText(ast).includes("搜索任务全部内容"))) input = node;
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button"
    && node.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "aria-label" && prop.initializer?.getText(ast).includes("清空搜索"))) clearButton = node.openingElement;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(input);
assert.ok(clearButton);

function evaluate(expression, bindings) {
  const code = ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

function fixture(initialKeyword = "") {
  const slots = [];
  const effects = [];
  const published = [];
  let cursor = 0;
  let keyword = initialKeyword;
  let current;
  let closed = 0;
  let focused = 0;
  const onKeywordChange = (value) => published.push(value);
  const bindings = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) {
        slots[index] = deps;
        effects.push(callback);
      }
    },
    useCallback: (callback) => callback,
  };
  const useKeyword = evaluate(`${hook.getText(ast)}\nreturn useCockpitSearchKeyword;`, bindings);
  const render = () => {
    cursor = 0;
    current = useKeyword(keyword, onKeywordChange);
    while (effects.length) effects.shift()();
    cursor = 0;
    current = useKeyword(keyword, onKeywordChange);
    return current;
  };
  const handler = (name, element = input) => {
    const attribute = element.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name);
    assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer), `Missing ${name}`);
    return evaluate(`return ${attribute.initializer.expression.getText(ast)};`, {
      setCockpitKeyword: current.setKeyword,
      startSearchComposition: current.onCompositionStart,
      endSearchComposition: current.onCompositionEnd,
      searchComposingRef: current.composingRef,
      cockpitKeyword: current.value,
      searchInputRef: { current: { focus: () => { focused++; } } },
      clearSearchAndRestoreFocus: () => { closed++; current.setKeyword(""); },
    });
  };
  render();
  return {
    published,
    get state() { return current; },
    get closed() { return closed; },
    get focused() { return focused; },
    urlValue(value) { keyword = value; return render(); },
    change(value) { handler("onChange")({ target: { value } }); return render(); },
    start() { handler("onCompositionStart")(); return render(); },
    end(value) { handler("onCompositionEnd")({ currentTarget: { value } }); return render(); },
    clear() { handler("onClick", clearButton)(); return render(); },
    key(key, nativeEvent = {}, keyCode = 0) {
      const event = { key, nativeEvent, keyCode, prevented: false, preventDefault() { this.prevented = true; } };
      handler("onKeyDown")(event);
      render();
      return event;
    },
  };
}

test("拼音组词期间保留输入草稿，不更新 URL 或任务筛选，选字后提交完整中文一次", () => {
  const search = fixture();
  search.start();
  assert.ok(!input.attributes.properties.some((prop) => prop.name?.getText(ast) === "onBlur"), "失焦不再折叠或卸载常驻搜索框");
  search.change("yan");
  assert.equal(search.state.value, "yan");
  assert.equal(search.state.committedKeyword, "");
  search.change("yan fa");
  assert.equal(search.state.value, "yan fa");
  assert.deepEqual(search.published, []);
  search.end("研发");
  assert.equal(search.state.value, "研发");
  assert.equal(search.state.committedKeyword, "研发");
  search.change("研发");
  assert.deepEqual(search.published, ["研发"], "compositionend 后浏览器追加的 change 不重复提交");
  search.urlValue("研发");
  assert.equal(search.state.value, "研发");
});

test("路由的迟到值不会覆盖正在输入的中文组合草稿", () => {
  const search = fixture();
  search.change("R");
  search.start();
  search.change("Ryanfa");
  search.urlValue("R");
  assert.equal(search.state.value, "Ryanfa");
  search.end("R研发");
  assert.equal(search.state.value, "R研发");
  assert.equal(search.state.committedKeyword, "R研发");
  assert.deepEqual(search.published, ["R", "R研发"]);
});

test("输入法候选中的 Escape 或229键不清空搜索，普通 Escape 仍可清空", () => {
  const search = fixture("研发");
  search.start();
  search.change("研发ren");
  assert.equal(search.key("Escape").prevented, false);
  assert.equal(search.closed, 0);
  search.end("研发人");
  assert.equal(search.key("Escape", { isComposing: true }).prevented, false);
  assert.equal(search.key("Escape", {}, 229).prevented, false);
  assert.equal(search.closed, 0);
  assert.equal(search.key("Escape").prevented, true);
  assert.equal(search.closed, 1);
  assert.equal(search.state.value, "");
  assert.equal(search.state.committedKeyword, "");
});

test("英文逐字输入同步显示，清空及外部 URL 搜索更新保持可用", () => {
  const search = fixture();
  for (const value of ["R", "RD", "RD-12"]) {
    search.change(value);
    assert.equal(search.state.value, value);
    assert.equal(search.state.committedKeyword, value);
  }
  assert.deepEqual(search.published, ["R", "RD", "RD-12"]);
  search.urlValue("RD-12");
  search.clear();
  assert.equal(search.state.value, "");
  assert.equal(search.state.committedKeyword, "");
  assert.equal(search.published.at(-1), "");
  assert.equal(search.focused, 1, "点击清空后继续聚焦搜索框");
  search.urlValue("从任务链接进入");
  assert.equal(search.state.value, "从任务链接进入");
  assert.equal(search.state.committedKeyword, "从任务链接进入");
});
