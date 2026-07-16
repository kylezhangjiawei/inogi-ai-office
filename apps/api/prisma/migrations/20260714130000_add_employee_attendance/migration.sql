CREATE TABLE "EmployeeAttendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "shiftName" TEXT NOT NULL DEFAULT '标准班',
    "scheduledStart" TEXT NOT NULL DEFAULT '09:00',
    "scheduledEnd" TEXT NOT NULL DEFAULT '18:00',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'missing',
    "workMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeAttendance_employeeId_attendanceDate_key"
ON "EmployeeAttendance"("employeeId", "attendanceDate");

CREATE INDEX "EmployeeAttendance_attendanceDate_status_idx"
ON "EmployeeAttendance"("attendanceDate", "status");

CREATE INDEX "EmployeeAttendance_employeeId_attendanceDate_idx"
ON "EmployeeAttendance"("employeeId", "attendanceDate");

ALTER TABLE "EmployeeAttendance"
ADD CONSTRAINT "EmployeeAttendance_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "EmployeeArchive"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- 保留原权限码，更新显示名称和访问地址，已授权角色无需重新配置。
UPDATE "PermissionCatalogItem"
SET "label" = '人员考勤',
    "description" = '每日打卡、考勤异常、补录修正与考勤导出',
    "routePath" = '/attendance',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'page:quick-capture';

UPDATE "Department"
SET "description" = REPLACE("description", '随手记任务分流', '人员考勤')
WHERE "description" LIKE '%随手记任务分流%';
