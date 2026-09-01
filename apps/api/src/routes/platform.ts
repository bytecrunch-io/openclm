import { randomBytes, randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  CreateIntegrationSchema,
  CreateWebhookSchema,
  PublicIntegrationSchema,
  type Agreement,
  type AgreementStatus,
} from "@bytecrunch/contracts-domain";
import { currentUser } from "../auth.js";
import { hashIntegrationSecret } from "../integration-oauth.js";
import { replayNotificationDelivery } from "../notifications.js";
import type { Repository } from "../repository.js";
import { assertWebhookUrlAllowed, replayWebhookDelivery } from "../webhooks.js";

type ConditionResult = {
  kind: "subject_signed" | "agreement_executed";
  templateKey: string;
  minimumVersion: number;
  met: boolean;
  status?: AgreementStatus;
  agreementId?: string;
  templateVersion?: number;
  signedAt?: string | null;
  executedAt?: string | null;
};
type PlatformRouteServices = {
  now: () => string;
  transition: (agreement: Agreement, status: AgreementStatus) => void;
  conditionByPerson: (
    agreements: Agreement[],
    personId: string,
    condition: {
      kind: "subject_signed" | "agreement_executed";
      templateKey: string;
      minimumVersion: number;
    },
  ) => ConditionResult;
};

export function registerPlatformRoutes(
  app: Hono,
  repository: Repository,
  services: PlatformRouteServices,
): void {
  app.get("/v1/notifications", async (context) => {
    const user = currentUser(context);
    const person = await repository.findPersonByEmail(
      user.tenantId,
      user.email,
    );
    const recipientIds = [
      ...new Set([user.id, ...(person ? [person.id] : [])]),
    ];
    const notifications = (
      await Promise.all(
        recipientIds.map((id) =>
          repository.listNotifications(user.tenantId, id),
        ),
      )
    ).flat();
    return context.json(
      [...new Map(notifications.map((item) => [item.id, item])).values()].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      ),
    );
  });

  app.post("/v1/notifications/:notificationId/read", async (context) => {
    const user = currentUser(context);
    const person = await repository.findPersonByEmail(
      user.tenantId,
      user.email,
    );
    const recipientIds = [
      ...new Set([user.id, ...(person ? [person.id] : [])]),
    ];
    const notifications = (
      await Promise.all(
        recipientIds.map((id) =>
          repository.listNotifications(user.tenantId, id),
        ),
      )
    ).flat();
    const notification = notifications.find(
      (item) => item.id === context.req.param("notificationId"),
    );
    if (!notification) throw new Error("Notification not found.");
    notification.readAt = services.now();
    await repository.saveNotification(notification);
    return context.json(notification);
  });

  app.post("/v1/notifications/read-all", async (context) => {
    const user = currentUser(context);
    const person = await repository.findPersonByEmail(
      user.tenantId,
      user.email,
    );
    const recipientIds = [
      ...new Set([user.id, ...(person ? [person.id] : [])]),
    ];
    const notifications = (
      await Promise.all(
        recipientIds.map((id) =>
          repository.listNotifications(user.tenantId, id),
        ),
      )
    ).flat();
    const unread = [
      ...new Map(notifications.map((item) => [item.id, item])).values(),
    ].filter((item) => !item.readAt);
    await Promise.all(
      unread.map(async (item) => {
        item.readAt = services.now();
        await repository.saveNotification(item);
      }),
    );
    return context.json({ updated: unread.length });
  });

  app.get("/v1/notification-deliveries", async (context) => {
    const requestedLimit = Number(context.req.query("limit") ?? "50");
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
      return context.json({ error: "invalid_query", message: "limit must be a positive integer." }, 400);
    return context.json(await repository.listNotificationDeliveries(currentUser(context).tenantId, Math.min(200, requestedLimit)));
  });

  app.post("/v1/notification-deliveries/:deliveryId/replay", async (context) => {
    const delivery = await replayNotificationDelivery(repository, currentUser(context).tenantId, context.req.param("deliveryId"));
    if (!delivery) return context.json({ error: "not_found", message: "Notification delivery not found." }, 404);
    return context.json(delivery);
  });

  app.get("/v1/integrations", async (context) =>
    context.json(
      (await repository.listIntegrations(currentUser(context).tenantId)).map((item) => PublicIntegrationSchema.parse(item)),
    ),
  );
  app.post("/v1/integrations", async (context) => {
    const input = CreateIntegrationSchema.parse(await context.req.json());
    const clientSecret = randomBytes(32).toString('base64url');
    const integration = await repository.createIntegration(currentUser(context).tenantId, {
      ...input,
      allowedOrigins: input.allowedOrigins ?? [],
      identityProviderKey: input.identityProviderKey ?? null,
      scopes: input.scopes ?? ['conditions:read', 'signing_sessions:write'],
      clientId: `bcint_${randomUUID()}`,
      clientSecretHash: hashIntegrationSecret(clientSecret),
    });
    return context.json({ integration: PublicIntegrationSchema.parse(integration), clientSecret }, 201);
  });

  app.post('/v1/integrations/:integrationKey/rotate-secret', async (context) => {
    const user = currentUser(context); const integration = await repository.findIntegration(user.tenantId, context.req.param('integrationKey'));
    if (!integration) return context.json({ error: 'not_found', message: 'Integration not found.' }, 404);
    const clientSecret = randomBytes(32).toString('base64url'); integration.clientId ??= `bcint_${randomUUID()}`; integration.clientSecretHash = hashIntegrationSecret(clientSecret); await repository.saveIntegration(integration);
    return context.json({ integration: PublicIntegrationSchema.parse(integration), clientSecret });
  });

  app.get("/v1/webhooks", async (context) =>
    context.json(await repository.listWebhooks(currentUser(context).tenantId)),
  );
  app.post("/v1/webhooks", async (context) => {
    const input = CreateWebhookSchema.parse(await context.req.json());
    await assertWebhookUrlAllowed(input.url);
    return context.json(
      await repository.createWebhook(
        currentUser(context).tenantId,
        input.url,
        input.events,
      ),
      201,
    );
  });

  app.get("/v1/webhook-deliveries", async (context) => {
    const requestedLimit = Number(context.req.query("limit") ?? "50");
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
      return context.json(
        {
          error: "invalid_query",
          message: "limit must be a positive integer.",
        },
        400,
      );
    const limit = Math.min(200, requestedLimit);
    return context.json(
      await repository.listWebhookDeliveries(
        currentUser(context).tenantId,
        limit,
      ),
    );
  });

  app.post("/v1/webhook-deliveries/:deliveryId/replay", async (context) => {
    const delivery = await replayWebhookDelivery(
      repository,
      currentUser(context).tenantId,
      context.req.param("deliveryId"),
    );
    if (!delivery)
      return context.json(
        { error: "not_found", message: "Webhook delivery not found." },
        404,
      );
    return context.json(delivery);
  });
}
