import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../src/app/procurement/horizon.css", import.meta.url),
  "utf8",
);

function ruleBody(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `应存在 ${selector} 规则`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

test("采购精细化样式维持单一 Horizon 设计令牌", () => {
  assert.match(css, /--proc-primary:\s*#002fa7/);
  assert.match(css, /--proc-canvas:\s*#f7f9fc/);
  assert.match(css, /--proc-line:\s*#e2e8f0/);
  assert.match(css, /--proc-shadow-card:\s*0 1px 2px/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);

  assert.doesNotMatch(css, /(?:linear|radial)-gradient/i);
  assert.doesNotMatch(css, /backdrop-filter|filter:\s*blur/i);
  assert.doesNotMatch(css, /transition:\s*all/i);
});

test("采购主容器使用清晰边界与克制层级", () => {
  const borderedSelectors = [
    ".proc-horizon .proc-horizon-command",
    ".proc-horizon .proc-horizon-people-nav",
    ".proc-horizon .proc-horizon-task-feed",
    ".proc-horizon .proc-horizon-system-panorama",
    ".proc-horizon .proc-horizon-surface",
    ".proc-horizon .proc-horizon-workspace-surface",
  ];

  for (const selector of borderedSelectors) {
    const body = ruleBody(selector);
    assert.match(body, /border(?:-color)?:[^;]*var\(--proc-line\)/);
    assert.doesNotMatch(body, /border(?:-color)?:[^;]*transparent/);
  }

  assert.doesNotMatch(css, /border-radius:\s*(?:18|20)px/);
});

test("采购交互保留键盘焦点与减少动态偏好", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline:\s*2px solid rgba\(0, 47, 167, 0\.72\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
