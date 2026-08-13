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
export const RD_WORKSPACE_IDS: ReadonlySet<string> = new Set([RD_DEFAULT_WORKSPACE, 'us-collab', 'production']);

/**
 * 各工作区的准入码（拥有其一即可访问该池；超管 '*' 通行）。
 * rd-people:manage 特殊：人员管理页路由（/rd-people-management、/us-collab-people-management）
 * 的守卫就是这一个操作码，存在「只配它、不配任何页面码」的合法角色，两池都需放行，
 * 否则该角色的人员管理接口全 403（历史行为回归）。
 * ⚠️ 但它只在「该用户不持有任何池的页面码」时才作为准入依据 —— 见 isWorkspaceAllowed。
 */
export const WORKSPACE_PAGE_CODES: Record<string, string[]> = {
  rd: [
    'page:rd-task-management',
    'page:rd-my-workspace',
    'page:rd-approval-flow',
    'page:rd-audit-log',
    'page:rd-ai-settings',
    'page:rd-sheet',
    'page:rd-knowledge-base',
    'rd-people:manage',
  ],
  'us-collab': [
    'page:us-collab-cockpit',
    'page:us-collab-workspace',
    'page:us-collab-approval-flow',
    'page:us-collab-audit-log',
    'page:us-collab-ai-settings',
    'rd-people:manage',
  ],
  production: [
    'page:rd-director-dashboard',
  ],
};

/**
 * 不参与池隔离的存储键。
 *
 * 曾经装着 'rd.messages'：消息通知是「用户级」数据（按 recipient 过滤），跨池割裂会导致
 * 顶栏铃铛/消息中心在不同路由下看到不同的通知流。消息已迁到 RdMessage 表，不再走
 * resolveRdStoreKey，这条豁免自然消失 —— 表本身就是全局的，两池共用同一份流。
 *
 * 保留这个集合与豁免分支：JSON store 里若再出现同类「用户级、不该按池分家」的键，
 * 加进来即可，不必重新推导一遍这个结论。
 */
const WORKSPACE_EXEMPT_KEYS = new Set<string>([]);

/**
 * 豁免匹配只能针对「路径」，绝不能针对 req.url —— 后者含查询串，
 * 任意 `?x=/messages` / `?x=/task-discussions/a` 参数都能伪造出豁免，
 * 使任意端点跳过池级准入（实测双向越权：协同侧账号读研发池、研发侧账号读协同池）。
 */
