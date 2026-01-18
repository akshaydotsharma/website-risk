import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // Convert relative file path to absolute path
  let dbUrl = process.env.DATABASE_URL || "file:./prisma/dev.db";

  // Remove 'file:' prefix if present
  if (dbUrl.startsWith("file:")) {
    dbUrl = dbUrl.substring(5);
  }

  // Convert to absolute path
  const absolutePath = path.resolve(process.cwd(), dbUrl);

  // Create proper file:// URL
  const fileUrl = `file://${absolutePath}`;

  const adapter = new PrismaLibSql({
    url: fileUrl,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
