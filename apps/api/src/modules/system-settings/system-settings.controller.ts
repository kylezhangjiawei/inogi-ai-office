import { Body, Controller, Get, Post } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { SaveSystemSettingDto } from './dto/save-system-setting.dto';
import { SystemSettingsService } from './system-settings.service';

/**
 * 系统设置原始 KV 读写。
 *
 * ⚠️ 这两个端点直通 systemSetting 表：list() 返回**全部行**、save() 按 key upsert**任意行**。
 * 而 systemSetting 正是研发/协同两池的存储底座（rd.* 与 rdws.us-collab.*，见
 * rd-workspace.context.ts）。此前二者都没有 @Permissions，而 RolesGuard 的规则是
 * 「无声明即放行」——任何能登录的人都能绕开工作区改写、页面码定池、DeptKbGuard，
 * 一次读走研发全部任务树/审批流/AI 策略/留痕，或覆写任意存储键。
 * 实测：仅持 page:us-collab-cockpit 的协同成员 GET 拿到 106 行、含 34 个 rd./rdws. 键。
 *
 * 因此收敛到 page:settings（字典列表页的页面码，本就是这两个端点的归属页面）。
 * 前端当前无任何调用点，收紧无功能影响。
 */
@Controller('settings')
@Permissions('page:settings')
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
