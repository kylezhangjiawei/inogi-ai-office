import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/components/header_1.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("header_1.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "useHeaderCockpitKeyword");
assert.ok(hook);
let input;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input"
    && node.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "aria-label" && prop.initializer?.getText(ast).includes("搜索任务、编号、负责人、路径"))) input = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(input);

function evaluate(expression, bindings) {
  const code = ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), code)(...Object.values(bindings));
}

function fixture(initialKeyword = "") {
  const slots = [], effects = [], published = [];
  let cursor = 0, keyword = initialKeyword, enabled = true, current, blurred = 0;
  const useKeyword = evaluate(`${hook.getText(ast)}\nreturn useHeaderCockpitKeyword;`, {
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
  });
  const render = () => {
    cursor = 0;
    current = useKeyword(keyword, (value) => published.push(value), enabled);
    while (effects.length) effects.shift()();
    cursor = 0;
    current = useKeyword(keyword, (value) => published.push(value), enabled);
    return current;
  };
  const handler = (name) => {
    const attribute = input.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === name);
    assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer), `Missing ${name}`);
    return evaluate(`return ${attribute.initializer.expression.getText(ast)};`, { cockpitSearch: current });
  };
  render();
  return {
    published,
    get state() { return current; },
    get blurred() { return blurred; },
    urlValue(value) { keyword = value; return render(); },
    enabled(value) { enabled = value; return render(); },
    change(value) { handler("onChange")({ target: { value } }); return render(); },
    start() { handler("onCompositionStart")(); return render(); },
    end(value) { handler("onCompositionEnd")({ currentTarget: { value } }); return render(); },
    key(key, nativeEvent = {}, keyCode = 0) {
      const event = { key, nativeEvent, keyCode, prevented: false, preventDefault() { this.prevented = true; }, currentTarget: { blur() { blurred++; } } };
      handler("onKeyDown")(event);
      render();
      return event;
    },
  };
}

test("顶部任务搜索组词期间不更改 URL，中文选定后仅提交一次", () => {
  const search = fixture();
  search.start();
  search.change("yan fa");
  assert.equal(search.state.value, "yan fa");
  assert.deepEqual(search.published, []);
  search.end("研发");
  search.change("研发");
  assert.equal(search.state.value, "研发");
  assert.deepEqual(search.published, ["研发"]);
});

test("顶部搜索的迟到 URL 不覆盖正在组词的草稿", () => {
  const search = fixture();
  search.change("R");
  search.start();
  search.change("Ryan fa");
  search.urlValue("R");
  assert.equal(search.state.value, "Ryan fa");
  search.end("R研发");
  assert.deepEqual(search.published, ["R", "R研发"]);
});

test("顶部搜索的输入法 Escape/229 不清空，普通 Escape 清空并失焦", () => {
  const search = fixture("研发");
  search.start();
  search.change("研发ren");
  assert.equal(search.key("Escape").prevented, false);
  search.end("研发人");
  assert.equal(search.key("Escape", { isComposing: true }).prevented, false);
  assert.equal(search.key("Escape", {}, 229).prevented, false);
  assert.equal(search.blurred, 0);
  assert.equal(search.key("Escape").prevented, true);
  assert.equal(search.state.value, "");
  assert.equal(search.blurred, 1);
});

test("顶部搜索英文与外部 URL 更新可用，离开任务页清理组合状态", () => {
  const search = fixture();
  search.change("RD-12");
  assert.deepEqual(search.published, ["RD-12"]);
  search.urlValue("从链接进入");
  assert.equal(search.state.value, "从链接进入");
  search.start();
  search.change("ren");
  search.enabled(false);
  search.urlValue("");
  assert.equal(search.state.composingRef.current, false);
  assert.equal(search.state.value, "");
  search.enabled(true);
  search.change("研发");
  assert.equal(search.published.at(-1), "研发");
});
