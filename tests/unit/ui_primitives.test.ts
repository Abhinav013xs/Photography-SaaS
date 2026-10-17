import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  PageHeader,
  EmptyState,
  Skeleton,
  ErrorState,
  Toast,
} from '../../apps/web/components/ui/index.js';

describe('Design System UI Primitives (Server & Node Rendering)', () => {
  describe('Button Primitive', () => {
    it('should render primary button with champagne bronze background', () => {
      const html = renderToStaticMarkup(
        React.createElement(Button, { variant: 'primary' }, 'Enter Studio')
      );
      expect(html).toContain('bg-[#c5a059]');
      expect(html).toContain('Enter Studio');
      expect(html).toContain('<button');
    });

    it('should render secondary and outline button variants', () => {
      const secHtml = renderToStaticMarkup(
        React.createElement(Button, { variant: 'secondary' }, 'Secondary')
      );
      expect(secHtml).toContain('bg-[#20242a]');

      const outHtml = renderToStaticMarkup(
        React.createElement(Button, { variant: 'outline' }, 'Outline')
      );
      expect(outHtml).toContain('border-[#20242a]');
    });

    it('should render loading spinner and disabled state when isLoading=true', () => {
      const html = renderToStaticMarkup(
        React.createElement(Button, { isLoading: true }, 'Saving')
      );
      expect(html).toContain('animate-spin');
      expect(html).toContain('disabled=""');
    });
  });

  describe('Badge Primitive', () => {
    it('should render semantic badge variants with proper styling', () => {
      const bronzeHtml = renderToStaticMarkup(
        React.createElement(Badge, { variant: 'bronze' }, 'Phase 5')
      );
      expect(bronzeHtml).toContain('text-[#c5a059]');
      expect(bronzeHtml).toContain('Phase 5');

      const successHtml = renderToStaticMarkup(
        React.createElement(Badge, { variant: 'success' }, 'Active')
      );
      expect(successHtml).toContain('text-[#2ec4b6]');
    });
  });

  describe('Card Primitive', () => {
    it('should render structured card with header, title, description, and content', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          Card,
          null,
          React.createElement(
            CardHeader,
            null,
            React.createElement(CardTitle, null, 'Studio Metrics'),
            React.createElement(CardDescription, null, 'Real-time telemetry')
          ),
          React.createElement(CardContent, null, 'Card body text')
        )
      );

      expect(html).toContain('bg-[#14171b]');
      expect(html).toContain('border-[#20242a]');
      expect(html).toContain('Studio Metrics');
      expect(html).toContain('Real-time telemetry');
      expect(html).toContain('Card body text');
    });
  });

  describe('PageHeader Primitive', () => {
    it('should render page header with title, description, and eyebrow', () => {
      const html = renderToStaticMarkup(
        React.createElement(PageHeader, {
          title: 'Studio Lumina',
          description: 'Sole owner management dashboard',
          eyebrow: 'Production Workspace',
        })
      );

      expect(html).toContain('Studio Lumina');
      expect(html).toContain('Sole owner management dashboard');
      expect(html).toContain('Production Workspace');
      expect(html).toContain('font-display');
    });
  });

  describe('EmptyState Primitive', () => {
    it('should render editorial empty state with title and description', () => {
      const html = renderToStaticMarkup(
        React.createElement(EmptyState, {
          badge: 'Phase 6 Ready',
          title: 'No events found',
          description: 'Create an event to start organizing your galleries.',
        })
      );

      expect(html).toContain('No events found');
      expect(html).toContain('Create an event to start organizing your galleries.');
      expect(html).toContain('Phase 6 Ready');
    });
  });

  describe('Skeleton Primitive', () => {
    it('should render subtle shimmer skeleton with custom dimensions', () => {
      const html = renderToStaticMarkup(
        React.createElement(Skeleton, { width: 240, height: 32 })
      );

      expect(html).toContain('skeleton-shimmer');
      expect(html).toContain('width:240px');
      expect(html).toContain('height:32px');
    });
  });

  describe('ErrorState Primitive', () => {
    it('should render accessible error state banner', () => {
      const html = renderToStaticMarkup(
        React.createElement(ErrorState, {
          title: 'Network Timeout',
          message: 'Failed to reach API server.',
        })
      );

      expect(html).toContain('Network Timeout');
      expect(html).toContain('Failed to reach API server.');
      expect(html).toContain('role="alert"');
    });
  });

  describe('Toast Primitive', () => {
    it('should render toast notifications with semantic styles', () => {
      const html = renderToStaticMarkup(
        React.createElement(Toast, {
          type: 'success',
          message: 'Password rotated successfully',
        })
      );

      expect(html).toContain('Password rotated successfully');
      expect(html).toContain('text-[#2ec4b6]');
      expect(html).toContain('role="status"');
    });
  });
});
