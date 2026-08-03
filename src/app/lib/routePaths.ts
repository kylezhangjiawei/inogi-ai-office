/**
 * 页面路径解析：把「页面路由管理」里配置的 routePath 变成真正生效的路由与导航路径。
 *
 * 为什么单独成文件、而不是放进 routesConfig.tsx：
 *  - routesConfig.tsx 是 React/图标重量级配置模块，而本模块需要被 App.tsx（建路由，模块顶层同步执行）、
 *    routesConfig.tsx（建导航）和侧边栏同时引用，且自身要做 localStorage 读写与网络刷新，
 *    放进去会形成「配置 ↔ 数据获取」的双向耦合。
 *
 * ── 为什么是「同步表 + 后台刷新」，而不是等接口返回再建路由 ──
 * 路由表在模块加载时就要建好。若改成等待接口：
 *   1) 首屏被网络阻塞；2) 接口失败 = 全站没有任何路由（白屏），比现在「某页进不去」严重得多；
 *   3) 中途换 router 会打断正在进行的导航。
 * 所以这里始终提供一个同步可用的表：内置默认值打底，上次成功拉取的缓存覆盖，
 * 本次拉取的结果写入缓存供**下次加载**使用。管理员改路径后刷新页面即全站生效——
 * 对一个低频运维动作而言这是合理代价，且换来「任何情况下都不会白屏」。
 */

const CACHE_KEY = "route-paths-v1";

/** code → 自定义主路径（以 / 开头）。仅含与内置默认值不同的项。 */
let overrides: Record<string, string> = {};

try {
  const raw = localStorage.getItem(CACHE_KEY);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      overrides = parsed as Record<string, string>;
    }
  }
} catch {
  // 缓存损坏/隐私模式禁用 storage：忽略，退回内置默认值
  overrides = {};
}

/** 路径合法性：与后端 assertRoutePathUsable 同口径，防止脏缓存把路由带坏。 */
function isUsablePath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.startsWith("/") &&
    !/[\s?#]/.test(path) &&
    !path.includes(":") &&
    !path.includes("*")
  );
}

/**
 * 解析某页面的主路径。
 * @param code     权限码（如 page:rd-sheet）
 * @param fallback 内置默认路径，必须以 / 开头。目录无此项或值非法时使用它 —— 因此
 *                 即使目录完全不可用，行为也与改造前完全一致。
 */
export function routePath(code: string, fallback: string): string {
  const custom = overrides[code];
  return isUsablePath(custom) ? custom : fallback;
}

/**
 * 派生子路由：详情页/新建页等跟随主路径移动。
 * 例：subRoutePath("page:after-sales", "/after-sales", ":id") → "/after-sales/:id"
 * 主路径改成 /aftersales 后自动变为 "/aftersales/:id"，无需逐条改代码。
 */
export function subRoutePath(code: string, fallback: string, suffix: string): string {
  const base = routePath(code, fallback);
  const clean = suffix.replace(/^\//, "");
  return base === "/" ? `/${clean}` : `${base}/${clean}`;
}

/** react-router 的子路由 path 不能以 / 开头（相对父级 "/"），这里去掉前导斜杠。 */
export function asChildPath(path: string): string {
  return path === "/" ? "" : path.replace(/^\//, "");
}

/**
 * 用最新的目录数据刷新缓存。由侧边栏在拉取 nav-meta 后调用。
 * 只写缓存、不改当前进程的 overrides —— 中途改变已建好的路由表毫无意义（router 已定型），
 * 反而会让同一次会话里导航与路由不一致。下次加载自然生效。
 */
export function cacheRoutePaths(items: Array<{ code: string; routePath: string }>): void {
  const next: Record<string, string> = {};
  for (const item of items) {
    if (item?.code && isUsablePath(item.routePath)) next[item.code] = item.routePath;
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // storage 不可用时静默跳过：不影响本次会话，只是下次仍用内置默认值
  }
}

/** 当前生效的自定义路径是否与最新目录一致。不一致说明需要刷新页面才能应用。 */
export function hasPendingRoutePathChanges(
  items: Array<{ code: string; routePath: string }>,
): boolean {
  return items.some(
    (item) =>
      item?.code &&
      isUsablePath(item.routePath) &&
      (overrides[item.code] ?? "") !== item.routePath &&
      overrides[item.code] !== undefined,
  );
}
