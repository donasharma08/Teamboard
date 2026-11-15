import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { OrgRef, User } from './types';

interface Session {
  user: User | null;
  orgs: OrgRef[];
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session>(null as any);
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<OrgRef[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User | null; orgs: OrgRef[] }>('/api/auth/me');
      setUser(me.user);
      setOrgs(me.orgs);
    } catch {
      setUser(null);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
    setOrgs([]);
  }, []);

  useEffect(() => {
    refresh();
    const onOut = () => { setUser(null); setOrgs([]); };
    window.addEventListener('tb:signed-out', onOut);
    return () => window.removeEventListener('tb:signed-out', onOut);
  }, [refresh]);

  return <Ctx.Provider value={{ user, orgs, loading, refresh, signOut }}>{children}</Ctx.Provider>;
}

/** The org the URL points at, plus helpers for role checks. */
export function useOrg(orgId: number) {
  const { orgs } = useSession();
  const org = orgs.find((o) => o.id === orgId) ?? null;
  return {
    org,
    isManager: org?.role === 'owner' || org?.role === 'manager',
    isOwner: org?.role === 'owner',
  };
}
