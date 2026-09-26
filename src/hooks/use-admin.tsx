import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";
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

const TOKEN_KEY = "ppr-admin-session";

export type AdminUser = {
  username: string;
  displayName: string;
  lastLoginAt: number | null;
};

export type AdminState =
  | { status: "loading" }
  | { status: "unauthenticated"; needsSetup: boolean }
  | { status: "authenticated"; admin: AdminUser };

type AdminContextValue = {
  state: AdminState;
  token: string | null;
  /** Sign in with username + password. Throws a user-facing Error on failure. */
  login: (username: string, password: string) => Promise<void>;
  /** First-run only: create the administrator account. */
  setup: (username: string, password: string) => Promise<void>;
  /** End the session on the server and clear the local token. */
  logout: () => Promise<void>;
  /** Drop the local session when the server reports it expired. */
  expireSession: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage may be unavailable (private mode) — session then lasts this tab only.
  }
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AdminState>({ status: "loading" });
  const [token, setToken] = useState<string | null>(() => readStoredToken());

  const statusAction = useAction(api.adminAuth.status);
  const meAction = useAction(api.adminAuth.me);
  const loginAction = useAction(api.adminAuth.login);
  const setupAction = useAction(api.adminAuth.setup);
  const logoutAction = useAction(api.adminAuth.logout);

  // Keep the latest actions in a ref so the restore effect runs exactly once.
  const actions = useRef({ statusAction, meAction, loginAction, setupAction, logoutAction });
  actions.current = { statusAction, meAction, loginAction, setupAction, logoutAction };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readStoredToken();
      try {
        if (stored) {
          const result = await actions.current.meAction({ token: stored });
          if (cancelled) return;
          if (result.authenticated && result.admin) {
            setState({
              status: "authenticated",
              admin: {
                username: result.admin.username,
                displayName: result.admin.displayName,
                lastLoginAt: result.admin.lastLoginAt,
              },
            });
            return;
          }
          storeToken(null);
          setToken(null);
          setState({ status: "unauthenticated", needsSetup: result.needsSetup });
        } else {
          const result = await actions.current.statusAction({});
          if (cancelled) return;
          setState({ status: "unauthenticated", needsSetup: result.needsSetup });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "unauthenticated", needsSetup: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await actions.current.loginAction({ username, password });
    storeToken(result.token);
    setToken(result.token);
    setState({
      status: "authenticated",
      admin: {
        username: result.username,
        displayName: result.username,
        lastLoginAt: null,
      },
    });
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const result = await actions.current.setupAction({ username, password });
    storeToken(result.token);
    setToken(result.token);
    setState({
      status: "authenticated",
      admin: {
        username: result.username,
        displayName: result.username,
        lastLoginAt: null,
      },
    });
  }, []);

  const logout = useCallback(async () => {
    const current = readStoredToken();
    try {
      if (current) await actions.current.logoutAction({ token: current });
    } catch {
      // Server-side logout is best effort; the local token is cleared regardless.
    }
    storeToken(null);
    setToken(null);
    setState({ status: "unauthenticated", needsSetup: false });
  }, []);

  const expireSession = useCallback(() => {
    storeToken(null);
    setToken(null);
    setState({ status: "unauthenticated", needsSetup: false });
  }, []);

  const value = useMemo(
    () => ({ state, token, login, setup, logout, expireSession }),
    [state, token, login, setup, logout, expireSession],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    throw new Error("useAdmin must be used inside <AdminProvider>");
  }
  return ctx;
}
