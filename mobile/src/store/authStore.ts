import { create } from 'zustand';
import { AgentSession } from '../types';

interface AuthState {
  session: AgentSession | null;
  isAuthenticated: boolean;
  isBiometricUnlocked: boolean;
  setSession: (session: AgentSession | null) => void;
  setBiometricUnlocked: (unlocked: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isAuthenticated: false,
  isBiometricUnlocked: false,

  setSession: (session) =>
    set({ session, isAuthenticated: session !== null }),

  setBiometricUnlocked: (unlocked) =>
    set({ isBiometricUnlocked: unlocked }),

  logout: () =>
    set({ session: null, isAuthenticated: false, isBiometricUnlocked: false }),
}));
