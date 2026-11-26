import { config } from "dotenv";

// 优先加载 .env.local（Next.js 的约定），再回退到 .env
config({ path: ".env.local" });
config();

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
