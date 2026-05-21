import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useBiometric } from '../../hooks/useBiometric';
import { clearSession } from '../../api/auth';
import { useAuthStore } from '../../store/authStore';
import { AuthStackParamList, BiometricAuthResult } from '../../types';
import { BRAND, BRAND_LIGHT, GRAY, DANGER, WARNING } from '../../utils/constants';

type Props = { navigation: NativeStackNavigationProp<AuthStackParamList, 'Biometric'> };

const LOCKOUT_SECONDS = 30;

export default function BiometricScreen({ navigation }: Props) {
  const { session, setBiometricUnlocked, logout } = useAuthStore();
  const { capability, checkCapability, authenticate, loading } = useBiometric();

  const [errorMsg, setErrorMsg] = useState('');
  const [errorType, setErrorType] = useState<Extract<BiometricAuthResult, { success: false }>['error'] | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const lockoutRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulse animation for biometric button
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseAnim]);

  useEffect(() => {
    init();
    return () => {
      if (lockoutRef.current) clearInterval(lockoutRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init() {
    const cap = await checkCapability();
    if (cap.hasHardware && cap.isEnrolled) {
      startPulse();
      triggerAuth();
    }
  }

  async function triggerAuth() {
    const name = session?.user.firstName ?? 'Agent';
    const result = await authenticate(`Unlock LendersHub for ${name}`);

    if (result.success) {
      setBiometricUnlocked(true);
      // Navigate to Main — the navigation will be handled by the root navigator
      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
      return;
    }

    setErrorType(result.error);
    setErrorMsg(result.message);

    if (result.error === 'lockout') {
      startLockoutTimer();
    }
  }

  function startLockoutTimer() {
    setLockoutRemaining(LOCKOUT_SECONDS);
    lockoutRef.current = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          if (lockoutRef.current) clearInterval(lockoutRef.current);
          setErrorMsg('');
          setErrorType(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSignOut() {
    await clearSession();
    logout();
    navigation.replace('Login');
  }

  function handleUsePassword() {
    navigation.replace('Login');
  }

  const isLocked = errorType === 'lockout' || errorType === 'lockout_permanent';
  const isPermanentLockout = errorType === 'lockout_permanent';
  const canRetry = !isLocked && !loading && capability?.hasHardware && capability?.isEnrolled;

  const isFace = capability?.isPrimaryFace && !capability?.isPrimaryFingerprint;
  const biometricIcon = isFace ? '😶' : '👆';
  const biometricLabel = isFace ? 'Face ID' : 'Fingerprint';
  const promptLabel = isFace
    ? 'Tap to unlock with Face ID'
    : 'Tap to unlock with fingerprint';

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      {/* User greeting */}
      <View style={styles.top}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>LH</Text>
        </View>
        <Text style={styles.greeting}>Welcome back,</Text>
        <Text style={styles.name}>
          {session?.user.firstName} {session?.user.lastName}
        </Text>
        <Text style={styles.org}>{session?.tenant.companyName}</Text>
      </View>

      {/* Biometric button */}
      <View style={styles.center}>
        {capability?.hasHardware && capability?.isEnrolled ? (
          <>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={[
                  styles.biometricBtn,
                  isLocked && styles.biometricBtnLocked,
                ]}
                onPress={canRetry ? triggerAuth : undefined}
                disabled={!canRetry}
                activeOpacity={0.8}
              >
                <Text style={styles.biometricIcon}>{biometricIcon}</Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Prompt / error message */}
            {!errorMsg ? (
              <Text style={styles.promptLabel}>{promptLabel}</Text>
            ) : (
              <View style={styles.errorBox}>
                <Text style={[
                  styles.errorText,
                  isPermanentLockout && { color: DANGER },
                ]}>
                  {errorMsg}
                </Text>
                {errorType === 'lockout' && lockoutRemaining > 0 && (
                  <Text style={styles.countdownText}>
                    Retry in {lockoutRemaining}s
                  </Text>
                )}
              </View>
            )}

            {/* Retry button after transient failure */}
            {errorMsg && !isLocked && (
              <TouchableOpacity style={styles.retryBtn} onPress={triggerAuth}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.unavailableBox}>
            <Text style={styles.unavailableText}>
              {!capability?.hasHardware
                ? 'This device does not support biometric authentication.'
                : `No ${biometricLabel} enrolled. Please set it up in device settings.`}
            </Text>
          </View>
        )}
      </View>

      {/* Bottom actions */}
      <View style={styles.bottom}>
        {!isPermanentLockout && (
          <TouchableOpacity style={styles.passwordBtn} onPress={handleUsePassword}>
            <Text style={styles.passwordBtnText}>Use Password Instead</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutBtnText}>Sign in with different account</Text>
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  logoText: { fontSize: 26, fontWeight: '900', color: '#fff' },
  greeting: { fontSize: 16, color: GRAY, fontWeight: '500' },
  name: { fontSize: 26, fontWeight: '800', color: '#111827', marginTop: 4, textAlign: 'center' },
  org: { fontSize: 14, color: GRAY, marginTop: 4 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  biometricBtn: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: BRAND_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: `${BRAND}22`,
  },
  biometricBtnLocked: {
    backgroundColor: '#FEF2F2',
    borderColor: `${DANGER}33`,
  },
  biometricIcon: { fontSize: 44 },
  promptLabel: { color: GRAY, fontSize: 14, textAlign: 'center' },

  errorBox: { alignItems: 'center', marginTop: 4, paddingHorizontal: 16 },
  errorText: { color: WARNING, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  countdownText: { color: GRAY, fontSize: 12, marginTop: 6 },

  retryBtn: {
    marginTop: 20,
    backgroundColor: BRAND,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  unavailableBox: { padding: 20, alignItems: 'center' },
  unavailableText: { color: GRAY, textAlign: 'center', lineHeight: 22, fontSize: 14 },

  bottom: { paddingBottom: 50, alignItems: 'center', gap: 12 },
  passwordBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
  },
  passwordBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  signOutBtn: { marginTop: 4 },
  signOutBtnText: { color: GRAY, fontSize: 13 },
});
