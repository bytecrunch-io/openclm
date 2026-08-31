import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { ConfigurePluginInstallationSchema, PluginInstallationSchema, PluginKeySchema } from '@bytecrunch/contracts-domain';
import { currentUser } from '../auth.js';
import { configurePlugin, pluginCatalog, publicInstallation, testPluginInstallation } from '../integration-plugins.js';
import type { Repository } from '../repository.js';

export function registerPluginRoutes(app: Hono, repository: Repository): void {
  app.get('/v1/plugin-catalog', (context) => context.json(pluginCatalog));
  app.get('/v1/plugin-installations', async (context) => context.json((await repository.listPluginInstallations(currentUser(context).tenantId)).map(publicInstallation)));
  app.put('/v1/plugin-installations/:pluginKey', async (context) => {
    const pluginKey = PluginKeySchema.parse(context.req.param('pluginKey')); const input = ConfigurePluginInstallationSchema.parse(await context.req.json());
    return context.json(await configurePlugin(repository, currentUser(context).tenantId, pluginKey, input.configuration, input.enabled));
  });
  app.post('/v1/plugin-installations/:pluginKey/test', async (context) => {
    const pluginKey = PluginKeySchema.parse(context.req.param('pluginKey')); const installation = await repository.findPluginInstallation(currentUser(context).tenantId, pluginKey);
    if (!installation) return context.json({ error: 'not_found', message: 'Plugin installation not found.' }, 404);
    return context.json(await testPluginInstallation(repository, installation));
  });
  app.delete('/v1/plugin-installations/:pluginKey', async (context) => {
    const pluginKey = PluginKeySchema.parse(context.req.param('pluginKey')); await repository.deletePluginInstallation(currentUser(context).tenantId, pluginKey);
    return context.json({ removed: true, operationId: `plugin_remove_${randomUUID()}` });
  });
}
