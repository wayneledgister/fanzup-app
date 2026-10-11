/** Session context: who is signed in, and whether their email is verified (FR-ID-001, card G1-B option 3). */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface SessionState {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(() => {
    const user = session?.user;
    return {
      configured: !!supabase,
      loading,
      session,
      email: user?.email ?? null,
      emailVerified: !!user?.email_confirmed_at,
      displayName: (user?.user_metadata?.display_name as string | undefined) ?? "",
      signOut: async () => {
        await supabase?.auth.signOut();
      },
      refresh: async () => {
        if (!supabase) return;
        const { data } = await supabase.auth.refreshSession();
        setSession(data.session);
      },
    };
  }, [session, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

export const initials = (name: string, email: string | null) =>
  (name || email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");
