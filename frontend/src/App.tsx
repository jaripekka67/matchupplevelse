import { useEffect, useMemo, useState } from 'react';
import { getClient, hasConfig, readConfig } from './supabaseClient.ts';
import { createBackend } from './backend.ts';
import { useSession } from './useSession.ts';
import { parseRoute, type Route } from './router.ts';
import { Login } from './views/Login.tsx';
import { Welcome } from './views/Welcome.tsx';
import { Shell } from './views/Shell.tsx';
import { Home } from './views/Home.tsx';
import { TeamPage } from './views/TeamPage.tsx';
import { AdminPage } from './views/AdminPage.tsx';
import { FederationPage } from './views/FederationPage.tsx';
import { DemoPage } from './views/DemoPage.tsx';

export function App() {
  const cfg = readConfig();
  if (!hasConfig(cfg)) return <ConfigMissing />;
  return <AppInner />;
}

function AppInner() {
  const client = useMemo(() => getClient(), []);
  const backend = useMemo(() => createBackend(client), [client]);
  const { loading, session, roles } = useSession(client, backend);
  const route = useHashRoute();

  if (loading) {
    return (
      <main className="app-shell">
        <div className="card" role="status">
          Laddar…
        </div>
      </main>
    );
  }

  if (!session) {
    return <SignedOut backend={backend} />;
  }

  return (
    <Shell route={route} roles={roles} email={session.user.email} backend={backend}>
      <Page route={route} backend={backend} roles={roles} />
    </Shell>
  );
}

function SignedOut({ backend }: { backend: ReturnType<typeof createBackend> }) {
  const [showLogin, setShowLogin] = useState(false);
  if (showLogin) return <Login backend={backend} />;
  return <Welcome onStart={() => setShowLogin(true)} />;
}

function Page({ route, backend, roles }: { route: Route; backend: ReturnType<typeof createBackend>; roles: ReturnType<typeof useSession>['roles'] }) {
  switch (route.kind) {
    case 'home':
      return <Home backend={backend} />;
    case 'team':
      return <TeamPage teamId={route.teamId} backend={backend} />;
    case 'admin':
      return <AdminPage backend={backend} roles={roles} />;
    case 'federation':
      return <FederationPage backend={backend} />;
    case 'demo':
      return <DemoPage />;
  }
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

function ConfigMissing() {
  return (
    <main className="app-shell">
      <h1>Matchupplevelse</h1>
      <div className="card card-warn" role="alert">
        Konfiguration saknas. Skapa <code>frontend/.env.local</code> från <code>.env.example</code>{' '}
        och fyll i Supabase-URL och anon-nyckel.
      </div>
    </main>
  );
}
