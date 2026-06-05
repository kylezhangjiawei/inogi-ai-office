/**
 * 移动端路由的共享工具：视口判断。
 *
 * 触发策略（L1 + L2）：
 *  - L1 直达：领导直接访问 `/m` 即进入移动版（书签 / 二维码 / IM 卡片）。
 *  - L2 自动跳：登录后若处于移动视口，桌面布局守卫会重定向到 `/m`。
 *    （已移除「偏好电脑版」开关——手机视口恒为移动版，需桌面版改用宽屏访问。）
 *
 * 一律以视口宽度判断，不用 UserAgent（平板 / 折叠屏 / 桌面缩小窗口都会误判 UA）。
 */
export const MOBILE_BREAKPOINT = 768;

/** 当前是否为移动视口（宽度 < 768px）。SSR / 非浏览器环境一律返回 false。 */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}
