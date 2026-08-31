import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  CreateCustomerEntitySchema,
  EntityMemberInvitationSchema,
  InviteEntityMemberSchema,
  UpdateEntityMemberSchema,
  UpdateEntityBrandingSchema,
  permissionsForEntityRoles,
  type EntityMemberInvitation,
  type EntityMembership,
  type RecipientInboxItem,
} from "@bytecrunch/contracts-domain";
import { currentUser } from "../auth.js";
import { config } from "../config.js";
import { sendMemberInvitationEmail } from "../email.js";
import {
  createInvitationToken,
  hashInvitationToken,
} from "../external-auth.js";
import type { Repository } from "../repository.js";

type EntityRouteServices = {
  now: () => string;
  personalInbox: (
    accountId: string,
    email: string,
    accessOnly: boolean,
  ) => Promise<RecipientInboxItem[]>;
  publicInvitation: (
    invitation: EntityMemberInvitation,
  ) => Omit<EntityMemberInvitation, "tokenHash">;
  assertAnotherAdministrator: (membership: EntityMembership) => Promise<void>;
};

export function registerEntityRoutes(
  app: Hono,
  repository: Repository,
  services: EntityRouteServices,
): void {
  app.get("/v1/me", async (context) => {
    const user = currentUser(context);
    const memberships = await repository.listEntityMemberships(user.id);
    const entities = (
      await Promise.all(
        memberships
          .filter((item) => item.status === "active")
          .map(async (membership) => {
            const entity = await repository.getCustomerEntity(
              membership.entityId,
            );
            return entity ? { ...membership, entity } : undefined;
          }),
      )
    ).filter((item) => item !== undefined);
    return context.json({
      id: user.id,
      email: user.email,
      name: user.name,
      activeEntityId: entities.some((item) => item?.entityId === user.tenantId)
        ? user.tenantId
        : (entities[0]?.entityId ?? null),
      entities,
      scopes: user.scopes,
    });
  });
  app.get("/v1/my-work", async (context) => {
    const user = currentUser(context);
    return context.json(
      await services.personalInbox(user.id, user.email, false),
    );
  });

  app.post("/v1/entities", async (context) => {
    const user = currentUser(context);
    const input = CreateCustomerEntitySchema.parse(await context.req.json());
    const entity = await repository.createCustomerEntity({
      ...input,
      businessAddress: input.businessAddress ?? null,
      registrationNumber: input.registrationNumber ?? null,
      jurisdiction: input.jurisdiction ?? null,
    });
    await repository.grantEntityMembership(
      user.id,
      entity.id,
      ["administrator"],
      permissionsForEntityRoles(["administrator"]),
    );
    const sourceTemplate = (await repository.listTemplates("bytecrunch"))
      .filter((item) => item.key === "mutual-nda")
      .sort((a, b) => b.version - a.version)[0];
    if (sourceTemplate)
      await repository.createTemplate(entity.id, {
        key: sourceTemplate.key,
        name: sourceTemplate.name,
        description: sourceTemplate.description,
        content: sourceTemplate.content,
      });
    return context.json(entity, 201);
  });

  app.put("/v1/entity/branding", async (context) => {
    const user = currentUser(context);
    const branding = UpdateEntityBrandingSchema.parse(await context.req.json());
    const entity = await repository.getCustomerEntity(user.tenantId);
    if (!entity) throw new Error("The active customer entity could not be found.");
    entity.branding = branding;
    await repository.saveCustomerEntity(entity);
    return context.json(entity);
  });

  app.get("/v1/entity-members", async (context) => {
    const user = currentUser(context);
    const memberships = await repository.listEntityMembers(user.tenantId);
    const members = (
      await Promise.all(
        memberships.map(async (membership) => {
          const account = await repository.getAccount(membership.accountId);
          return account ? { membership, account } : undefined;
        }),
      )
    ).filter((item) => item !== undefined);
    const invitations = (
      await repository.listEntityMemberInvitations(user.tenantId)
    ).map(services.publicInvitation);
    return context.json({ members, invitations });
  });

  app.post("/v1/entity-members/invitations", async (context) => {
    const user = currentUser(context);
    const input = InviteEntityMemberSchema.parse(await context.req.json());
    const email = input.email.toLowerCase();
    const entity = await repository.getCustomerEntity(user.tenantId);
    if (!entity)
      throw new Error("The active customer entity could not be found.");
    const existingMembers = await repository.listEntityMembers(user.tenantId);
    const existingAccounts = await Promise.all(
      existingMembers.map((item) => repository.getAccount(item.accountId)),
    );
    if (existingAccounts.some((account) => account?.email === email))
      return context.json(
        {
          error: "already_member",
          message: "That person is already a member of this customer entity.",
        },
        409,
      );
    const invitations = await repository.listEntityMemberInvitations(
      user.tenantId,
    );
    await Promise.all(
      invitations
        .filter((item) => item.email === email && item.status === "pending")
        .map(async (item) => {
          item.status = "revoked";
          await repository.saveEntityMemberInvitation(item);
        }),
    );
    const { token, tokenHash } = createInvitationToken();
    const invitation = EntityMemberInvitationSchema.parse({
      id: `member_inv_${randomUUID()}`,
      entityId: user.tenantId,
      email,
      roles: input.roles,
      tokenHash,
      status: "pending",
      invitedByAccountId: user.id,
      acceptedByAccountId: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: services.now(),
      acceptedAt: null,
    });
    await repository.createEntityMemberInvitation(invitation);
    const invitationUrl = `${config.WEB_URL}/membership?token=${encodeURIComponent(token)}`;
    await sendMemberInvitationEmail({
      email,
      inviterName: user.name,
      entityName: entity.legalName,
      invitationUrl,
    });
    return context.json(
      { ...services.publicInvitation(invitation), invitationUrl },
      201,
    );
  });

  app.patch("/v1/entity-members/:membershipId", async (context) => {
    const user = currentUser(context);
    const input = UpdateEntityMemberSchema.parse(await context.req.json());
    const membership = await repository.getEntityMembership(
      context.req.param("membershipId"),
    );
    if (!membership || membership.entityId !== user.tenantId)
      return context.json(
        { error: "not_found", message: "Entity member not found." },
        404,
      );
    if (
      membership.roles.includes("administrator") &&
      !input.roles.includes("administrator")
    )
      await services.assertAnotherAdministrator(membership);
    membership.roles = input.roles;
    membership.permissions = permissionsForEntityRoles(input.roles);
    membership.status = "active";
    await repository.saveEntityMembership(membership);
    return context.json(membership);
  });

  app.delete("/v1/entity-members/:membershipId", async (context) => {
    const user = currentUser(context);
    const membership = await repository.getEntityMembership(
      context.req.param("membershipId"),
    );
    if (!membership || membership.entityId !== user.tenantId)
      return context.json(
        { error: "not_found", message: "Entity member not found." },
        404,
      );
    if (membership.roles.includes("administrator"))
      await services.assertAnotherAdministrator(membership);
    membership.status = "suspended";
    await repository.saveEntityMembership(membership);
    return context.json(membership);
  });

  app.post("/v1/entity-member-invitations/accept", async (context) => {
    const user = currentUser(context);
    const body = (await context.req.json()) as { token?: unknown };
    if (typeof body.token !== "string" || body.token.length < 20)
      return context.json(
        {
          error: "invalid_invitation",
          message: "The membership invitation is invalid.",
        },
        400,
      );
    const invitation = await repository.getEntityMemberInvitationByTokenHash(
      hashInvitationToken(body.token),
    );
    if (!invitation || invitation.status !== "pending")
      return context.json(
        {
          error: "invalid_invitation",
          message: "This membership invitation is no longer active.",
        },
        410,
      );
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      invitation.status = "expired";
      await repository.saveEntityMemberInvitation(invitation);
      return context.json(
        {
          error: "invitation_expired",
          message: "This membership invitation has expired.",
        },
        410,
      );
    }
    if (!user.emailVerified || user.email.toLowerCase() !== invitation.email)
      return context.json(
        {
          error: "email_mismatch",
          message:
            "Sign in with the verified email address that received this invitation.",
        },
        403,
      );
    let membership = (await repository.listEntityMemberships(user.id)).find(
      (item) => item.entityId === invitation.entityId,
    );
    if (membership) {
      membership.roles = invitation.roles;
      membership.permissions = permissionsForEntityRoles(invitation.roles);
      membership.status = "active";
      await repository.saveEntityMembership(membership);
    } else
      membership = await repository.grantEntityMembership(
        user.id,
        invitation.entityId,
        invitation.roles,
        permissionsForEntityRoles(invitation.roles),
      );
    invitation.status = "accepted";
    invitation.acceptedAt = services.now();
    invitation.acceptedByAccountId = user.id;
    await repository.saveEntityMemberInvitation(invitation);
    const entity = await repository.getCustomerEntity(invitation.entityId);
    return context.json({ membership, entity });
  });
}
