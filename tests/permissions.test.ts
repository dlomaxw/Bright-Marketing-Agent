import { describe, it, expect } from 'vitest';
import { can, actionsFor } from '../src/server/auth/permissions';

describe('Permissions Matrix', () => {
  it('allows admin all actions', () => {
    expect(can('admin', 'org.purge')).toBe(true);
    expect(can('admin', 'proposal.set_commercials')).toBe(true);
    expect(can('admin', 'user.write')).toBe(true);
  });

  it('restricts viewer role to read-only actions', () => {
    const viewerActions = actionsFor('viewer');
    for (const action of viewerActions) {
      expect(action).toMatch(/\.(read|export)$/);
    }
    expect(can('viewer', 'org.create')).toBe(false);
    expect(can('viewer', 'proposal.edit')).toBe(false);
    expect(can('viewer', 'email.send')).toBe(false);
  });

  it('enforces commercial separation of duties: auditor cannot set commercials', () => {
    expect(can('auditor', 'proposal.set_commercials')).toBe(false);
    expect(can('sales', 'proposal.set_commercials')).toBe(true);
  });

  it('denies unknown role or null', () => {
    expect(can(null, 'org.read')).toBe(false);
    expect(can('superhero', 'org.read')).toBe(false);
  });
});
