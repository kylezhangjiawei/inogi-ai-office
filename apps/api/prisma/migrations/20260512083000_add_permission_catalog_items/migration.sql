CREATE TABLE "PermissionCatalogItem" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "groupLabel" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'page',
  "routePath" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PermissionCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionCatalogItem_code_key" ON "PermissionCatalogItem"("code");
CREATE INDEX "PermissionCatalogItem_groupLabel_sortOrder_idx" ON "PermissionCatalogItem"("groupLabel", "sortOrder");
CREATE INDEX "PermissionCatalogItem_type_enabled_idx" ON "PermissionCatalogItem"("type", "enabled");
