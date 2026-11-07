import { env } from './config.js';
import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';
import { startJobs, stopJobs } from './jobs/queue.js';
import { pool } from './db/pool.js';

const app = await buildApp();
try {
  await migrate((m) => app.log.info(m));
  await startJobs((m) => app.log.info(m));
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
} catch (e) {
  app.log.error(e);
  process.exit(1);
}
const shutdown = async () => { await app.close(); await stopJobs(); await pool.end(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
