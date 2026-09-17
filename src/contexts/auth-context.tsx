import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchMe, type Twin } from "@/lib/api";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { queryClient } from "@/lib/query-client";
import type { Role } from "@/lib/rbac";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  twin: Twin | null;
  role: Role | null;
  loading: boolean;
  resolving: boolean;
  signInDemo: (role: Exclude<Role, "candidate">) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [twin, setTwin] = useState<Twin | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(true);
  // Guards against a stale fetchMe resolving after the user switched.
  const currentUidRef = useRef<string | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      currentUidRef.current = nextSession?.user?.id ?? null;

      if (nextSession?.user) {
        setResolving(true);
        setTimeout(() => {
          const uid = nextSession.user!.id;
          void fetchMe()
            .then((me) => {
              // Only apply if the user is still the one who initiated this call.
              if (currentUidRef.current === uid) {
                setTwin(me.twin);
              }
            })
            .catch((err) => {
              console.error("auth: failed to resolve twin", err);
              if (currentUidRef.current === uid) setTwin(null);
            })
            .finally(() => {
              if (currentUidRef.current === uid) setResolving(false);
            });
        }, 0);
      } else {
        setTwin(null);
        setResolving(false);
      }
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        currentUidRef.current = data.session.user.id;
        setSession(data.session);
        setUser(data.session.user);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInDemo = useCallback(async (role: Exclude<Role, "candidate">) => {
    const account = DEMO_ACCOUNTS.find((a) => a.role === role);
    if (!account) throw new Error(`No demo account for role ${role}`);
    const { error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password: account.password,
    });
    if (error) throw error;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { name },
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    currentUidRef.current = null;
    // Clear all actor-scoped query cache BEFORE dropping the session so a
    // different persona can never see the previous user's cached data.
    queryClient.clear();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setSession(null);
    setTwin(null);
    setResolving(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      twin,
      role: twin?.role ?? null,
      loading,
      resolving,
      signInDemo,
      signInWithEmail,
      signUp,
      signOut,
    }),
    [user, session, twin, loading, resolving, signInDemo, signInWithEmail, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
