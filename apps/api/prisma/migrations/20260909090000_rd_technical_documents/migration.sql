CREATE TABLE "RdTechnicalDocument" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RdTechnicalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RdTechnicalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "previousVersionId" TEXT,
    "attachmentId" TEXT NOT NULL,
    "sourceNoteId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileKey" TEXT,
    "fileUrl" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RdTechnicalDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RdTechnicalDocument_currentVersionId_key" ON "RdTechnicalDocument"("currentVersionId");
CREATE INDEX "RdTechnicalDocument_taskId_updatedAt_idx" ON "RdTechnicalDocument"("taskId", "updatedAt");
CREATE UNIQUE INDEX "RdTechnicalDocumentVersion_requestId_key" ON "RdTechnicalDocumentVersion"("requestId");
CREATE UNIQUE INDEX "RdTechnicalDocumentVersion_documentId_version_key" ON "RdTechnicalDocumentVersion"("documentId", "version");
CREATE INDEX "RdTechnicalDocumentVersion_documentId_createdAt_idx" ON "RdTechnicalDocumentVersion"("documentId", "createdAt");
CREATE INDEX "RdTechnicalDocumentVersion_fileKey_idx" ON "RdTechnicalDocumentVersion"("fileKey");
ALTER TABLE "RdTechnicalDocumentVersion" ADD CONSTRAINT "RdTechnicalDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "RdTechnicalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
