-- KnowledgeChunk table
-- 注：不使用 pgvector 扩展，embedding 用 Postgres 原生 double precision[] 存储，
--     由 Node.js 在查询时计算余弦相似度。适合 ≤10k chunks 的规模。
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "embeddingModel" TEXT NOT NULL DEFAULT 'text-embedding-v3',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "KnowledgeChunk_sourceType_sourceId_chunkIndex_key"
    ON "KnowledgeChunk"("sourceType", "sourceId", "chunkIndex");

CREATE INDEX "KnowledgeChunk_sourceType_sourceId_idx"
    ON "KnowledgeChunk"("sourceType", "sourceId");

CREATE INDEX "KnowledgeChunk_archived_idx"
    ON "KnowledgeChunk"("archived");
