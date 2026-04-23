import { Body, Controller, Get, Post } from '@nestjs/common';

import { SaveUserDto } from './dto/save-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list() {
    return this.usersService.list();
  }

  @Post()
  save(@Body() payload: SaveUserDto) {
    return this.usersService.save(payload);
  }
}
