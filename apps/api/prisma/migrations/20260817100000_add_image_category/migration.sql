-- 图像作品库分类：全局共享目录（名称唯一），作品与分类多对一。
-- 分类被删除时把作品的 categoryId 置空（ON DELETE SET NULL），作品本身一律保留。

CREATE TABLE "ImageCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImageCategory_name_key" ON "ImageCategory"("name");

CREATE INDEX "ImageCategory_sortOrder_createdAt_idx" ON "ImageCategory"("sortOrder", "createdAt");

ALTER TABLE "GeneratedImage" ADD COLUMN "categoryId" TEXT;

CREATE INDEX "GeneratedImage_userId_categoryId_createdAt_idx" ON "GeneratedImage"("userId", "categoryId", "createdAt");

ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "ImageCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
