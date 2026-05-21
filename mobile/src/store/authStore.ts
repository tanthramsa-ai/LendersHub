import { create } from 'zustand';
import { AgentSession, AppInitState, LoginMethod, FieldErrors } from '../types';

interface AuthState {
  // Session
  session: AgentSession | null;
  isAuthenticated: boolean;
  isBiometricUnlocked: boolean;

  // App lifecycle
  appInitState: AppInitState;

  // Login form persistence
  biometricEnabled: boolean;
  loginMethod: LoginMethod;
  fieldErrors: FieldErrors;

  // Actions
  setSession: (session: AgentSession | null) => void;
  setBiometricUnlocked: (unlocked: boolean) => void;
  setAppInitState: (state: AppInitState) => void;
  setBiometricEnabled: (enabled: boolean) => void;
  setLoginMethod: (method: LoginMethod) => void;
  setFieldErrors: (errors: FieldErrors) => void;
  clearFieldErrors: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isAuthenticated: false,
  isBiometricUnlocked: false,
  appInitState: 'initializing',
  biometricEnabled: false,
  loginMethod: 'email',
  fieldErrors: {},

  setSession: (session) =>
    set({ session, isAuthenticated: session !== null }),

  setBiometricUnlocked: (unlocked) =>
    set({ isBiometricUnlocked: unlocked }),

  setAppInitState: (state) =>
    set({ appInitState: state }),

  setBiometricEnabled: (enabled) =>
    set({ biometricEnabled: enabled }),

  setLoginMethod: (method) =>
    set({ loginMethod: method }),

  setFieldErrors: (errors) =>
    set({ fieldErrors: errors }),

  clearFieldErrors: () =>
    set({ fieldErrors: {} }),

  logout: () =>
    set({
      session: null,
      isAuthenticated: false,
      isBiometricUnlocked: false,
      fieldErrors: {},
    }),
}));
