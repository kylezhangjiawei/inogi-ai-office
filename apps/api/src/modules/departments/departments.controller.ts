import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { DepartmentsService } from './departments.service';
import { SaveDepartmentDto } from './dto/save-department.dto';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @Permissions('page:departments')
  list() {
    return this.departmentsService.list();
  }

  @Get('options')
  @Permissions('page:users', 'page:departments', 'page:rd-people-management', 'rd-people:manage')
  options() {
    return this.departmentsService.options();
  }

  @Post()
  @Permissions('department:create', 'department:edit', 'rd-people:manage')
  save(@Body() payload: SaveDepartmentDto) {
    return this.departmentsService.save(payload);
  }

  @Patch(':id/status')
  @Permissions('department:edit', 'rd-people:manage')
  updateStatus(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.departmentsService.updateStatus(id, body.enabled);
  }

  @Delete(':id')
  @Permissions('department:delete', 'rd-people:manage')
  remove(@Param('id') id: string) {
    return this.departmentsService.remove(id);
  }
}
