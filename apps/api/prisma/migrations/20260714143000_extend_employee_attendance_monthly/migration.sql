ALTER TABLE "EmployeeAttendance"
ADD COLUMN "deductionMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "overtimeType" TEXT NOT NULL DEFAULT '';

ALTER TABLE "EmployeeAttendance"
ALTER COLUMN "scheduledStart" SET DEFAULT '08:00';
