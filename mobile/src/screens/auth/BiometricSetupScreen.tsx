import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useBiometric } from '../../hooks/useBiometric';
import { setBiometricEnabled } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { AuthStackParamList } from '../../types';
import { BRAND, BRAND_LIGHT, GRAY, GRAY_LIGHT, SUCCESS } from '../../utils/constants';

type Props = { navigation: NativeStackNavigationProp<AuthStackParamList, 'BiometricSetup'> };

export default function BiometricSetupScreen({ navigation }: Props) {
  const { session, setBiometricEnabled: setStoreEnabled } = useAuthStore();
  const { capability, checkCapability } = useBiometric();
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkCapability().finally(() => setChecking(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable() {
    setSaving(true);
    try {
      await setBiometricEnabled(true);
      setStoreEnabled(true);
    } finally {
      setSaving(false);
      goToMain();
    }
  }

  async function handleSkip() {
    await setBiometricEnabled(false);
    setStoreEnabled(false);
    goToMain();
  }

  function goToMain() {
    navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
  }

  // Move the "no biometric hardware" navigation into a useEffect to avoid
  // calling navigation during the render phase (React rule violation)
  useEffect(() => {
    if (!checking && (!capability?.hasHardware || !capability?.isEnrolled)) {
      goToMain();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, capability]);

  if (checking || !capability?.hasHardware || !capability?.isEnrolled) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color={BRAND} />
      </View>
    );
  }

  const isFace = capability.isPrimaryFace && !capability.isPrimaryFingerprint;
  const biometricName = isFace ? 'Face ID' : 'Fingerprint';
  const biometricIcon = isFace ? '😶' : '👆';

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>{biometricIcon}</Text>
        </View>

        <Text style={styles.title}>Enable {biometricName}?</Text>
        <Text style={styles.description}>
          Sign in faster next time using {biometricName}. Your credentials stay securely
          stored on this device.
        </Text>

        {/* Feature bullets */}
        <View style={styles.featureList}>
          {[
            `Instant unlock with ${biometricName}`,
            'Your data never leaves this device',
            'Disable anytime from your profile',
          ].map((item) => (
            <View key={item} style={styles.featureItem}>
              <View style={styles.featureDot} />
              <Text style={styles.featureText}>{item}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.welcome}>
          Welcome, {session?.user.firstName}!
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.enableBtn, saving && { opacity: 0.7 }]}
          onPress={handleEnable}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.enableBtnText}>Enable {biometricName}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={saving}>
          <Text style={styles.skipBtnText}>Maybe Later</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 32 },

  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: BRAND_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    borderWidth: 2,
    borderColor: `${BRAND}22`,
  },
  iconText: { fontSize: 52 },

  title: { fontSize: 24, fontWeight: '800', color: '#111827', textAlign: 'center' },
  description: {
    fontSize: 15,
    color: GRAY,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 28,
  },

  featureList: { width: '100%', gap: 10, marginBottom: 32 },
  featureItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SUCCESS,
  },
  featureText: { fontSize: 14, color: '#374151', flex: 1 },

  welcome: { fontSize: 14, color: GRAY, fontStyle: 'italic' },

  actions: { paddingBottom: 52, gap: 12 },
  enableBtn: {
    backgroundColor: BRAND,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  enableBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  skipBtn: {
    backgroundColor: GRAY_LIGHT,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  skipBtnText: { color: GRAY, fontSize: 15, fontWeight: '600' },
});
