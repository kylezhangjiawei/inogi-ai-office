/**
 * 研发任务域「工作区」隔离（任务池命名空间）。
 *
 * 背景：中美协同模块（/us-collab-*）复用研发的页面与接口，但任务池、人员池、
 * 审批流、AI 策略、操作留痕必须与研发池完全隔离，互不可见、互不影响。
 *
 * 机制：
 * - 前端在协同路由下给所有 /api/research-development/* 请求追加 ?workspace=us-collab；
 * - RdWorkspaceInterceptor 校验工作区合法性与页面权限后，把工作区放进 AsyncLocalStorage；
 * - 服务层存储咽喉点（readValue / buildSettingUpsert 等）通过 resolveRdStoreKey 把
 *   `rd.*` 键改写为 `rdws.{workspace}.*`，业务逻辑零改动即完成数据隔离。
 * - 默认工作区 'rd' 不改写键（存量数据零迁移）；deptkb.* 等非 rd.* 键不受影响。
 * - 无 HTTP 上下文的内部调用（定时任务/跨模块注入）拿不到 ALS → 落到默认研发池，行为与历史一致。
 */
import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Observable } from 'rxjs';

export const RD_DEFAULT_WORKSPACE = 'rd';
export const RD_WORKSPACE_IDS: ReadonlySet<string> = new Set([RD_DEFAULT_WORKSPACE, 'us-collab']);

/**
 * 各工作区的准入码（拥有其一即可访问该池；超管 '*' 通行）。
 * rd-people:manage 特殊：人员管理页路由（/rd-people-management、/us-collab-people-management）
 * 的守卫就是这一个操作码，存在「只配它、不配任何页面码」的合法角色，两池都需放行，
 * 否则该角色的人员管理接口全 403（历史行为回归）。
 */
const WORKSPACE_PAGE_CODES: Record<string, string[]> = {
  rd: [
    'page:rd-task-management',
    'page:rd-my-workspace',
    'page:rd-director-dashboard',
    'page:rd-approval-flow',
    'page:rd-audit-log',
    'page:rd-ai-settings',
    'page:rd-sheet',
    'page:rd-knowledge-base',
    'rd-people:manage',
  ],
  'us-collab': ['page:us-collab-cockpit', 'page:us-collab-workspace', 'rd-people:manage'],
};

/**
 * 不参与池隔离的存储键：消息通知是「用户级」数据（按 recipient 过滤），
 * 跨池割裂会导致顶栏铃铛/消息中心在不同路由下看到不同的通知流。
 * 协同池任务事件产生的通知与研发通知写同一份全局消息流。
 */
const WORKSPACE_EXEMPT_KEYS = new Set(['rd.messages']);

/** 消息端点同样豁免池级准入（类级 @Permissions 仍生效）：任意可登录研发/协同页面的用户都能读写自己的消息。 */
const WORKSPACE_EXEMPT_URL = /\/messages(\/|\?|$)/;

const rdWorkspaceAls = new AsyncLocalStorage<{ workspace: string }>();

export function currentRdWorkspace(): string {
  return rdWorkspaceAls.getStore()?.workspace ?? RD_DEFAULT_WORKSPACE;
}

/**
 * 存储键命名空间改写：默认池原样返回（存量数据不动）；
 * 其他工作区把 `rd.` 前缀改写为 `rdws.{workspace}.`，非 rd.* 键（deptkb.* 等）不改写。
 */
export function resolveRdStoreKey(key: string): string {
  const workspace = currentRdWorkspace();
  if (workspace === RD_DEFAULT_WORKSPACE) return key;
  if (!key.startsWith('rd.')) return key;
  if (WORKSPACE_EXEMPT_KEYS.has(key)) return key;
  return `rdws.${workspace}.${key.slice('rd.'.length)}`;
}

/** 在指定工作区上下文中执行回调（供 Cron/后台任务等无 HTTP 上下文的调用方遍历各池）。 */
export function runInRdWorkspace<T>(workspace: string, fn: () => Promise<T>): Promise<T> {
  return rdWorkspaceAls.run({ workspace }, fn);
}

type AuthedRequest = {
  query?: Record<string, unknown>;
  user?: { permissions?: string[] };
};

@Injectable()
export class RdWorkspaceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const raw = request?.query?.workspace;
    const workspace = typeof raw === 'string' && raw.trim() ? raw.trim() : RD_DEFAULT_WORKSPACE;

    if (!RD_WORKSPACE_IDS.has(workspace)) {
      throw new ForbiddenException(`未知的任务工作区：${workspace}`);
    }

    // 消息端点豁免池级准入（消息是用户级全局数据，存储键同样豁免改写），直接以默认池执行
    if (WORKSPACE_EXEMPT_URL.test((request as { url?: string })?.url ?? '')) {
      return next.handle();
    }

    // 匿名请求（@Public 端点，如 oss-preview 的 HMAC 能力 URL，iframe 带不了 Authorization）：
    // 仅允许默认池且跳过页面码校验——这些端点有自己的 token 防护，且不按用户读池数据。
    if (!request?.user) {
      if (workspace !== RD_DEFAULT_WORKSPACE) {
        throw new ForbiddenException('没有访问该任务工作区的权限');
      }
    } else {
      // 池级准入：页面码决定「能进哪个池」，操作码只决定「池内能做什么」。
      // 这样即便操作码（rd-task:* 等）在两池共享，也无法凭操作码跨池读写。
      const permissions = request.user.permissions ?? [];
      const allowed =
        permissions.includes('*') ||
        (WORKSPACE_PAGE_CODES[workspace] ?? []).some((code) => permissions.includes(code));
      if (!allowed) {
        throw new ForbiddenException('没有访问该任务工作区的权限');
      }
    }

    return new Observable((subscriber) => {
      rdWorkspaceAls.run({ workspace }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}