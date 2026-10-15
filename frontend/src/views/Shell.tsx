import type { ReactNode } from 'react';
import type { Roles } from '../types.ts';
import type { Route } from '../router.ts';
import type { Backend } from '../backend.ts';

/** Toppmeny med rollstyrda val. Säkerheten ligger i RLS; menyn döljer bara det som inte gäller. */
export function Shell({
  route,
  roles,
  email,
  backend,
  children,
}: {
  route: Route;
  roles: Roles | null;
  email: string | undefined;
  backend: Backend;
  children: ReactNode;
}) {
  function go(hash: string) {
    window.location.hash = hash;
  }

  const showAdmin = roles?.anyAdmin ?? false;
  const showFederation = roles?.federationRep ?? false;

  return (
    <div>
      <header className="topbar">
        <button className="brand" onClick={() => go('#/')}>
          Matchupplevelse
        </button>
        <nav className="nav">
          <button className={navClass(route.kind === 'home')} onClick={() => go('#/')}>
            Mina lag
          </button>
          {showAdmin && (
            <button className={navClass(route.kind === 'admin')} onClick={() => go('#/admin')}>
              Admin
            </button>
          )}
          {showFederation && (
            <button className={navClass(route.kind === 'federation')} onClick={() => go('#/forbund')}>
              Förbund
            </button>
          )}
        </nav>
        <div className="user">
          <span className="email" title={email}>
            {email}
          </span>
          <button
            className="link-btn"
            onClick={async () => {
              await backend.auth.signOut();
            }}
          >
            Logga ut
          </button>
        </div>
      </header>
      <main className="app-shell">{children}</main>
    </div>
  );
}

function navClass(active: boolean): string {
  return active ? 'nav-item nav-active' : 'nav-item';
}
