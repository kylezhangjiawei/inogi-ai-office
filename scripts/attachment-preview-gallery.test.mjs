import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/components/AttachmentPreviewDialog.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(`${source}\nexport { AttachmentContent };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const attachments = Array.from({ length: 8 }, (_, index) => ({
  id: `photo-${index}`, name: `图片${index + 1}.png`, url: `/original/${index}.png`,
  previewUrl: `/preview/${index}.png`, downloadUrl: `/download/${index}.png`, thumbUrl: `/thumb/${index}.png`,
}));

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function content(tree) {
  if (Array.isArray(tree)) return tree.map(content).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  return tree && typeof tree === "object" ? content(tree.props?.children) : "";
}

// Execute the component's real handlers with persistent hook state. Browser QA
// separately covers Radix focus trapping, image gestures and viewport geometry.
function fixture(component = "AttachmentPreviewDialog", initialProps = {}) {
  const slots = [];
  let cursor = 0, tree, closed = 0, focused = 0;
  let props = initialProps;
  class FixtureElement {
    isConnected = true;
    localKeys = false;
    closest() { return this.localKeys ? this : null; }
    focus() { focused++; }
  }
  const opener = new FixtureElement();
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useEffect(callback, deps) {
        const index = cursor++;
        if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: callback() };
        }
      },
      useCallback(callback, deps) {
        const index = cursor++;
        if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { deps, callback };
        return slots[index].callback;
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "../lib/i18n": { useI18n: () => ({ t: (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match) }) },
    "../lib/resourceAccess": { downloadResource: async () => undefined },
    "../lib/xlsxPreview": { parseXlsxForPreview: async () => [] },
    "./ui/utils": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  };
  const hookExports = {};
  const hookCode = ts.transpileModule(readFileSync(new URL("../src/app/lib/useRenewableResource.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("exports", "require", hookCode)(hookExports, (name) => name === "react" ? dependencies.react : { reportResourceFailure() {} });
  dependencies["../lib/useRenewableResource"] = hookExports;
  const exports = {};
  new Function("exports", "require", "document", "HTMLElement", "Element", code)(exports, (name) => {
    if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(name)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };

    if (name in dependencies) return dependencies[name];
    assert.ok(["lucide-react", "./ui/dialog", "./MobileZoomableImage"].includes(name), `Unexpected dependency: ${name}`);
    return new Proxy({}, { get: (_target, name) => name });
  }, { activeElement: opener, documentElement: { classList: { contains: () => false } } }, FixtureElement, FixtureElement);
  const view = {
    get focused() { return focused; }, get closed() { return closed; },
    render(nextProps) {
      if (nextProps) props = nextProps;
      cursor = 0;
      tree = exports[component]({ onClose: () => { closed++; }, ...props });
      return tree;
    },
    node(type) { return nodes(tree).find((node) => node.type === type || node.type?.name === type); },
    title() { return content(view.node("DialogTitle")); },
    button(label) { return nodes(tree).find((node) => node.type === "Button" && node.props["aria-label"] === label); },
    click(label) {
      const button = view.button(label);
      assert.ok(button, `Missing button: ${label}`);
      assert.ok(!button.props.disabled, `Disabled button: ${label}`);
      button.props.onClick();
      return view.render();
    },
    key(key, overrides = {}) {
      const target = new FixtureElement();
      target.localKeys = Boolean(overrides.localKeys);
      let prevented = false;
      view.node("DialogContent").props.onKeyDown({ key, target, nativeEvent: {}, preventDefault() { prevented = true; }, ...overrides });
      view.render();
      return prevented;
    },
  };
  view.render();
  return view;
}

test("从卡片折叠项打开时定位所选附件并保留全部 8 项", () => {
  const view = fixture("AttachmentPreviewDialog", { attachment: attachments[5], attachments });
  assert.equal(view.title(), "图片6.png");
  for (let index = 0; index < attachments.length; index++) assert.ok(view.button(`预览第 ${index + 1} 个附件：图片${index + 1}.png`));
  assert.equal(view.node("AttachmentContent").props.attachment.previewUrl, "/preview/5.png");
  assert.equal(view.node("a").props.href, "/download/5.png");
  view.click("下一个附件");
  assert.equal(view.title(), "图片7.png");
  assert.equal(view.node("a").props.href, "/download/6.png");
  view.click("预览第 2 个附件：图片2.png");
  assert.equal(view.title(), "图片2.png");
});

test("首尾边界禁止越界，切换时为缩放和媒体提供独立实例", () => {
  const view = fixture("AttachmentPreviewDialog", { attachment: attachments[0], attachments });
  const firstPreview = view.node("AttachmentContent");
  assert.equal(view.button("上一个附件").props.disabled, true);
  view.key("ArrowLeft");
  assert.equal(view.title(), "图片1.png");
  view.click("预览第 8 个附件：图片8.png");
  assert.equal(view.button("下一个附件").props.disabled, true);
  assert.notEqual(view.node("AttachmentContent").key, firstPreview.key);
  view.key("ArrowRight");
  assert.equal(view.title(), "图片8.png");
  view.click("上一个附件");
  assert.equal(view.title(), "图片7.png");
});

test("列表重新排序仍显示原选中附件，外部改选附件时重新定位", () => {
  const view = fixture("AttachmentPreviewDialog", { attachment: attachments[0], attachments });
  view.click("预览第 5 个附件：图片5.png");
  view.render({ attachment: attachments[0], attachments: [...attachments].reverse() });
  assert.equal(view.title(), "图片5.png");
  view.render({ attachment: attachments[2], attachments });
  assert.equal(view.title(), "图片3.png");
});

test("左右键切换但不拦截图片控件、编辑、输入法与组合键，Escape 交给 Dialog", () => {
  const view = fixture("AttachmentPreviewDialog", { attachment: attachments[2], attachments });
  assert.equal(view.key("ArrowRight"), true);
  assert.equal(view.title(), "图片4.png");
  for (const guard of [{ localKeys: true }, { nativeEvent: { isComposing: true } }, { ctrlKey: true }, { defaultPrevented: true }]) {
    assert.equal(view.key("ArrowRight", guard), false);
    assert.equal(view.title(), "图片4.png");
  }
  assert.equal(view.key("Escape"), false);
  view.node("Dialog").props.onOpenChange(false);
  assert.equal(view.closed, 1);
  let prevented = false;
  view.node("DialogContent").props.onCloseAutoFocus({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(view.focused, 1);
});

test("原单附件调用兼容；列表缺少传入附件时仍可预览和下载该附件", () => {
  const single = fixture("AttachmentPreviewDialog", { attachment: attachments[0] });
  assert.equal(single.title(), "图片1.png");
  assert.equal(single.button("下一个附件"), undefined);
  const missing = fixture("AttachmentPreviewDialog", { attachment: attachments[7], attachments: attachments.slice(0, 3) });
  assert.equal(missing.title(), "图片8.png");
  assert.equal(missing.node("a").props.href, "/download/7.png");
});

test("图片错误显示就地反馈；PDF 保留浏览器查看器且媒体使用预览地址", () => {
  const image = fixture("AttachmentContent", { attachment: attachments[0], mime: "image/png" });
  assert.equal(image.node("MobileZoomableImage").props.controlsPlacement, "below", "缩放工具应在图片区域外，避免遮住长图底部");
  image.node("MobileZoomableImage").props.onError();
  assert.match(content(image.render()), /图片加载失败/);
  assert.equal(image.node("MobileZoomableImage"), undefined);
  for (const [mime, tag] of [["application/pdf", "iframe"], ["video/mp4", "video"], ["audio/mpeg", "audio"]]) {
    const view = fixture("AttachmentContent", { attachment: { name: "附件", url: "/original", previewUrl: "/inline" }, mime });
    assert.equal(view.node(tag).props.src, "/inline");
    assert.equal(view.node(tag).props.sandbox, undefined);
  }
});
