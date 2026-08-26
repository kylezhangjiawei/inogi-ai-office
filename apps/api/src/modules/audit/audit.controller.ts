import { Controller, Get, Query, Request } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

type AuthedRequest = { user?: { id?: string; name?: string; permissions?: string[] } };

/**
 * 全站统一操作留痕。研发 / 中美协同 / 采购三个留痕页合并到这里，
 * 页面权限收敛为单个 page:audit-log；能看多少由服务层按管理权限分层，不再各页各判。
 */
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  private viewer(req: AuthedRequest) {
    return {
      userId: req.user?.id,
      userName: req.user?.name,
      permissions: req.user?.permissions ?? [],
    };
  }

  @Get('logs')
  @Permissions('page:audit-log')
  listLogs(@Query() query: AuditLogQueryDto, @Request() req: AuthedRequest) {
    return this.auditService.listLogs(query, this.viewer(req));
  }

  /** 筛选器选项。与列表分开取：选项只跟可见范围和模块走，不该被其他筛选条件互相抹掉。 */
  @Get('facets')
  @Permissions('page:audit-log')
  listFacets(@Query('module') module: string | undefined, @Request() req: AuthedRequest) {
    return this.auditService.listFacets(this.viewer(req), module?.trim() || undefined);
  }
}
