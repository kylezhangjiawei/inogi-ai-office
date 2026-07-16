-- Separate the user's latest feedback submission time from management workflow updates.

ALTER TABLE "ChatFeedback"
  ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ChatFeedback"
SET "submittedAt" = "createdAt";

CREATE INDEX "ChatFeedback_submittedAt_idx" ON "ChatFeedback"("submittedAt");
