-- CreateTable
CREATE TABLE "RdTaskDiscussionParticipant" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT,
    "invitedByName" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RdTaskDiscussionParticipant_pkey" PRIMARY KEY ("threadId","userId")
);

-- CreateIndex
CREATE INDEX "RdTaskDiscussionParticipant_userId_revokedAt_invitedAt_idx"
ON "RdTaskDiscussionParticipant"("userId", "revokedAt", "invitedAt");

-- AddForeignKey
ALTER TABLE "RdTaskDiscussionParticipant"
ADD CONSTRAINT "RdTaskDiscussionParticipant_threadId_fkey"
FOREIGN KEY ("threadId") REFERENCES "RdTaskDiscussionThread"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
