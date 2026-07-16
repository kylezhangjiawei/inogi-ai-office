-- CreateTable
CREATE TABLE "EmployeeArchive" (
    "id" TEXT NOT NULL,
    "rosterNo" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "hireDate" TIMESTAMP(3),
    "tenure" TEXT NOT NULL DEFAULT '',
    "employmentStatus" TEXT NOT NULL DEFAULT '',
    "workLocation" TEXT NOT NULL DEFAULT '',
    "department" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "idNoMasked" TEXT NOT NULL DEFAULT '',
    "birthDate" TIMESTAMP(3),
    "birthMonthDay" TEXT NOT NULL DEFAULT '',
    "zodiac" TEXT NOT NULL DEFAULT '',
    "constellation" TEXT NOT NULL DEFAULT '',
    "gender" TEXT NOT NULL DEFAULT '',
    "age" INTEGER NOT NULL DEFAULT 0,
    "ethnicity" TEXT NOT NULL DEFAULT '',
    "maritalStatus" TEXT NOT NULL DEFAULT '',
    "phoneMasked" TEXT NOT NULL DEFAULT '',
    "bankAccountMasked" TEXT NOT NULL DEFAULT '',
    "bankBranch" TEXT NOT NULL DEFAULT '',
    "education" TEXT NOT NULL DEFAULT '',
    "school" TEXT NOT NULL DEFAULT '',
    "major" TEXT NOT NULL DEFAULT '',
    "hometown" TEXT NOT NULL DEFAULT '',
    "registeredAddress" TEXT NOT NULL DEFAULT '',
    "currentAddress" TEXT NOT NULL DEFAULT '',
    "emergencyContact" TEXT NOT NULL DEFAULT '',
    "emergencyRelation" TEXT NOT NULL DEFAULT '',
    "emergencyPhoneMasked" TEXT NOT NULL DEFAULT '',
    "socialSecurityNo" TEXT NOT NULL DEFAULT '',
    "socialSecurityFirstMonth" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "costCenter" TEXT NOT NULL DEFAULT '',
    "archiveStatus" TEXT NOT NULL DEFAULT 'onboarding',
    "archiveScore" INTEGER NOT NULL DEFAULT 0,
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alerts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "badgeConfig" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeArchive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeArchiveDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'review',
    "detail" TEXT NOT NULL DEFAULT '',
    "documentDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeArchiveDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeArchive_rosterNo_key" ON "EmployeeArchive"("rosterNo");
CREATE INDEX "EmployeeArchive_company_idx" ON "EmployeeArchive"("company");
CREATE INDEX "EmployeeArchive_department_idx" ON "EmployeeArchive"("department");
CREATE INDEX "EmployeeArchive_employmentStatus_idx" ON "EmployeeArchive"("employmentStatus");
CREATE INDEX "EmployeeArchive_archiveStatus_idx" ON "EmployeeArchive"("archiveStatus");
CREATE INDEX "EmployeeArchive_hireDate_idx" ON "EmployeeArchive"("hireDate");
CREATE INDEX "EmployeeArchiveDocument_employeeId_sortOrder_idx" ON "EmployeeArchiveDocument"("employeeId", "sortOrder");

-- AddForeignKey
ALTER TABLE "EmployeeArchiveDocument" ADD CONSTRAINT "EmployeeArchiveDocument_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "EmployeeArchive"("id") ON DELETE CASCADE ON UPDATE CASCADE;
