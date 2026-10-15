import { useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Backend } from './backend.ts';
import type { Roles } from './types.ts';

export type SessionState = {
  loading: boolean;
  session: Session | null;
  roles: Roles | null;
};

/**
 * Håller koll på inloggad session och användarens roller. Lyssnar på auth-ändringar
 * och laddar om rollerna när sessionen ändras.
 */
export function useSession(client: SupabaseClient, backend: Backend): SessionState {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Roles | null>(null);

  useEffect(() => {
    let active = true;

    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      setSession(s);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    let active = true;
    if (!session) {
      setRoles(null);
      return;
    }
    backend.roles.load().then((res) => {
      if (!active) return;
      setRoles(res.ok ? res.data : { superadmin: false, federationRep: false, adminClubs: [], anyAdmin: false });
    });
    return () => {
      active = false;
    };
  }, [session, backend]);

  return { loading, session, roles };
}
