import { config } from "dotenv";

// 必须先于 lib/db.ts 求值，否则 PrismaClient 会读到 .env 里的 SQLite URL
config({ path: ".env.local" });
config();
