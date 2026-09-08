-- Persist identifiers only; page facts are read again with current permissions.
ALTER TABLE "ChatMessage" ADD COLUMN "pageContext" JSONB;
