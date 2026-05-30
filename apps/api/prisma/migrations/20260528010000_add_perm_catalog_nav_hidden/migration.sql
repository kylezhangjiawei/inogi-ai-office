-- Add `navHidden` column to PermissionCatalogItem.
--
-- Background: the field was added to `schema.prisma` earlier but the
-- corresponding migration was never generated. As a result production
-- DBs (which only run `prisma migrate deploy`) are missing this column,
-- and every Prisma query against PermissionCatalogItem 500s with
--   ERROR: column "navHidden" does not exist
-- which is why `/permission-catalog/groups` and `/permission-catalog/items`
-- are the only endpoints failing in prod.
--
-- Safe to run on existing data: defaults to false (= not hidden).

ALTER TABLE "PermissionCatalogItem"
  ADD COLUMN IF NOT EXISTS "navHidden" BOOLEAN NOT NULL DEFAULT false;
