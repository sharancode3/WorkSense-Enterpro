import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { fetchMe, type Twin } from "@/lib/api";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import type { Role } from "@/lib/rbac";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  twin: Twin | null;
  role: Role | null;
  loading: boolean;
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

  // Register the listener BEFORE checking the existing session, otherwise the
  // initial session restore races the listener. Never pass an async callback;
  // defer any supabase client call inside it with setTimeout(..., 0).
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        setTimeout(() => {
          void fetchMe()
            .then((me) => setTwin(me.twin))
            .catch((err) => {
              console.error("auth: failed to resolve twin", err);
              setTwin(null);
            });
        }, 0);
      } else {
        setTwin(null);
      }
      setLoading(false);
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
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
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setUser(null);
    setSession(null);
    setTwin(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      twin,
      role: twin?.role ?? null,
      loading,
      signInDemo,
      signInWithEmail,
      signUp,
      signOut,
    }),
    [user, session, twin, loading, signInDemo, signInWithEmail, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
