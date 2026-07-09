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

/**
 * 当前是否为移动视口（宽度 < 768px）。SSR / 非浏览器环境一律返回 false。
 * 取 innerWidth 与 screen.width 的较小值：全局 min-width:1024 会把移动浏览器/设备模拟器的
 * layout viewport（innerWidth）撑到 1024 导致判定失效，而 screen.width 是设备逻辑宽不受
 * 内容影响（真机=设备宽、DevTools 模拟=模拟宽、桌面=显示器宽——桌面缩窗仍由 innerWidth 判定）。
 */
export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  const effectiveWidth = Math.min(window.innerWidth, window.screen?.width ?? Number.POSITIVE_INFINITY);
  return effectiveWidth < MOBILE_BREAKPOINT;
}
