import { beforeEach, describe, expect, it } from 'vitest';
import { presence } from '../src/realtime/presence.js';

describe('presence registry', () => {
  beforeEach(() => presence.reset());

  it('reports a user online after their first socket', () => {
    expect(presence.add('u1', 's1')).toBe(true);
    expect(presence.isOnline('u1')).toBe(true);
  });

  it('does not re-announce on a second socket', () => {
    presence.add('u1', 's1');
    expect(presence.add('u1', 's2')).toBe(false);
  });

  it('stays online while any socket remains — two tabs, one person', () => {
    presence.add('u1', 's1');
    presence.add('u1', 's2');
    expect(presence.remove('u1', 's1')).toBe(false);
    expect(presence.isOnline('u1')).toBe(true);
    expect(presence.remove('u1', 's2')).toBe(true);
    expect(presence.isOnline('u1')).toBe(false);
  });

  it('ignores removal of unknown sockets', () => {
    expect(presence.remove('ghost', 's9')).toBe(false);
  });

  it('filters a list down to online members', () => {
    presence.add('a', 's1');
    presence.add('c', 's2');
    expect([...presence.onlineAmong(['a', 'b', 'c'])].sort()).toEqual(['a', 'c']);
  });
});
