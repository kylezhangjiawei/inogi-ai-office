-- Prisma String[] fields are non-nullable. Keep the hand-written initial migration
-- compatible with the schema for both existing and newly provisioned databases.
UPDATE "EmployeeArchive" SET "missingFields" = ARRAY[]::TEXT[] WHERE "missingFields" IS NULL;
UPDATE "EmployeeArchive" SET "alerts" = ARRAY[]::TEXT[] WHERE "alerts" IS NULL;

ALTER TABLE "EmployeeArchive" ALTER COLUMN "missingFields" SET NOT NULL;
ALTER TABLE "EmployeeArchive" ALTER COLUMN "alerts" SET NOT NULL;
