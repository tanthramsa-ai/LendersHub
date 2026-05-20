import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../../store/authStore';
import { BRAND, BRAND_LIGHT, GRAY } from '../../utils/constants';

export default function BiometricScreen() {
  const { session, setBiometricUnlocked, setSession } = useAuthStore();
  const [supported, setSupported] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkBiometric();
  }, []);

  async function checkBiometric() {
    const hasHW = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setSupported(hasHW && enrolled);
    setChecking(false);
    if (hasHW && enrolled) {
      authenticate();
    }
  }

  async function authenticate() {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock LendersHub Agent',
        fallbackLabel: 'Use Password',
        disableDeviceFallback: false,
      });
      if (result.success) {
        setBiometricUnlocked(true);
      } else {
        Alert.alert('Authentication failed', 'Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Biometric authentication unavailable.');
    }
  }

  function handleSkip() {
    setBiometricUnlocked(true);
  }

  function handleLogout() {
    setSession(null);
  }

  if (checking) return null;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <View style={styles.top}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>LH</Text>
        </View>
        <Text style={styles.title}>Welcome back,</Text>
        <Text style={styles.name}>{session?.user.firstName} {session?.user.lastName}</Text>
        <Text style={styles.org}>{session?.tenant.companyName}</Text>
      </View>

      <View style={styles.center}>
        {supported ? (
          <>
            <TouchableOpacity style={styles.biometricBtn} onPress={authenticate}>
              <Text style={styles.biometricIcon}>👆</Text>
            </TouchableOpacity>
            <Text style={styles.biometricLabel}>Tap to unlock with biometrics</Text>
          </>
        ) : (
          <Text style={styles.notSupported}>Biometric auth not available on this device</Text>
        )}
      </View>

      <View style={styles.bottom}>
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign in with different account</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 32 },
  top: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoText: { fontSize: 26, fontWeight: '900', color: '#fff' },
  title: { fontSize: 18, color: '#6B7280', fontWeight: '500' },
  name: { fontSize: 26, fontWeight: '800', color: '#111827', marginTop: 4 },
  org: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  biometricBtn: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: BRAND_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  biometricIcon: { fontSize: 44 },
  biometricLabel: { color: GRAY, fontSize: 14, textAlign: 'center' },
  notSupported: { color: GRAY, textAlign: 'center', lineHeight: 22 },
  bottom: { paddingBottom: 50, alignItems: 'center', gap: 12 },
  skipBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  skipText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  logoutBtn: { marginTop: 8 },
  logoutText: { color: GRAY, fontSize: 13 },
});
