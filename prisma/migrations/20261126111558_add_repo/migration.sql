-- AlterTable
ALTER TABLE "Chunk" ADD COLUMN     "repo" TEXT NOT NULL DEFAULT 'codepilot';

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "repo" TEXT NOT NULL DEFAULT 'codepilot';

-- CreateIndex
CREATE INDEX "Chunk_repo_path_idx" ON "Chunk"("repo", "path");