export function requestPathOnly(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * 消息端点同样豁免池级准入（类级 @Permissions 仍生效）：任意可登录研发/协同页面的用户都能读写自己的消息。
 * 仅指控制器直属的 `messages` 路由（GET/POST messages、PATCH messages/:messageId）。
 *
 * ⚠️ 不能写成 /\/messages/ —— `task-discussions/:taskId/messages` 同样以 /messages 结尾，
 * 会被误判成消息端点而以默认池执行（不进 ALS），导致协同池的讨论回复写进研发池。
 */
const WORKSPACE_EXEMPT_PATH = /\/research-development\/messages(?:\/|$)/;

/**
 * 讨论邀请是线程级能力链接：受邀成员可能没有研发/协同页面码，但 service 会继续按
 * workspace + taskId + threadId + userId 做精确校验。这里只跳过“整池页面码”门禁，
 * 不跳过工作区上下文，也不会因此获得任务列表或其他讨论的访问权。
 */
const DISCUSSION_CAPABILITY_PATH = /\/research-development\/task-discussions\/[^/]+(?:\/|$)/;

/** 该请求是否命中「消息端点」豁免（入参必须是已剥离查询串的路径）。 */
export function isWorkspaceExemptPath(path: string): boolean {
  return WORKSPACE_EXEMPT_PATH.test(path);
}

/** 该请求是否命中「讨论线程能力链接」豁免（入参必须是已剥离查询串的路径）。 */
export function isDiscussionCapabilityPath(path: string): boolean {
  return DISCUSSION_CAPABILITY_PATH.test(path);
}

/**
 * 「归属」码 ≠「准入」码，必须分开：
 * - 准入码（WORKSPACE_PAGE_CODES）：持有它能**进这个任务池**；
 * - 归属码（这里）：持有它说明**这个人属于该侧**，用于判断跨池特殊码该不该放行。
 *
 * 协同知识库码是二者分家的原因：它不该给任务池准入（知识库另有 DeptKbGuard、
 * 是另一套数据），但它足以证明持有者是协同侧的人 —— 否则「协同知识库 + 人员管理」
 * 这种角色会被当成「无池归属」，被 rd-people:manage 放进研发池（实测越权）。
 */
const WORKSPACE_OWNERSHIP_CODES: Record<string, readonly string[]> = {
  rd: WORKSPACE_PAGE_CODES.rd.filter((code) => code.startsWith('page:')),
  'us-collab': [
    ...WORKSPACE_PAGE_CODES['us-collab'].filter((code) => code.startsWith('page:')),
    'page:dept-kb-us-collab',
  ],
  production: WORKSPACE_PAGE_CODES.production.filter((code) => code.startsWith('page:')),
};

/**
 * 池级准入判定（纯函数，便于复用与验证）。
 *
 * 规则：
 * 1. 超管 '*' 通行；
 * 2. 持有目标池的**准入页面码** → 放行（页面码定池的正常路径）；
 * 3. 只持有 rd-people:manage 这类跨池特殊码时：仅当该用户**不属于其他池**才放行。
 *
 * 第 3 条的限定是关键 —— 协同管理员为了管协同人员必须持有 rd-people:manage，
 * 若无限定，该码会同时成为**研发池**的准入凭据（实测越权：协同管理员 GET
 * /research-development/snapshot 返回 200）。
 *
 * 四种角色的判定结果（已实测）：
 * - 协同管理员（page:us-collab-* + rd-people:manage）：协同池放行（第 2 条）；研发池拒绝（属协同侧）
 * - 研发管理员（page:rd-* + rd-people:manage）：研发池放行；协同池拒绝（属研发侧）
 * - 协同知识库管理员（page:dept-kb-us-collab + rd-people:manage）：研发池拒绝（归属码认出他属协同）；
 *   协同任务池放行 —— 他确实要管协同人员，且没有任何研发归属
 * - 纯 rd-people:manage、不配任何页面码的历史角色：两池放行（历史行为不变，注释见上）
 */
export function isWorkspaceAllowed(workspace: string, permissions: string[]): boolean {
  if (permissions.includes('*')) return true;

  const codes = WORKSPACE_PAGE_CODES[workspace] ?? [];
  const ownPages = codes.filter((code) => code.startsWith('page:'));
  if (ownPages.some((code) => permissions.includes(code))) return true;

  const specialCodes = codes.filter((code) => !code.startsWith('page:'));
  if (!specialCodes.some((code) => permissions.includes(code))) return false;

  // 特殊码只在「不属于其他池」时放行，避免它成为跨池后门
  const otherWorkspacePages = Object.entries(WORKSPACE_OWNERSHIP_CODES)
    .filter(([ws]) => ws !== workspace)
    .flatMap(([, list]) => list);
  return !otherWorkspacePages.some((code) => permissions.includes(code));
}

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
    // 只用路径做豁免匹配：req.url 含查询串，直接匹配整串可被 ?x=/messages 之类的参数伪造豁免
    const requestPath = requestPathOnly((request as { url?: string })?.url ?? '');
    const raw = request?.query?.workspace;
    const workspace = typeof raw === 'string' && raw.trim() ? raw.trim() : RD_DEFAULT_WORKSPACE;

    if (!RD_WORKSPACE_IDS.has(workspace)) {
      throw new ForbiddenException(`未知的任务工作区：${workspace}`);
    }

    // 消息端点豁免池级准入（消息是用户级全局数据，存储键同样豁免改写），直接以默认池执行
    if (isWorkspaceExemptPath(requestPath)) {
      return next.handle();
    }
    const discussionCapabilityRequest = isDiscussionCapabilityPath(requestPath);

    // 匿名请求（@Public 端点，如 oss-preview 的 HMAC 能力 URL，iframe 带不了 Authorization）：
    // 仅允许默认池且跳过页面码校验——这些端点有自己的 token 防护，且不按用户读池数据。
    if (!request?.user) {
      if (workspace !== RD_DEFAULT_WORKSPACE) {
        throw new ForbiddenException('没有访问该任务工作区的权限');
      }
    } else {
      // 池级准入：页面码决定「能进哪个池」，操作码只决定「池内能做什么」。
      // 这样即便操作码（rd-task:* 等）在两池共享，也无法凭操作码跨池读写。
      if (!discussionCapabilityRequest && !isWorkspaceAllowed(workspace, request.user.permissions ?? [])) {
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
