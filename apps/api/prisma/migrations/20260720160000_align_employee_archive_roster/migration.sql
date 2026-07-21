-- Align employee archive fields and completeness rules with the source roster workbook.
ALTER TABLE "EmployeeArchive"
ADD COLUMN "settlementDate" TIMESTAMP(3),
ADD COLUMN "employeeCode" TEXT NOT NULL DEFAULT '';

CREATE INDEX "EmployeeArchive_employeeCode_idx" ON "EmployeeArchive"("employeeCode");

-- Social-security fields are optional in the source workbook. Remove the former
-- false-positive gaps/alert, then surface the two newly restored required fields.
WITH "normalized" AS (
  SELECT
    "id",
    array_cat(
      ARRAY(
        SELECT "field"
        FROM unnest("missingFields") WITH ORDINALITY AS "gaps"("field", "position")
        WHERE "field" NOT IN ('星座', '社保号', '社保首月日期', '费用归属', '备注')
        ORDER BY "position"
      ),
      ARRAY[
        CASE WHEN "settlementDate" IS NULL THEN '结算日期' END,
        CASE WHEN btrim("employeeCode") = '' THEN '工号' END
      ]::TEXT[]
    ) AS "missingFields"
  FROM "EmployeeArchive"
)
UPDATE "EmployeeArchive" AS "employee"
SET
  "missingFields" = array_remove("normalized"."missingFields", NULL),
  "archiveScore" = ROUND(
    (31 - cardinality(array_remove("normalized"."missingFields", NULL)))::NUMERIC / 31 * 100
  )::INTEGER,
  "archiveStatus" = CASE
    WHEN cardinality(array_remove("normalized"."missingFields", NULL)) = 0 THEN 'complete'
    WHEN "employee"."employmentStatus" ~ '入职|待入职' THEN 'onboarding'
    WHEN "employee"."employmentStatus" ~ '试用' THEN 'review'
    ELSE 'missing'
  END,
  "alerts" = array_remove("employee"."alerts", '社保首月字段待确认')
FROM "normalized"
WHERE "employee"."id" = "normalized"."id";

UPDATE "EmployeeArchiveDocument"
SET
  "status" = 'review',
  "detail" = '选填字段，暂未维护'
WHERE "title" = '社保首月' AND "status" = 'missing';
