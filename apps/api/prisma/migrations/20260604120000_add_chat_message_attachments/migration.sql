-- Add attachments JSON column to ChatMessage for MateChat image/file uploads.
-- Structure: [{ fileId, name, mime, size, objectKey }]
ALTER TABLE "ChatMessage"
ADD COLUMN "attachments" JSONB;
