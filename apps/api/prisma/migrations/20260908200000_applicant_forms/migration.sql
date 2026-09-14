-- CreateTable
CREATE TABLE "ApplicantFormTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "draftSchema" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedVersionId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantFormVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schema" JSONB NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicantFormVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantFormSession" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uploadBytes" INTEGER NOT NULL DEFAULT 0,
    "uploadCount" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicantFormSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantFormSubmission" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "answersHash" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "note" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantFormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicantFormUpload" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "objectKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicantFormUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantFormTemplate_slug_key" ON "ApplicantFormTemplate"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantFormTemplate_publishedVersionId_key" ON "ApplicantFormTemplate"("publishedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantFormVersion_templateId_version_key" ON "ApplicantFormVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "ApplicantFormSession_ipHash_createdAt_idx" ON "ApplicantFormSession"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicantFormSession_expiresAt_idx" ON "ApplicantFormSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantFormSubmission_sessionId_key" ON "ApplicantFormSubmission"("sessionId");

-- CreateIndex
CREATE INDEX "ApplicantFormSubmission_templateId_versionId_submittedAt_idx" ON "ApplicantFormSubmission"("templateId", "versionId", "submittedAt");

-- CreateIndex
CREATE INDEX "ApplicantFormSubmission_templateId_status_submittedAt_idx" ON "ApplicantFormSubmission"("templateId", "status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantFormSubmission_templateId_idempotencyKey_key" ON "ApplicantFormSubmission"("templateId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApplicantFormUpload_sessionId_status_idx" ON "ApplicantFormUpload"("sessionId", "status");

-- CreateIndex
CREATE INDEX "ApplicantFormUpload_createdAt_idx" ON "ApplicantFormUpload"("createdAt");

-- CreateIndex
CREATE INDEX "ApplicantFormUpload_submissionId_idx" ON "ApplicantFormUpload"("submissionId");

-- AddForeignKey
ALTER TABLE "ApplicantFormTemplate" ADD CONSTRAINT "ApplicantFormTemplate_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "ApplicantFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormVersion" ADD CONSTRAINT "ApplicantFormVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ApplicantFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormSession" ADD CONSTRAINT "ApplicantFormSession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ApplicantFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormSession" ADD CONSTRAINT "ApplicantFormSession_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ApplicantFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormSubmission" ADD CONSTRAINT "ApplicantFormSubmission_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ApplicantFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormSubmission" ADD CONSTRAINT "ApplicantFormSubmission_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ApplicantFormVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormSubmission" ADD CONSTRAINT "ApplicantFormSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ApplicantFormSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormUpload" ADD CONSTRAINT "ApplicantFormUpload_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ApplicantFormSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantFormUpload" ADD CONSTRAINT "ApplicantFormUpload_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ApplicantFormSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
