-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "revisedPrompt" TEXT NOT NULL DEFAULT '',
    "style" TEXT NOT NULL DEFAULT 'vivid',
    "size" TEXT NOT NULL DEFAULT '1024x1024',
    "quality" TEXT NOT NULL DEFAULT 'standard',
    "imageData" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'dall-e-3',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
