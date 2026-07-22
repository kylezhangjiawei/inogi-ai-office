-- Persist the employee's actual regularization date so early regularization is
-- distinguishable from the expected date derived from hireDate.
ALTER TABLE "EmployeeArchive"
ADD COLUMN "regularizationDate" TIMESTAMP(3);

-- Preserve a reasonable date for records that were already explicitly marked
-- as regularized before this field existed. Employees that merely passed their
-- expected date remain unconfirmed and are intentionally not backfilled.
UPDATE "EmployeeArchive"
SET "regularizationDate" = "hireDate" + INTERVAL '3 months'
WHERE "regularizationDate" IS NULL
  AND "hireDate" IS NOT NULL
  AND "employmentStatus" ~ '已转正|正式员工';
