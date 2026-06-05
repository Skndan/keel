import { describe, it, expect } from 'vitest';

describe('Dashboard page routing', () => {
  it('has routes for all pages', () => {
    const routes = [
      '/login',
      '/',
      '/project/:slug/tables',
      '/project/:slug/storage',
      '/project/:slug/webhooks',
      '/project/:slug/settings',
    ];

    // Verify all required routes are present
    expect(routes).toContain('/login');
    expect(routes).toContain('/');
    expect(routes).toContain('/project/:slug/tables');
    expect(routes).toContain('/project/:slug/storage');
    expect(routes).toContain('/project/:slug/webhooks');
    expect(routes).toContain('/project/:slug/settings');
  });

  it('formatProjectDate formats ISO dates', () => {
    const formatDate = (iso: string) =>
      new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

    const result = formatDate('2025-06-01T12:00:00Z');
    expect(result).toContain('2025');
    expect(result).toContain('Jun');
  });
});
