import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request } from '@nestjs/common';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { AttendanceService } from './attendance.service';
import {
  AttendanceDailyQueryDto,
  AttendanceEmployeeDetailQueryDto,
  AttendanceMonthlyQueryDto,
  ClockAttendanceDto,
  SaveAttendanceMonthDto,
  SaveAttendanceRecordDto,
} from './dto/attendance.dto';

type AuthedRequest = { user: { id: string } };

@Controller('attendance')
@Permissions('page:quick-capture')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('daily')
  daily(@Query() query: AttendanceDailyQueryDto) {
    return this.attendanceService.daily(query);
  }

  @Get('monthly')
  monthly(@Query() query: AttendanceMonthlyQueryDto) {
    return this.attendanceService.monthly(query);
  }

  @Get('overtime')
  overtime(@Query() query: AttendanceMonthlyQueryDto) {
    return this.attendanceService.overtime(query);
  }

  @Get('employee/:employeeId')
  employeeDetail(
    @Param('employeeId') employeeId: string,
    @Query() query: AttendanceEmployeeDetailQueryDto,
  ) {
    return this.attendanceService.employeeDetail(employeeId, query);
  }

  @Put('record')
  save(@Body() dto: SaveAttendanceRecordDto, @Request() req: AuthedRequest) {
    return this.attendanceService.save(dto, req.user.id);
  }

  @Put('month')
  saveMonth(@Body() dto: SaveAttendanceMonthDto, @Request() req: AuthedRequest) {
    return this.attendanceService.saveMonth(dto, req.user.id);
  }

  @Post('clock')
  clock(@Body() dto: ClockAttendanceDto, @Request() req: AuthedRequest) {
    return this.attendanceService.clock(dto, req.user.id);
  }

  @Delete('record/:id')
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }
}
