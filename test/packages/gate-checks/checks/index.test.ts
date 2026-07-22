import { describe, it, expect } from 'vitest';
import { catalog } from '@magpieweaver/gate-checks/src/checks/index.js';

describe('checks/index catalog', () => {
  it('exports catalog as an object', () => {
    expect(catalog).toBeDefined();
    expect(typeof catalog).toBe('object');
  });

  it('contains get-inbound-commits', () => {
    expect(catalog['get-inbound-commits']).toBeDefined();
  });

  it('has fn and requiredArgs for get-inbound-commits', () => {
    const entry = catalog['get-inbound-commits'];
    expect(typeof entry.fn).toBe('function');
    expect(Array.isArray(entry.requiredArgs)).toBe(true);
    expect(entry.requiredArgs).toEqual(['pr-base-sha', 'pr-head-sha']);
  });
});
