import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, onUnauthorized, setApiKey } from "./api-client";
import type { ChatMessage, CurrentUser, ToolTrace } from "./types";

export interface ChatTurn extends ChatMessage {
  id: string;
  traces?: ToolTrace[];
  error?: boolean;
}

interface AuthState {
  user: CurrentUser | null;
  authenticated: boolean;
  sessionExpired: boolean;
  isAdmin: boolean;
  roleKnown: boolean;
  signIn: (key: string) => Promise<void>;
  signOut: () => void;
  chat: ChatTurn[];
  setChat: React.Dispatch<React.SetStateAction<ChatTurn[]>>;
}

const Ctx = createContext<AuthState | null>(null);

/** Holds the API key in memory only (inside api-client). Nothing is persisted. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);

  useEffect(() => {
    onUnauthorized(() => setSessionExpired(true));
    return () => {
      onUnauthorized(null);
    };
  }, []);

  const signIn = useCallback(
    async (key: string) => {
      setApiKey(key);
      try {
        const status = await api.status();
        setUser(status.user);
        setAuthenticated(true);
        setSessionExpired(false);
        qc.invalidateQueries();
      } catch (e) {
        setApiKey(null);
        throw e;
      }
    },
    [qc],
  );

  const signOut = useCallback(() => {
    setApiKey(null);
    setUser(null);
    setAuthenticated(false);
    setSessionExpired(false);
    setChat([]);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      authenticated,
      sessionExpired,
      roleKnown: !!user?.role,
      // Missing or unrecognised roles receive no privileged UI controls.
      isAdmin: user?.role === "admin",
      signIn,
      signOut,
      chat,
      setChat,
    }),
    [user, authenticated, sessionExpired, signIn, signOut, chat],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
