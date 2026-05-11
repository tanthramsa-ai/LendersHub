import { Global, Module } from '@nestjs/common';

/**
 * Provides the RLS context singleton (AsyncLocalStorage) used by PrismaService.
 * Marked global so every module can import it without re-exporting.
 * The actual enforcement happens inside PrismaService's $extends hook.
 */
@Global()
@Module({})
export class RlsModule {}
