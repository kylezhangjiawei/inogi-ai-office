import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { RD_DEFAULT_WORKSPACE, RD_WORKSPACE_IDS } from '../research-development/rd-workspace.context';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 落库前必须抹掉的键。与 ApiRequestLogInterceptor 的同名集合保持一致 ——
 * 两个拦截器都在记请求体，口径不一致就等于其中一个在漏。
 *
 * 实测本地库里 auth 模块有 474 条 refresh 记录存了明文 refreshToken、
 * 7 条 login 记录存了 encryptedPassword：刷新令牌是 bearer 凭据，
 * 拿到就能换访问令牌，落在留痕表里等于给了一份可离线利用的凭据副本。
 */
const SENSITIVE_KEYS = [
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'secret',
  'credential',
  'authorization',
];

/** 键名命中敏感词（含子串，覆盖 encryptedPassword / refreshToken 这类驼峰写法）。 */
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((word) => normalized.includes(word));
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string; name?: string } }>();

    if (!WRITE_METHODS.has(req.method)) return next.handle();

    const userId = req.user?.id ?? null;
    const actorName = req.user?.name ?? null;
    const [resource, resourceId] = this.parseUrl(req.path);
    const module = this.resolveModule(resource, req);
    const ip = req.ip ?? null;

    // 成功与失败都写：失败的写请求同样是「谁试图改了什么」，
    // 被拒的越权尝试恰恰是审计最该留下的那一类，原先只在 tap() 里记等于全丢了。
    return next.handle().pipe(
      tap((body: unknown) => {
        // 登录/换令牌跑在鉴权之前，req.user 必然为空，操作人只能从响应里的用户拿——
        // 否则这批记录的操作人一律显示「系统」，登录审计等于没有。
        const fromBody = resource === 'auth' ? this.actorFromResponse(body) : null;
        this.write(req, {
          userId: userId ?? fromBody?.id ?? null,
          actorName: actorName ?? fromBody?.name ?? null,
          module,
          resource,
          resourceId,
          ip,
        });
      }),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : 500;
        this.write(req, { userId, actorName, module, resource, resourceId, ip, statusCode });
        return throwError(() => error);
      }),
    );
  }

  /** 登录/刷新令牌的响应里带着用户档案，用它补上操作人。 */
  private actorFromResponse(body: unknown): { id: string | null; name: string | null } | null {
    if (!body || typeof body !== 'object') return null;
    const user = (body as { user?: unknown }).user;
    if (!user || typeof user !== 'object') return null;
    const id = (user as { id?: unknown }).id;
    const name = (user as { name?: unknown }).name;
    return {
      id: typeof id === 'string' ? id : null,
      name: typeof name === 'string' ? name : null,
    };
  }

  private write(
    req: Request,
    ctx: {
      userId: string | null;
      actorName: string | null;
      module: string;
      resource: string;
      resourceId: string | null;
      ip: string | null;
      statusCode?: number;
    },
  ): void {
    const meta = this.sanitizeMeta(req.body, ctx.resource) as Record<string, unknown>;
    void this.prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        actorName: ctx.actorName,
        module: ctx.module,
        // 拦截器抓到的是 HTTP 原始写请求，与页面业务留痕（web/ai/system）在统一留痕页按来源区分
        source: 'api',
        action: req.method,
        resource: ctx.resource,
        resourceId: ctx.resourceId,
        meta: (ctx.statusCode ? { ...meta, failed_status: ctx.statusCode } : meta) as Prisma.InputJsonValue,
        ip: ctx.ip,
      },
    }).catch((error: unknown) => {
      this.logger.error(
        `审计日志写入失败: ${req.method} ${req.path}`,
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  /**
   * 模块归属。除研发外直接用 URL 首段；研发的三个池（研发/中美协同/生产）共用
   * 同一批端点，靠前端追加的 ?workspace= 区分，与 RdWorkspaceInterceptor 同一来源。
   * 这里不读 AsyncLocalStorage：留痕写在 tap() 里，此时请求上下文已退出。
   */
  private resolveModule(resource: string, req: Request): string {
    if (resource !== 'research-development') return resource;
    const raw = typeof req.query?.workspace === 'string' ? req.query.workspace.trim() : '';
    return RD_WORKSPACE_IDS.has(raw) ? raw : RD_DEFAULT_WORKSPACE;
  }

  /**
   * URL → [资源段, 子段]。例：/api/procurement/tasks → ['procurement', 'tasks']。
   *
   * 原实现写的是 `parts[1] && !/^\d+$/.test(parts[1]) === false ? parts[1] : (parts[1] ?? null)`——
   * 两个分支返回同一个值，条件判断没有任何作用，等价于直接取 parts[1]。
   */
  private parseUrl(path: string): [string, string | null] {
    const parts = path.replace(/^\/api\//, '').split('/');
    return [parts[0] ?? path, parts[1] || null];
  }

  private sanitizeMeta(body: unknown, resource: string): Prisma.InputJsonValue {
    if (!body || typeof body !== 'object') return {};

    const meta = { ...(body as Record<string, unknown>) };

    // 凭据一律不落库。放在最前面：后面的分支只处理体积问题，漏一个键就是漏一份凭据
    for (const key of Object.keys(meta)) {
      if (isSensitiveKey(key)) meta[key] = '[redacted]';
    }
    const referenceImageData = meta.reference_image_data;
    if (typeof referenceImageData === 'string') {
      meta.reference_image_data = '[omitted base64 image]';
      meta.reference_image_data_chars = referenceImageData.length;
    }

    const prompt = meta.prompt;
    if (resource === 'image-generation' && typeof prompt === 'string') {
      meta.prompt_length = prompt.length;
      meta.prompt_preview = prompt.slice(0, 120);
      delete meta.prompt;
    }

    return meta as Prisma.InputJsonValue;
  }
}
