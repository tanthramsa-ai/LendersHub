import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiRequest } from '../api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function registerPushToken(): Promise<string | null> {
  const granted = await requestNotificationPermission();
  if (!granted) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('collections', {
      name: 'Collection Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0F4C81',
    });
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    // Register with backend (best-effort)
    await apiRequest('/api/v1/tenant/agent/push-token', {
      method: 'POST',
      body: JSON.stringify({ token, platform: Platform.OS }),
    }).catch(() => {});
    return token;
  } catch {
    return null;
  }
}

export async function scheduleDailyReminder(): Promise<void> {
  // Cancel existing to avoid duplicates
  await Notifications.cancelAllScheduledNotificationsAsync();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Today's collections ready 📋",
      body: 'Open the app to see your collection targets for today.',
      sound: true,
      data: { screen: 'Collections' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
    },
  });
}

export function addNotificationListener(
  onTap: (screen: string) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const screen = response.notification.request.content.data?.screen as string | undefined;
    if (screen) onTap(screen);
  });
}
