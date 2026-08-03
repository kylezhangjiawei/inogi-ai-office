-- AlterTable: 企业微信账号，考勤导入首次按姓名匹配成功后自动回填
ALTER TABLE "EmployeeArchive" ADD COLUMN     "wecomUserId" TEXT NOT NULL DEFAULT '';

-- AlterTable: 当日请假占多少天，1=整天 0.5=半天；历史数据默认 1 即原行为
ALTER TABLE "EmployeeAttendance" ADD COLUMN     "leaveDayFraction" DOUBLE PRECISION NOT NULL DEFAULT 1;
