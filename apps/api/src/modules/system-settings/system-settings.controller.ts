import { Body, Controller, Get, Post } from '@nestjs/common';

import { SaveSystemSettingDto } from './dto/save-system-setting.dto';
import { SystemSettingsService } from './system-settings.service';

@Controller('settings')
export class SystemSettingsController {
  constructor(private readonly systemSettingsService: SystemSettingsService) {}

  @Get()
  list() {
    return this.systemSettingsService.list();
  }

  @Post()
  save(@Body() payload: SaveSystemSettingDto) {
    return this.systemSettingsService.save(payload);
  }
}
