/** 跨组件打开 MateChat 悬浮窗的全局事件名 */
export const MATECHAT_OPEN_EVENT = 'matechat:open';

/** MateChat 产生使用行为（如提交提问）的全局事件名，用于让打卡卡片等实时刷新 */
export const MATECHAT_ACTIVITY_EVENT = 'matechat:activity';

/** 任意位置调用即可唤起 MateChat 悬浮窗（由 MateChatBubble 监听）。 */
export function openMateChat() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MATECHAT_OPEN_EVENT));
  }
}

/** MateChat 发生使用行为后广播，订阅方（连续打卡卡片）据此自动刷新，无需手动刷新页面。 */
export function notifyMateChatActivity() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MATECHAT_ACTIVITY_EVENT));
  }
}
