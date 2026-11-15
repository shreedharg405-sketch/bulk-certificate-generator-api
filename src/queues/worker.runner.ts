import { queueManager } from './queue.service.js';
import { getDatabase } from '../db/index.js';
import { certificateRendererService } from '../services/renderer.service.js';

async function runWorker() {
  console.log('[Worker Runner] Initializing SQLite database and schema...');
  getDatabase();

  console.log('[Worker Runner] Initializing background queue worker...');
  await queueManager.startWorker();

  console.log('[Worker Runner] Worker running successfully. Press Ctrl+C to terminate.');

  const shutdown = async () => {
    console.log('[Worker Runner] Gracefully shutting down worker...');
    await queueManager.close();
    await certificateRendererService.closeBrowser();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

runWorker().catch((err) => {
  console.error('[Worker Runner] Fatal error:', err);
  process.exit(1);
});
