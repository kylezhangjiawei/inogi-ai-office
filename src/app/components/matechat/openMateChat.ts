import { normalizeMateChatPageContext, type MateChatPageContext } from './pageContext';

/** 跨组件打开 MateChat 悬浮窗的全局事件名 */
export const MATECHAT_OPEN_EVENT = 'matechat:open';

/** MateChat 产生使用行为（如提交提问）的全局事件名，用于让打卡卡片等实时刷新 */
export const MATECHAT_ACTIVITY_EVENT = 'matechat:activity';

export type OpenMateChatOptions = {
  pageContext?: MateChatPageContext;
  /** 只填入输入框，等待用户发送。 */
  prompt?: string;
  intent?: 'delivery_check';
};

/** 同时用于发送端和事件监听端；忽略旧点击事件及不支持的参数。 */
export function normalizeOpenMateChatOptions(value: unknown): OpenMateChatOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const pageContext = normalizeMateChatPageContext(input.pageContext);
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  return {
    ...(pageContext ? { pageContext } : {}),
    ...(prompt ? { prompt } : {}),
    ...(pageContext && input.intent === 'delivery_check' ? { intent: 'delivery_check' as const } : {}),
  };
}

/** 任意位置调用即可唤起 MateChat；上下文和提示词不会自动发送消息。 */
export function openMateChat(options: OpenMateChatOptions): void;
export function openMateChat(): void;
export function openMateChat(options?: OpenMateChatOptions) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MATECHAT_OPEN_EVENT, {
      detail: normalizeOpenMateChatOptions(options),
    }));
  }
}

/** MateChat 发生使用行为后广播，订阅方（连续打卡卡片）据此自动刷新，无需手动刷新页面。 */
export function notifyMateChatActivity() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MATECHAT_ACTIVITY_EVENT));
  }
}
