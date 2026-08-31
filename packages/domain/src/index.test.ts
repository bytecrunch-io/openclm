import { describe, expect, it } from 'vitest';
import { AgreementSchema, EntityBrandingSchema, assertReadyForSignature, canTransition, isExecutionComplete, permissionsForEntityRoles, requiredEntityFieldsForTemplate } from './index.js';

const agreement = AgreementSchema.parse({
  id: 'agr_test', tenantId: 'org_test', externalId: null, title: 'NDA',
  templateKey: 'nda', templateVersion: 1, status: 'in_review', revision: 1,
  content: 'Terms', contentSha256: 'a'.repeat(64), metadata: {},
  createdAt: '2026-08-27T10:00:00.000Z', updatedAt: '2026-08-27T10:00:00.000Z', executedAt: null,
  suggestions: [],
  participants: [{
    id: 'part_test', externalSubjectId: 'person_test', email: 'person@example.com',
    name: 'Test Person', role: 'signatory', required: true, status: 'invited', signedAt: null,
  }],
});

describe('agreement lifecycle', () => {
  it('allows only explicit transitions', () => {
    expect(canTransition('draft', 'in_review')).toBe(true);
    expect(canTransition('executed', 'in_review')).toBe(false);
  });

  it('requires every required signatory', () => {
    assertReadyForSignature(agreement);
    expect(isExecutionComplete(agreement)).toBe(false);
    agreement.participants[0]!.status = 'signed';
    expect(isExecutionComplete(agreement)).toBe(true);
  });

  it('derives stable permissions from entity role bundles', () => {
    expect(permissionsForEntityRoles(['viewer', 'template_manager'])).toEqual(['templates.read', 'agreements.read', 'templates.write']);
    expect(permissionsForEntityRoles(['administrator'])).toContain('members.manage');
  });

  it('derives entity requirements from party-specific template placeholders', () => {
    const content = '{{sender.legal_name}}, at {{sender.business_address}}, agrees with {{counterparty.legal_name}}.';
    expect(requiredEntityFieldsForTemplate(content, 'sender')).toEqual(['businessAddress']);
    expect(requiredEntityFieldsForTemplate(content, 'counterparty')).toEqual([]);
  });

  it('does not allow signing while a required address placeholder is unresolved', () => {
    agreement.content = 'Offices at {{counterparty.business_address}}';
    expect(() => assertReadyForSignature(agreement)).toThrow(/required business address/i);
    agreement.content = 'Terms';
  });

  it('accepts inactive SVG branding and rejects active SVG content', () => {
    const dataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;
    const branding = { displayName: 'Example', primaryColor: '#112233', secondaryColor: '#445566', markDataUrl: null };
    expect(EntityBrandingSchema.safeParse({ ...branding, logoDataUrl: dataUrl('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="brand"/></defs><path fill="url(#brand)" d="M0 0h10v10z"/></svg>') }).success).toBe(true);
    expect(EntityBrandingSchema.safeParse({ ...branding, logoDataUrl: dataUrl('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') }).success).toBe(false);
    expect(EntityBrandingSchema.safeParse({ ...branding, logoDataUrl: dataUrl('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/tracker.png"/></svg>') }).success).toBe(false);
  });
});
