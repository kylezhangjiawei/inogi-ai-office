import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();

    if (!WRITE_METHODS.has(req.method)) return next.handle();

    const userId = req.user?.id ?? null;
    const [resource, resourceId] = this.parseUrl(req.path);
    const ip = req.ip ?? null;

    return next.handle().pipe(
      tap(() => {
        void this.prisma.auditLog.create({
          data: {
            userId,
            action: req.method,
            resource,
            resourceId,
            meta: this.sanitizeMeta(req.body, resource),
            ip,
          },
        });
      }),
    );
  }

  private parseUrl(path: string): [string, string | null] {
    const parts = path.replace(/^\/api\//, '').split('/');
    const resource = parts[0] ?? path;
    const resourceId = parts[1] && !/^\d+$/.test(parts[1]) === false ? parts[1] : (parts[1] ?? null);
    return [resource, resourceId];
  }

  private sanitizeMeta(body: unknown, resource: string): Prisma.InputJsonValue {
    if (!body || typeof body !== 'object') return {};

    const meta = { ...(body as Record<string, unknown>) };
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
