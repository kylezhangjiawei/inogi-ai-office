CREATE TABLE "EmployeeAttendanceMonth" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "previousOvertimeBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previousMonthSickLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entitledSickLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidSickLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unpaidSickLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "invertedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recoveredHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signature" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeAttendanceMonth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeAttendanceMonth_employeeId_year_month_key"
ON "EmployeeAttendanceMonth"("employeeId", "year", "month");

CREATE INDEX "EmployeeAttendanceMonth_year_month_idx"
ON "EmployeeAttendanceMonth"("year", "month");

ALTER TABLE "EmployeeAttendanceMonth"
ADD CONSTRAINT "EmployeeAttendanceMonth_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "EmployeeArchive"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
