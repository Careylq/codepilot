import { prisma } from "@/lib/db";
import { REPOS } from "@/lib/repos";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const groups = await prisma.chunk.groupBy({
    by: ["repo"],
    _count: { _all: true },
  });

  return Response.json(
    REPOS.map((repo) => ({
      repo,
      chunks: groups.find((g) => g.repo === repo)?._count._all ?? 0,
    })),
  );
}
