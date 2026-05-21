import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './src/navigation';
import { syncPendingPayments } from './src/db/syncService';
import {
  registerPushToken,
  scheduleDailyReminder,
  addNotificationListener,
} from './src/services/pushNotifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

export default function App() {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Sync offline payments whenever app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        syncPendingPayments().catch(() => {});
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, []);

  // Push notifications setup
  useEffect(() => {
    registerPushToken().catch(() => {});
    scheduleDailyReminder().catch(() => {});

    const sub = addNotificationListener((_screen) => {
      // Navigation from notification tap handled here in future
    });
    return () => sub.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppNavigator />
    </QueryClientProvider>
  );
}
