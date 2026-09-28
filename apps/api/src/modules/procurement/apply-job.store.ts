import { randomUUID } from 'crypto';

/**
 * 物料批量应用（AI 分类）的内存任务存储。
 *
 * 为什么异步：AI 批量判断要几分钟，同步等响应会被 nginx 网关 60s 超时切成 502。
 * 改为「启动即返回 jobId + 前端轮询进度」。任务存内存 Map（与 AI 图像生成同款假设：
 * API 单实例部署；重启会丢任务，前端轮询 404 时提示重试即可，规则部分幂等无副作用）。
 */

export interface ApplyJob<T = unknown> {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  /** 人类可读进度（如「AI 判断 40/106」），前端直接展示 */
  progress: string;
  startedAt: string;
  finishedAt?: string;
  result?: T;
  error?: string;
}

const jobs = new Map<string, ApplyJob>();
const MAX_JOBS = 50;

export function startApplyJob<T>(
  kind: string,
  runner: (updateProgress: (progress: string) => void) => Promise<T>,
): ApplyJob<T> {
  // 淘汰最旧的已完成任务，防内存无限增长
  if (jobs.size >= MAX_JOBS) {
    for (const [id, job] of jobs) {
      if (job.status !== 'running') {
        jobs.delete(id);
        if (jobs.size < MAX_JOBS) break;
      }
    }
  }
  const job: ApplyJob<T> = {
    id: randomUUID(),
    kind,
    status: 'running',
    progress: '准备中…',
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  void runner((progress) => {
    job.progress = progress;
  })
    .then((result) => {
      job.status = 'done';
      job.result = result;
      job.finishedAt = new Date().toISOString();
    })
    .catch((error: Error) => {
      job.status = 'error';
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
    });
  return job;
}

export function getApplyJob(id: string): ApplyJob | undefined {
  return jobs.get(id);
}
