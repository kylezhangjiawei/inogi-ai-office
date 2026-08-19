-- 视频作品库分类：与 ImageCategory 同构的全局共享目录（最多 3 层树，同级不重名），
-- 视频与分类多对一。删除分类时子分类级联删除，视频的 categoryId 置空（转为未分类），视频本身保留。

CREATE TABLE "VideoCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoCategory_parentId_name_key" ON "VideoCategory"("parentId", "name");

CREATE INDEX "VideoCategory_parentId_sortOrder_idx" ON "VideoCategory"("parentId", "sortOrder");

CREATE INDEX "VideoCategory_sortOrder_createdAt_idx" ON "VideoCategory"("sortOrder", "createdAt");

ALTER TABLE "VideoCategory" ADD CONSTRAINT "VideoCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "VideoCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VideoGeneration" ADD COLUMN "categoryId" TEXT;

CREATE INDEX "VideoGeneration_userId_categoryId_createdAt_idx" ON "VideoGeneration"("userId", "categoryId", "createdAt");

ALTER TABLE "VideoGeneration" ADD CONSTRAINT "VideoGeneration_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "VideoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
