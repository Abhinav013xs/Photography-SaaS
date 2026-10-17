import { describe, it, expect } from 'vitest';
import { updateVisibilitySchema, createEventSchema, updateEventSchema } from '../../apps/api/src/routes/eventsSchemas.js';

describe('Phase 19: Event Visibility Unit Tests', () => {
  describe('Schema Validation & Strict Enums', () => {
    it('should accept valid "public" visibility', () => {
      const res = updateVisibilitySchema.safeParse({ visibility: 'public' });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.visibility).toBe('public');
      }
    });

    it('should accept valid "private" visibility', () => {
      const res = updateVisibilitySchema.safeParse({ visibility: 'private' });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.visibility).toBe('private');
      }
    });

    it('should reject invalid visibility values like "unlisted", "draft", "hidden"', () => {
      expect(updateVisibilitySchema.safeParse({ visibility: 'unlisted' }).success).toBe(false);
      expect(updateVisibilitySchema.safeParse({ visibility: 'draft' }).success).toBe(false);
      expect(updateVisibilitySchema.safeParse({ visibility: 'hidden' }).success).toBe(false);
      expect(updateVisibilitySchema.safeParse({ visibility: '' }).success).toBe(false);
      expect(updateVisibilitySchema.safeParse({ visibility: 123 }).success).toBe(false);
    });

    it('should reject missing visibility in updateVisibilitySchema', () => {
      const res = updateVisibilitySchema.safeParse({});
      expect(res.success).toBe(false);
    });

    it('should default new events to "private" visibility in createEventSchema', () => {
      const res = createEventSchema.safeParse({
        name: 'Default Privacy Wedding',
        client_name: 'Aditi & Rohan',
        event_date: '2026-11-20',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.visibility).toBe('private');
      }
    });

    it('should allow optional visibility in updateEventSchema', () => {
      const res = updateEventSchema.safeParse({
        name: 'Updated Name',
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.visibility).toBeUndefined();
      }
    });
  });

  describe('Access Decision Logic Combinations', () => {
    type DecisionInput = {
      isPhotographer: boolean;
      status: string;
      visibility: string;
      pinEnabled: boolean;
      hasValidGuestToken: boolean;
    };

    function evaluateAccess(input: DecisionInput): 'ALLOW' | 'REQUIRE_PIN' | 'DENY_PRIVATE' | 'DENY_STATUS' {
      if (input.isPhotographer) {
        return 'ALLOW';
      }
      if (input.status !== 'active') {
        return 'DENY_STATUS';
      }
      if (input.visibility !== 'public') {
        return 'DENY_PRIVATE';
      }
      if (input.pinEnabled && !input.hasValidGuestToken) {
        return 'REQUIRE_PIN';
      }
      return 'ALLOW';
    }

    it('Scenario A: Public, No PIN, Guest -> ALLOW', () => {
      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'active',
          visibility: 'public',
          pinEnabled: false,
          hasValidGuestToken: false,
        })
      ).toBe('ALLOW');
    });

    it('Scenario B: Public, PIN Enabled, Guest without token -> REQUIRE_PIN', () => {
      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'active',
          visibility: 'public',
          pinEnabled: true,
          hasValidGuestToken: false,
        })
      ).toBe('REQUIRE_PIN');
    });

    it('Scenario B2: Public, PIN Enabled, Guest with valid token -> ALLOW', () => {
      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'active',
          visibility: 'public',
          pinEnabled: true,
          hasValidGuestToken: true,
        })
      ).toBe('ALLOW');
    });

    it('Scenario C: Private, No PIN, Guest -> DENY_PRIVATE', () => {
      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'active',
          visibility: 'private',
          pinEnabled: false,
          hasValidGuestToken: false,
        })
      ).toBe('DENY_PRIVATE');
    });

    it('Scenario D: Private, PIN Enabled, Guest with or without token -> DENY_PRIVATE (PIN never overrides)', () => {
      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'active',
          visibility: 'private',
          pinEnabled: true,
          hasValidGuestToken: true,
        })
      ).toBe('DENY_PRIVATE');

      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'active',
          visibility: 'private',
          pinEnabled: true,
          hasValidGuestToken: false,
        })
      ).toBe('DENY_PRIVATE');
    });

    it('Photographer Access: Private event -> ALLOW', () => {
      expect(
        evaluateAccess({
          isPhotographer: true,
          status: 'active',
          visibility: 'private',
          pinEnabled: true,
          hasValidGuestToken: false,
        })
      ).toBe('ALLOW');
    });

    it('Archived or Draft event -> DENY_STATUS', () => {
      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'draft',
          visibility: 'public',
          pinEnabled: false,
          hasValidGuestToken: false,
        })
      ).toBe('DENY_STATUS');

      expect(
        evaluateAccess({
          isPhotographer: false,
          status: 'archived',
          visibility: 'public',
          pinEnabled: false,
          hasValidGuestToken: false,
        })
      ).toBe('DENY_STATUS');
    });
  });
});
