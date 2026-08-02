import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton to avoid exhausting connections
// on hot reload. Only instantiated when DATABASE_URL is set — importers
// that only need the mock catalog (src/lib/data/repository.ts) never
// touch this module.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
