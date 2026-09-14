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
import { APPLICANT_FORM_LOG_OMITTED, applicantFormLogPath } from '../../common/applicant-form-log-policy';
import { RD_DEFAULT_WORKSPACE, RD_WORKSPACE_IDS } from '../research-development/rd-workspace.context';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 落库前必须抹掉的键。
 *
 * 实测本地库里 auth 模块有 474 条 refresh 记录存了明文 refreshToken、
 * 7 条 login 记录存了 encryptedPassword：刷新令牌是 bearer 凭据，
 * 拿到就能换访问令牌，落在留痕表里等于给了一份可离线利用的凭据副本。
 *
 * 分两段匹配而不是一律按子串：`token` 按子串会误伤 AI 用量里的
 * totalTokens / inputTokens 这类**计数**字段（实测存量里有 55 条），
 * 把正常审计数据抹成 [redacted]。所以 token 类只认确切的凭据键名，
 * password / secret 这些词根才按子串。
 */
const SENSITIVE_EXACT_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'access_token',
  'refresh_token',
  'id_token',
  'bearertoken',
  'authorization',
  'credential',
  'credentials',
  'cookie',
]);

/** 出现即视为凭据的词根，按子串匹配（覆盖 encryptedPassword、appSecret 这类写法）。 */
const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
];

/** 递归下探的深度上限：请求体再深也就几层，够用且不会在畸形结构上打转。 */
const MAX_REDACT_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;
  return SENSITIVE_KEY_PARTS.some((word) => normalized.includes(word));
}

/** 嵌套结构里的凭据同样要抹。数组逐项下探，深度足够覆盖实际请求体。 */
function redactSensitive(key: string, value: unknown, depth = 0): unknown {
  if (isSensitiveKey(key)) return '[redacted]';
  if (depth >= MAX_REDACT_DEPTH || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive('', item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    result[childKey] = redactSensitive(childKey, childValue, depth + 1);
  }
  return result;
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
    const applicantPath = applicantFormLogPath(req);
    const [resource, resourceId] = applicantPath
      ? ['applicant-forms', null] as const
      : this.parseUrl(req.path);
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
    const applicantPath = applicantFormLogPath(req);
    const meta = applicantPath
      ? { payload: APPLICANT_FORM_LOG_OMITTED, route: applicantPath }
      : this.sanitizeMeta(req.body, ctx.resource) as Record<string, unknown>;
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
        `审计日志写入失败: ${req.method} ${applicantPath ?? req.path}`,
        applicantPath ? APPLICANT_FORM_LOG_OMITTED : error instanceof Error ? error.stack : String(error),
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

    // 凭据一律不落库。放在最前面：后面的分支只处理体积问题，漏一个键就是漏一份凭据。
    // 递归下探：只抹顶层的话，{ auth: { token } } 这类嵌套结构照样会把凭据写进去。
    for (const key of Object.keys(meta)) {
      meta[key] = redactSensitive(key, meta[key]);
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
