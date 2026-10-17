import { getConfig } from '../packages/config/src/index.js';

console.log('[Scripts] Validating environment configuration...');
try {
  const config = getConfig();
  console.log('[Scripts] Configuration is valid:');
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - API Port: ${config.port}`);
  console.log(`  - App URL: ${config.appUrl}`);
  console.log(`  - Database Host: ${new URL(config.database.url).host}`);
  console.log(`  - Redis Host: ${new URL(config.redis.url).host}`);
  console.log(`  - AI Service URL: ${config.aiService.url}`);
  console.log('[Scripts] Environment validation passed successfully.');
  process.exit(0);
} catch (error) {
  console.error('[Scripts] Environment validation failed:');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
