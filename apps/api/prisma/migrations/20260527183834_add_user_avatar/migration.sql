-- Add avatar object key to User table.
-- Stores OSS path; signed URL is generated on each getCurrentUser call.
ALTER TABLE "User"
ADD COLUMN "avatarObjectKey" VARCHAR(500);
