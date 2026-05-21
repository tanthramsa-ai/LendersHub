import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { loadSession, isTokenExpired, getBiometricEnabled } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { RootStackParamList } from '../../types';
import { BRAND, BRAND_DARK } from '../../utils/constants';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Splash'> };

export default function SplashScreen({ navigation }: Props) {
  const { setSession, setBiometricEnabled, setAppInitState } = useAuthStore();

  useEffect(() => {
    bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    try {
      const [session, bioEnabled] = await Promise.all([
        loadSession(),
        getBiometricEnabled(),
      ]);

      setBiometricEnabled(bioEnabled);

      if (!session) {
        // No stored session → go to login
        navigation.replace('Auth');
        return;
      }

      if (isTokenExpired(session.token)) {
        // Token expired → go to login with banner
        navigation.replace('Auth', { screen: 'Login', params: { expiredSession: true } } as never);
        return;
      }

      // Valid session exists
      setSession(session);

      if (bioEnabled) {
        // Has biometric enabled → prompt unlock
        navigation.replace('Auth', { screen: 'Biometric' } as never);
      } else {
        // Skip biometric → go straight to app
        navigation.replace('Main');
      }
    } catch {
      navigation.replace('Auth');
    } finally {
      setAppInitState('ready');
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.logo}>
        <Text style={styles.logoText}>LH</Text>
      </View>
      <Text style={styles.appName}>LendersHub</Text>
      <Text style={styles.tagline}>Agent Collection App</Text>
      <ActivityIndicator
        color="rgba(255,255,255,0.7)"
        size="small"
        style={styles.spinner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  logoText: { fontSize: 32, fontWeight: '900', color: BRAND },
  appName: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  tagline: { fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 6, letterSpacing: 0.3 },
  spinner: { marginTop: 48 },
});
