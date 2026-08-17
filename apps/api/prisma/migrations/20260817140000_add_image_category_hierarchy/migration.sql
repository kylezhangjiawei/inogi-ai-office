-- 图像作品库分类升级为最多 3 层的树：新增 parentId 自引用，删除父分类时级联删除子分类
-- （作品仍由 GeneratedImage_categoryId_fkey 的 SET NULL 保留，只是转为未分类）。
-- 全局 name 唯一改为「同级不重名」：Postgres 里 NULL 互不相等，根分类的重名由服务层兜住。

ALTER TABLE "ImageCategory" ADD COLUMN "parentId" TEXT;

DROP INDEX "ImageCategory_name_key";

CREATE UNIQUE INDEX "ImageCategory_parentId_name_key" ON "ImageCategory"("parentId", "name");

CREATE INDEX "ImageCategory_parentId_sortOrder_idx" ON "ImageCategory"("parentId", "sortOrder");

ALTER TABLE "ImageCategory" ADD CONSTRAINT "ImageCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ImageCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
