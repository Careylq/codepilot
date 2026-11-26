export const REPOS = ["codepilot", "zustand"] as const;

export type Repo = (typeof REPOS)[number];

export function isRepo(value: unknown): value is Repo {
  return typeof value === "string" && (REPOS as readonly string[]).includes(value);
}

export function normalizeRepo(value: unknown): Repo {
  return isRepo(value) ? value : "codepilot";
}
