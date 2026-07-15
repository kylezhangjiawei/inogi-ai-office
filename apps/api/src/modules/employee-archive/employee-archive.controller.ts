import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import {
  BulkImportEmployeeArchivesDto,
  ListEmployeeArchivesQueryDto,
  ListProbationRemindersQueryDto,
  SaveEmployeeBadgeConfigDto,
  SaveEmployeeArchiveDto,
} from './dto/employee-archive.dto';
import { EmployeeArchiveService } from './employee-archive.service';

type AuthedRequest = { user: { id: string } };

@Controller('employee-archives')
@Permissions('page:employee-archive')
export class EmployeeArchiveController {
  constructor(private readonly employeeArchiveService: EmployeeArchiveService) {}

  @Get()
  list(@Query() query: ListEmployeeArchivesQueryDto) {
    return this.employeeArchiveService.list(query);
  }

  @Get('stats')
  stats() {
    return this.employeeArchiveService.stats();
  }

  @Get('probation-reminders')
  probationReminders(@Query() query: ListProbationRemindersQueryDto) {
    return this.employeeArchiveService.probationReminders(query.days ?? 31);
  }

  @Post('import')
  importRoster(@Body() dto: BulkImportEmployeeArchivesDto, @Request() req: AuthedRequest) {
    return this.employeeArchiveService.bulkImport(dto, req.user.id);
  }

  @Post()
  create(@Body() dto: SaveEmployeeArchiveDto, @Request() req: AuthedRequest) {
    return this.employeeArchiveService.create(dto, req.user.id);
  }

  @Get(':id/badge-config')
  getBadgeConfig(@Param('id') id: string) {
    return this.employeeArchiveService.getBadgeConfig(id);
  }

  @Put(':id/badge-config')
  saveBadgeConfig(
    @Param('id') id: string,
    @Body() dto: SaveEmployeeBadgeConfigDto,
    @Request() req: AuthedRequest,
  ) {
    return this.employeeArchiveService.saveBadgeConfig(id, dto, req.user.id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.employeeArchiveService.get(id);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: SaveEmployeeArchiveDto,
    @Request() req: AuthedRequest,
  ) {
    return this.employeeArchiveService.update(id, dto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.employeeArchiveService.remove(id);
  }
}
