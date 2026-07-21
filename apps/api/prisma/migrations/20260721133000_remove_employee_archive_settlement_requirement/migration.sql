-- Settlement date is no longer part of employee archive completeness.
-- Keep the nullable column for backward compatibility, but remove historical
-- gaps and recalculate the score against the remaining 30 required fields.
WITH "normalized" AS (
  SELECT
    "id",
    ARRAY(
      SELECT "field"
      FROM unnest("missingFields") WITH ORDINALITY AS "gaps"("field", "position")
      WHERE "field" <> '结算日期'
      ORDER BY "position"
    ) AS "missingFields"
  FROM "EmployeeArchive"
)
UPDATE "EmployeeArchive" AS "employee"
SET
  "missingFields" = "normalized"."missingFields",
  "archiveScore" = ROUND(
    (30 - cardinality("normalized"."missingFields"))::NUMERIC / 30 * 100
  )::INTEGER,
  "archiveStatus" = CASE
    WHEN cardinality("normalized"."missingFields") = 0 THEN 'complete'
    WHEN "employee"."employmentStatus" ~ '入职|待入职' THEN 'onboarding'
    WHEN "employee"."employmentStatus" ~ '试用' THEN 'review'
    ELSE 'missing'
  END
FROM "normalized"
WHERE "employee"."id" = "normalized"."id";
