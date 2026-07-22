-- CreateTable
CREATE TABLE "ExternalDocument" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '未分类',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "currentVersionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'current',
    "allowSend" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT NOT NULL DEFAULT '',
    "extractedText" TEXT,
    "extractionProvider" TEXT,
    "ocrRequestId" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "extractionMetadata" JSONB NOT NULL DEFAULT '{}',
    "uploadedById" TEXT,
    "uploadedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDocumentComparison" (
    "id" TEXT NOT NULL,
    "jobCode" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "baselineVersionId" TEXT NOT NULL,
    "candidateVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'comparing',
    "summary" TEXT NOT NULL DEFAULT '',
    "differences" JSONB NOT NULL DEFAULT '[]',
    "aiModel" TEXT,
    "aiProvider" TEXT,
    "ocrProvider" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "confirmedById" TEXT,
    "confirmedByName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDocumentComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDocument_code_key" ON "ExternalDocument"("code");
CREATE UNIQUE INDEX "ExternalDocument_currentVersionId_key" ON "ExternalDocument"("currentVersionId");
CREATE INDEX "ExternalDocument_status_updatedAt_idx" ON "ExternalDocument"("status", "updatedAt");
CREATE INDEX "ExternalDocument_category_idx" ON "ExternalDocument"("category");
CREATE UNIQUE INDEX "ExternalDocumentVersion_objectKey_key" ON "ExternalDocumentVersion"("objectKey");
CREATE UNIQUE INDEX "ExternalDocumentVersion_documentId_version_key" ON "ExternalDocumentVersion"("documentId", "version");
CREATE INDEX "ExternalDocumentVersion_documentId_createdAt_idx" ON "ExternalDocumentVersion"("documentId", "createdAt");
CREATE INDEX "ExternalDocumentVersion_status_idx" ON "ExternalDocumentVersion"("status");
CREATE UNIQUE INDEX "ExternalDocumentComparison_jobCode_key" ON "ExternalDocumentComparison"("jobCode");
CREATE UNIQUE INDEX "ExternalDocumentComparison_candidateVersionId_key" ON "ExternalDocumentComparison"("candidateVersionId");
CREATE INDEX "ExternalDocumentComparison_documentId_createdAt_idx" ON "ExternalDocumentComparison"("documentId", "createdAt");
CREATE INDEX "ExternalDocumentComparison_status_createdAt_idx" ON "ExternalDocumentComparison"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ExternalDocumentVersion" ADD CONSTRAINT "ExternalDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ExternalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDocumentComparison" ADD CONSTRAINT "ExternalDocumentComparison_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ExternalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
