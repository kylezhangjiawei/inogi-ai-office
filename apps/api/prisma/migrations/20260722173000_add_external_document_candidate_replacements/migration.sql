ALTER TABLE "ExternalDocumentVersion"
ADD COLUMN "uploadRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "replacementHistory" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "fileUploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 已有版本沿用其首次建档时间，避免迁移时间被误记为原文件上传时间。
UPDATE "ExternalDocumentVersion" SET "fileUploadedAt" = "createdAt";
