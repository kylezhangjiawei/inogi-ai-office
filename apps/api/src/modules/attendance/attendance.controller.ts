import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Permissions } from '../auth/decorators/permissions.decorator';
import { AttendanceImportService } from './attendance-import.service';
import { AttendanceService } from './attendance.service';
import {
  AttendanceDailyQueryDto,
  AttendanceEmployeeDetailQueryDto,
  AttendanceMonthlyQueryDto,
  ClockAttendanceDto,
  ConfirmAttendanceImportDto,
  SaveAttendanceMonthDto,
  SaveAttendanceRecordDto,
} from './dto/attendance.dto';

type AuthedRequest = { user: { id: string } };
type UploadedExcel = { originalname?: string; buffer?: Buffer } | undefined;

@Controller('attendance')
@Permissions('page:quick-capture')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly attendanceImportService: AttendanceImportService,
  ) {}

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

  /** 企业微信打卡日报预览：只解析与比对，不写库。 */
  @Post('import/preview')
  @Permissions('attendance:import')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(@UploadedFile() file: UploadedExcel) {
    return this.attendanceImportService.preview(file);
  }

  /** 导入确认：文件随勾选的员工一并重传，服务端重新解析后写库。 */
  @Post('import/confirm')
  @Permissions('attendance:import')
  @UseInterceptors(FileInterceptor('file'))
  confirmImport(
    @UploadedFile() file: UploadedExcel,
    @Body() dto: ConfirmAttendanceImportDto,
    @Request() req: AuthedRequest,
  ) {
    return this.attendanceImportService.confirm(file, dto.employeeIds, req.user.id);
  }
}
