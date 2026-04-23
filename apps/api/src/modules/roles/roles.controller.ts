import { Body, Controller, Get, Post } from '@nestjs/common';

import { SaveRoleDto } from './dto/save-role.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  list() {
    return this.rolesService.list();
  }

  @Post()
  save(@Body() payload: SaveRoleDto) {
    return this.rolesService.save(payload);
  }
}
