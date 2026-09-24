import { PrismaClient } from '@prisma/client';
import { isProd } from '../config/env.js';

/**
 * Single PrismaClient for the process (connection pooling handled by Prisma).
 * In dev, reuse across hot reloads to avoid exhausting connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;
