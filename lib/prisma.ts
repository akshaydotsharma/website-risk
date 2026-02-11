import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 30000, // 30s for Neon cold starts
    idleTimeoutMillis: 10000, // 10s - free connections faster
    max: 18, // Increased from 10 for better concurrency
    statement_timeout: 60000, // 60s statement timeout
    query_timeout: 60000, // 60s query timeout
    application_name: "website-risk-app",
  });
  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: ["error", "warn"],
    transactionOptions: {
      maxWait: 10000, // 10s max wait to start transaction
      timeout: 60000, // 60s transaction timeout (increased from 30s)
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
