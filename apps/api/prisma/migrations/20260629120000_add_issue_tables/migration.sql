-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "product" TEXT,
    "batch" TEXT,
    "station" TEXT,
    "severity" TEXT NOT NULL,
    "defectRate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adopted" JSONB,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolution" JSONB,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAnalysis" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "basedOnVersion" INTEGER,
    "createdBy" TEXT NOT NULL,
    "isAdopted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueMessage" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "author" JSONB,
    "operator" TEXT,
    "attachments" JSONB,
    "analysisVersionId" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Issue_status_idx" ON "Issue"("status");

-- CreateIndex
CREATE INDEX "Issue_source_idx" ON "Issue"("source");

-- CreateIndex
CREATE INDEX "Issue_product_idx" ON "Issue"("product");

-- CreateIndex
CREATE INDEX "Issue_createdById_idx" ON "Issue"("createdById");

-- CreateIndex
CREATE INDEX "IssueAnalysis_issueId_idx" ON "IssueAnalysis"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueAnalysis_issueId_version_key" ON "IssueAnalysis"("issueId", "version");

-- CreateIndex
CREATE INDEX "IssueMessage_issueId_idx" ON "IssueMessage"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "IssueMessage_issueId_seq_key" ON "IssueMessage"("issueId", "seq");

-- AddForeignKey
ALTER TABLE "IssueAnalysis" ADD CONSTRAINT "IssueAnalysis_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueMessage" ADD CONSTRAINT "IssueMessage_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

