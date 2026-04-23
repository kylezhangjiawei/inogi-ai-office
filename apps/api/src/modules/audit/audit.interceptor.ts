import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';

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
            meta: (req.body as object) ?? {},
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
}
