import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

type AuthenticatedRequest = Request & {
  user?: { id: string };
};

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'secret',
  'plain_secret',
  'encrypted_secret',
]);

@Injectable()
export class ApiRequestLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();
    const startedAt = Date.now();
    const requestId = this.resolveRequestId(req);

    res.setHeader('x-request-id', requestId);

    return next.handle().pipe(
      tap(() => {
        this.record(req, requestId, res.statusCode, Date.now() - startedAt);
      }),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : 500;
        this.record(req, requestId, statusCode, Date.now() - startedAt, error);
        return throwError(() => error);
      }),
    );
  }

  private resolveRequestId(req: Request) {
    const incoming = req.header('x-request-id')?.trim();
    return incoming || randomUUID();
  }

  private record(
    req: AuthenticatedRequest,
    requestId: string,
    statusCode: number,
    durationMs: number,
    error?: unknown,
  ) {
    const errorInfo = this.getErrorInfo(error);
    const path = req.originalUrl?.replace(/^\/api/, '') || req.path || req.url || '';

    void this.prisma.apiRequestLog
      .create({
        data: {
          requestId,
          userId: req.user?.id ?? null,
          method: req.method,
          path,
          statusCode,
          durationMs,
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
          errorName: errorInfo.name,
          errorMessage: errorInfo.message,
          errorStack: errorInfo.stack,
          requestMeta: {
            query: this.sanitize(req.query),
            body: this.sanitize(req.body),
          } as Prisma.InputJsonValue,
          responseMeta: {
            statusCode,
            durationMs,
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        // Request logging must never block or break the user request.
      });
  }

  private getErrorInfo(error?: unknown) {
    if (!error) {
      return { name: null, message: null, stack: null };
    }

    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack?.slice(0, 4000) ?? null,
      };
    }

    return {
      name: 'UnknownError',
      message: typeof error === 'string' ? error : JSON.stringify(error),
      stack: null,
    };
  }

  private sanitize(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value ?? {};
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => this.sanitize(item));

    const result: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(normalizedKey) || [...SENSITIVE_KEYS].some((sensitive) => normalizedKey.includes(sensitive))) {
        result[key] = '[redacted]';
      } else if (typeof rawValue === 'string' && rawValue.length > 500) {
        result[key] = `${rawValue.slice(0, 500)}...[truncated ${rawValue.length} chars]`;
      } else {
        result[key] = this.sanitize(rawValue);
      }
    }
    return result;
  }
}
