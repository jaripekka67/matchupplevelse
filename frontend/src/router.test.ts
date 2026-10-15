import { describe, it, expect } from 'vitest';
import { parseRoute, routeHash } from './router.ts';

describe('parseRoute', () => {
  it('tom hash -> home', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute('#')).toEqual({ kind: 'home' });
    expect(parseRoute('#/')).toEqual({ kind: 'home' });
  });

  it('team med id', () => {
    expect(parseRoute('#/team/abc-123')).toEqual({ kind: 'team', teamId: 'abc-123' });
  });

  it('team utan id -> home', () => {
    expect(parseRoute('#/team')).toEqual({ kind: 'home' });
    expect(parseRoute('#/team/')).toEqual({ kind: 'home' });
  });

  it('admin och forbund', () => {
    expect(parseRoute('#/admin')).toEqual({ kind: 'admin' });
    expect(parseRoute('#/forbund')).toEqual({ kind: 'federation' });
  });

  it('okänd route -> home', () => {
    expect(parseRoute('#/nonsens')).toEqual({ kind: 'home' });
  });

  it('tål trailing slash och extra segment', () => {
    expect(parseRoute('#/admin/')).toEqual({ kind: 'admin' });
    expect(parseRoute('#/team/xyz/extra')).toEqual({ kind: 'team', teamId: 'xyz' });
  });
});

describe('routeHash', () => {
  it('är invers till parseRoute för kända routes', () => {
    const routes = [
      { kind: 'home' as const },
      { kind: 'team' as const, teamId: 'abc' },
      { kind: 'admin' as const },
      { kind: 'federation' as const },
    ];
    for (const r of routes) {
      expect(parseRoute(routeHash(r))).toEqual(r);
    }
  });
});
