import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  CreateIntegrationSchema,
  CreateIntegrationSessionSchema,
  CreateWebhookSchema,
  EvaluateAgreementStatusSchema,
  IdentityLinkSchema,
  IntegrationSessionSchema,
  type Agreement,
  type AgreementStatus,
} from "@bytecrunch/contracts-domain";
import { currentUser } from "../auth.js";
import { config } from "../config.js";
import { createInvitationToken } from "../external-auth.js";
import type { Repository } from "../repository.js";

type RequirementResult = {
  satisfied: boolean;
  agreementId?: string;
  status?: AgreementStatus;
  templateKey: string;
  templateVersion?: number;
  minimumVersion: number;
  executedAt?: string | null;
};
type PlatformRouteServices = {
  now: () => string;
  transition: (agreement: Agreement, status: AgreementStatus) => void;
  requirementBySubject: (
    agreements: Agreement[],
    subject: string,
    templateKey: string,
    minimumVersion: number,
  ) => RequirementResult;
  requirementByPerson: (
    agreements: Agreement[],
    personId: string,
    templateKey: string,
    minimumVersion: number,
  ) => RequirementResult;
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

  app.get("/v1/integration-status", async (context) => {
    const user = currentUser(context);
    const integrationKey = context.req.query("integrationKey");
    const subject = context.req.query("subject");
    const templateKey = context.req.query("templateKey");
    const minimumVersion = Number(context.req.query("minimumVersion") ?? "1");
    if (
      !integrationKey ||
      !subject ||
      !templateKey ||
      !Number.isInteger(minimumVersion) ||
      minimumVersion < 1
    )
      return context.json(
        {
          error: "invalid_query",
          message: "integrationKey, subject and templateKey are required.",
        },
        400,
      );
    const integration = await repository.findIntegration(
      user.tenantId,
      integrationKey,
    );
    if (!integration)
      return context.json({ satisfied: false, templateKey, minimumVersion });
    const link = await repository.findIdentityLink(
      user.tenantId,
      integration.id,
      subject,
    );
    if (!link)
      return context.json({ satisfied: false, templateKey, minimumVersion });
    return context.json(
      services.requirementByPerson(
        await repository.listAgreements(user.tenantId),
        link.personId,
        templateKey,
        minimumVersion,
      ),
    );
  });

  app.get("/v1/agreement-status", async (context) => {
    const externalSubjectId = context.req.query("externalSubjectId");
    const templateKey = context.req.query("templateKey");
    const minimumVersion = Number(context.req.query("minimumVersion") ?? "1");
    if (
      !externalSubjectId ||
      !templateKey ||
      !Number.isInteger(minimumVersion) ||
      minimumVersion < 1
    )
      return context.json(
        {
          error: "invalid_query",
          message:
            "externalSubjectId, templateKey and a valid minimumVersion are required.",
        },
        400,
      );
    return context.json(
      services.requirementBySubject(
        await repository.listAgreements(currentUser(context).tenantId),
        externalSubjectId,
        templateKey,
        minimumVersion,
      ),
    );
  });

  app.post("/v1/agreement-status/evaluate", async (context) => {
    const input = EvaluateAgreementStatusSchema.parse(await context.req.json());
    const agreements = await repository.listAgreements(
      currentUser(context).tenantId,
    );
    const requirements = input.requirements.map((requirement) =>
      services.requirementBySubject(
        agreements,
        input.externalSubjectId,
        requirement.templateKey,
        requirement.minimumVersion,
      ),
    );
    return context.json({
      externalSubjectId: input.externalSubjectId,
      operator: input.operator,
      satisfied:
        input.operator === "all"
          ? requirements.every((item) => item.satisfied)
          : requirements.some((item) => item.satisfied),
      requirements,
    });
  });

  app.get("/v1/webhooks", async (context) =>
    context.json(await repository.listWebhooks(currentUser(context).tenantId)),
  );
  app.post("/v1/webhooks", async (context) => {
    const input = CreateWebhookSchema.parse(await context.req.json());
    return context.json(
      await repository.createWebhook(
        currentUser(context).tenantId,
        input.url,
        input.events,
      ),
      201,
    );
  });
}
