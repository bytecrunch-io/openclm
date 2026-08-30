import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  CreateIntegrationSchema,
  CreateIntegrationSessionSchema,
  CreateWebhookSchema,
  EvaluateConditionsSchema,
  IdentityLinkSchema,
  IntegrationSessionSchema,
  type Agreement,
  type AgreementStatus,
} from "@bytecrunch/contracts-domain";
import { currentUser } from "../auth.js";
import { config } from "../config.js";
import { createInvitationToken } from "../external-auth.js";
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
      await repository.listIntegrations(currentUser(context).tenantId),
    ),
  );
  app.post("/v1/integrations", async (context) => {
    const input = CreateIntegrationSchema.parse(await context.req.json());
    return context.json(
      await repository.createIntegration(currentUser(context).tenantId, input),
      201,
    );
  });

  app.post("/v1/integration-sessions", async (context) => {
    const input = CreateIntegrationSessionSchema.parse(
      await context.req.json(),
    );
    const user = currentUser(context);
    const integration = await repository.findIntegration(
      user.tenantId,
      input.integrationKey,
    );
    if (!integration) throw new Error("Integration not found.");
    if (!integration.allowedRedirectUris.includes(input.returnUrl))
      throw new Error("returnUrl is not allow-listed for this integration.");
    let link = await repository.findIdentityLink(
      user.tenantId,
      integration.id,
      input.subject,
    );
    if (link && link.email.toLowerCase() !== input.email.toLowerCase())
      throw new Error(
        "This subject is already linked to a different email address.",
      );
    if (!link) {
      const person =
        (await repository.findPersonByEmail(user.tenantId, input.email)) ??
        (await repository.createPerson(
          user.tenantId,
          input.email,
          input.displayName ?? input.email.split("@")[0]!,
        ));
      link = IdentityLinkSchema.parse({
        id: `link_${randomUUID()}`,
        tenantId: user.tenantId,
        integrationId: integration.id,
        externalSubject: input.subject,
        personId: person.id,
        email: input.email.toLowerCase(),
        linkingMethod: integration.mappingStrategy,
        verifiedAt: services.now(),
      });
      await repository.createIdentityLink(link);
    }
    const agreement = await repository.createAgreement(user.tenantId, {
      title: input.title ?? `${input.templateKey} agreement`,
      templateKey: input.templateKey,
      participants: [],
      parties: [
        {
          role: "counterparty",
          entity: {},
          minimumSignatures: 1,
          participants: [
            {
              email: input.email,
              name: input.displayName,
              role: "signatory",
              required: true,
            },
          ],
        },
      ],
      metadata: input.metadata,
    });
    const participant = agreement.participants[0]!;
    participant.personId = link.personId;
    agreement.integrationContext = {
      integrationId: integration.id,
      integrationKey: integration.key,
      externalSubject: input.subject,
      personId: link.personId,
      returnUrl: input.returnUrl,
    };
    services.transition(agreement, "in_review");
    await repository.saveAgreement(agreement);
    const { token, tokenHash } = createInvitationToken();
    const handoff = IntegrationSessionSchema.parse({
      id: `isess_${randomUUID()}`,
      tenantId: user.tenantId,
      integrationId: integration.id,
      personId: link.personId,
      externalSubject: input.subject,
      agreementId: agreement.id,
      participantId: participant.id,
      tokenHash,
      status: "pending",
      returnUrl: input.returnUrl,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      createdAt: services.now(),
      acceptedAt: null,
    });
    await repository.createIntegrationSession(handoff);
    return context.json(
      {
        agreementId: agreement.id,
        expiresAt: handoff.expiresAt,
        handoffUrl: `${config.WEB_URL}/invite?integrationToken=${encodeURIComponent(token)}`,
      },
      201,
    );
  });

  app.post("/v1/conditions/evaluate", async (context) => {
    const user = currentUser(context);
    const input = EvaluateConditionsSchema.parse(await context.req.json());
    const integration = await repository.findIntegration(
      user.tenantId,
      input.integrationKey,
    );
    if (!integration) {
      return context.json(
        { error: "integration_not_found", message: "Integration not found." },
        404,
      );
    }
    const link = await repository.findIdentityLink(
      user.tenantId,
      integration.id,
      input.subject,
    );
    const agreements = link
      ? await repository.listAgreements(user.tenantId)
      : [];
    const conditions = input.conditions.map((condition) =>
      link
        ? services.conditionByPerson(agreements, link.personId, condition)
        : { ...condition, met: false },
    );
    return context.json({
      integrationKey: integration.key,
      subject: input.subject,
      operator: input.operator,
      met:
        input.operator === "all"
          ? conditions.every((item) => item.met)
          : conditions.some((item) => item.met),
      evaluatedAt: services.now(),
      conditions,
    });
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
