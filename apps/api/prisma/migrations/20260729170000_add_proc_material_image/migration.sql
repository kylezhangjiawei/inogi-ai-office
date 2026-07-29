-- 商品/物料主图，可选；仅保存 OSS 对象 key，读取时动态签名
ALTER TABLE "ProcMaterial"
ADD COLUMN "imageKey" VARCHAR(500);
