import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseInterceptors } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { RD_TASK_MANAGEMENT_PERMISSIONS } from './rd-task-access';
import { RdWorkspaceInterceptor } from './rd-workspace.context';
import { RdMeetingTodosService } from './rd-meeting-todos.service';

type AuthedRequest = { user?: { id?: string; name?: string; permissions?: string[] } };
const actor = (req: AuthedRequest) => ({ userId: req.user?.id, userName: req.user?.name, permissions: req.user?.permissions ?? [] });

@Controller('research-development/meeting-todos')
@Permissions(...RD_TASK_MANAGEMENT_PERMISSIONS)
@UseInterceptors(RdWorkspaceInterceptor)
export class RdMeetingTodosController {
  constructor(private readonly todos: RdMeetingTodosService) {}

  @Get('members') members(@Request() req: AuthedRequest) { return this.todos.members(actor(req)); }
  @Get('weeks') weeks(@Request() req: AuthedRequest, @Query('before') before?: string) { return this.todos.listWeeks(actor(req), before); }
  @Post('weeks') create(@Body() body: unknown, @Request() req: AuthedRequest) { return this.todos.createWeek(body, actor(req)); }
  @Get('weeks/:week') async read(@Param('week') week: string, @Request() req: AuthedRequest) { return { week: await this.todos.getWeek(week, actor(req)) }; }
  @Post('weeks/:week/items') add(@Param('week') week: string, @Body() body: unknown, @Request() req: AuthedRequest) { return this.todos.addItem(week, body, actor(req)); }
  @Patch('weeks/:week/items/:id') edit(@Param('week') week: string, @Param('id') id: string, @Body() body: unknown, @Request() req: AuthedRequest) { return this.todos.updateItem(week, id, body, actor(req)); }
  @Delete('weeks/:week/items/:id') remove(@Param('week') week: string, @Param('id') id: string, @Body() body: unknown, @Request() req: AuthedRequest) { return this.todos.deleteItem(week, id, body, actor(req)); }
}
