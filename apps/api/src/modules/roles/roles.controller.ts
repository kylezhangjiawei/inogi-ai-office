import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { SaveRoleDto } from './dto/save-role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Permissions('page:roles')
  list() {
    return this.rolesService.list();
  }

  @Get('options')
  @Permissions('user:create', 'user:edit', 'page:roles', 'page:users')
  listOptions() {
    return this.rolesService.listOptions();
  }

  @Get(':id')
  @Permissions('page:roles')
  findOne(@Param('id') id: string) {
    return this.rolesService.findById(id);
  }

  @Post()
  @Permissions('role:create', 'role:edit')
  save(@Body() payload: SaveRoleDto) {
    return this.rolesService.save(payload);
  }

  @Delete(':id')
  @Permissions('role:delete')
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }
}
