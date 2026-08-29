import { serve } from '@hono/node-server';
import { createApp, migrateTenantAgreements } from './app.js';
import { config } from './config.js';
import { MemoryRepository, PostgresRepository } from './repository.js';
import { startNotificationWorker } from './notifications.js';

const repository = config.DATABASE_URL ? new PostgresRepository(config.DATABASE_URL) : new MemoryRepository();
await repository.init();
const migratedAgreements = await migrateTenantAgreements(repository, 'bytecrunch');
if (migratedAgreements) console.log(`Migrated ${migratedAgreements} agreement${migratedAgreements === 1 ? '' : 's'} to resolved party variables.`);
startNotificationWorker(repository);

serve({ fetch: createApp(repository).fetch, port: config.PORT }, (info) => {
  console.log(`Bytecrunch Contracts API listening on http://localhost:${info.port} (${repository.kind} storage)`);
});
