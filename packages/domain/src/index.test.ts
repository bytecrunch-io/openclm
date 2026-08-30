import { describe, expect, it } from 'vitest';
import { AgreementSchema, assertReadyForSignature, canTransition, isExecutionComplete, permissionsForEntityRoles } from './index.js';

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
});
