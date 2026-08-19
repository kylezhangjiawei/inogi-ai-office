/**
 * 「用户上传入库」的标记值：GeneratedImage.model、VideoGeneration.mode / model 都写这个值，
 * 用来把上传件与 AI 生成件区分开（用量统计、成本口径按此过滤，前端卡片也据此显示「上传」标）。
 *
 * 单独放在 common 下而不是挂在某个 service 上：ai-usage 与 image/video-generation 互相引用，
 * 常量若定义在 service 文件里会形成循环 import。
 */
export const UPLOADED_MEDIA_MARKER = 'upload';
