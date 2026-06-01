import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
  Switch, Animated,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { login, verifyLoginOtp, saveCredentials, loadCredentials, clearCredentials } from '../../api/auth';
import { getBiometricEnabled } from '../../api/client';
import { AgentSession } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { AuthStackParamList, FieldErrors, LoginMethod } from '../../types';
import { BRAND, ACCENT, GRAY, GRAY_BORDER, DANGER, SUCCESS, GRAY_LIGHT } from '../../utils/constants';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Login'>;
  route: RouteProp<AuthStackParamList, 'Login'>;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <Text style={styles.fieldError}>{message}</Text>;
}

export default function LoginScreen({ navigation, route }: Props) {
  const expiredSession = route.params?.expiredSession ?? false;

  const { setSession, loginMethod, setLoginMethod, fieldErrors, setFieldErrors, clearFieldErrors } =
    useAuthStore();

  const [subdomain, setSubdomain] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  // OTP step state
  const [otpPending, setOtpPending] = useState<{
    tempToken: string; maskedPhone: string;
  } | null>(null);
  const [otp, setOtp] = useState('');

  // Shake animation for error feedback
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    restoreCredentials();
    return () => clearFieldErrors();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreCredentials() {
    const creds = await loadCredentials();
    if (creds) {
      setSubdomain(creds.subdomain);
      setIdentifier(creds.identifier);
      setLoginMethod(creds.loginMethod);
      setRememberMe(true);
    }
  }

  function validate(): boolean {
    const errors: FieldErrors = {};
    const subdomainVal = subdomain.trim().toLowerCase();

    if (!subdomainVal) {
      errors.subdomain = 'Organisation is required';
    } else if (!/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(subdomainVal)) {
      errors.subdomain = 'Invalid organisation name (lowercase, hyphens only)';
    }

    if (!identifier.trim()) {
      errors.identifier =
        loginMethod === 'email' ? 'Email address is required' : 'Phone number is required';
    } else if (loginMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) {
      errors.identifier = 'Enter a valid email address';
    } else if (loginMethod === 'phone' && !/^[+\d\s\-]{7,15}$/.test(identifier.trim())) {
      errors.identifier = 'Enter a valid phone number';
    }

    if (!password) {
      errors.password = 'Password is required';
    } else if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function shake() {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  async function handleLogin() {
    setServerError('');
    if (!validate()) { shake(); return; }
    setLoading(true);
    try {
      const result = await login(identifier.trim(), password, subdomain.trim(), loginMethod);

      if (result.type === 'otp') {
        setOtpPending({ tempToken: result.tempToken, maskedPhone: result.maskedPhone });
        setOtp('');
        return;
      }

      await finishLogin(result.session);
    } catch (err) {
      const msg = (err as Error & { statusCode?: number }).message;
      setServerError(msg ?? 'Login failed. Please try again.');
      shake();
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otpPending) return;
    if (otp.length !== 6) { setServerError('Enter the 6-digit OTP'); shake(); return; }
    setServerError('');
    setLoading(true);
    try {
      const session = await verifyLoginOtp(otpPending.tempToken, otp);
      await finishLogin(session);
    } catch (err) {
      const msg = (err as Error & { statusCode?: number }).message;
      setServerError(msg ?? 'Invalid or expired OTP. Try again.');
      shake();
    } finally {
      setLoading(false);
    }
  }

  async function finishLogin(session: AgentSession) {
    if (rememberMe) {
      await saveCredentials({ subdomain: subdomain.trim().toLowerCase(), identifier: identifier.trim(), loginMethod });
    } else {
      await clearCredentials();
    }
    setSession(session);
    const alreadyEnabled = await getBiometricEnabled();
    if (alreadyEnabled) {
      navigation.getParent()?.reset({ index: 0, routes: [{ name: 'Main' }] });
    } else {
      navigation.replace('BiometricSetup');
    }
  }

  function switchMethod(method: LoginMethod) {
    setLoginMethod(method);
    setIdentifier('');
    clearFieldErrors();
    setServerError('');
  }

  const inputBorder = (field: keyof FieldErrors) =>
    fieldErrors[field] ? DANGER : GRAY_BORDER;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

      {/* Brand header */}
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>LH</Text>
        </View>
        <Text style={styles.appTitle}>LendersHub Agent</Text>
        <Text style={styles.appSubtitle}>Field Collection App</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Expired session banner */}
        {expiredSession && (
          <View style={styles.expiredBanner}>
            <Text style={styles.expiredIcon}>⚠</Text>
            <Text style={styles.expiredText}>
              Your session expired. Please sign in again.
            </Text>
          </View>
        )}

        {/* Server error banner */}
        {!!serverError && (
          <Animated.View
            style={[styles.errorBanner, { transform: [{ translateX: shakeAnim }] }]}
          >
            <Text style={styles.errorBannerText}>{serverError}</Text>
          </Animated.View>
        )}

        <Text style={styles.formHeading}>Sign in to your account</Text>

        {/* Organisation */}
        <Text style={styles.label}>Organisation</Text>
        <TextInput
          style={[styles.input, { borderColor: inputBorder('subdomain') }]}
          placeholder="your-company"
          placeholderTextColor={GRAY}
          value={subdomain}
          onChangeText={(v) => { setSubdomain(v); clearFieldErrors(); }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />
        <FieldError message={fieldErrors.subdomain} />

        {/* Login method toggle */}
        <View style={styles.methodRow}>
          <TouchableOpacity
            style={[styles.methodBtn, loginMethod === 'email' && styles.methodBtnActive]}
            onPress={() => switchMethod('email')}
          >
            <Text style={[styles.methodBtnText, loginMethod === 'email' && styles.methodBtnTextActive]}>
              Email
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.methodBtn, loginMethod === 'phone' && styles.methodBtnActive]}
            onPress={() => switchMethod('phone')}
          >
            <Text style={[styles.methodBtnText, loginMethod === 'phone' && styles.methodBtnTextActive]}>
              Phone
            </Text>
          </TouchableOpacity>
        </View>

        {/* Identifier field */}
        <Text style={styles.label}>
          {loginMethod === 'email' ? 'Email Address' : 'Phone Number'}
        </Text>
        <TextInput
          style={[styles.input, { borderColor: inputBorder('identifier') }]}
          placeholder={loginMethod === 'email' ? 'agent@company.com' : '+91 98765 43210'}
          placeholderTextColor={GRAY}
          value={identifier}
          onChangeText={(v) => { setIdentifier(v); clearFieldErrors(); }}
          keyboardType={loginMethod === 'email' ? 'email-address' : 'phone-pad'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />
        <FieldError message={fieldErrors.identifier} />

        {/* Password */}
        <Text style={styles.label}>Password</Text>
        <View style={[styles.passwordRow, { borderColor: inputBorder('password') }]}>
          <TextInput
            style={styles.passwordInput}
            placeholder="••••••••"
            placeholderTextColor={GRAY}
            value={password}
            onChangeText={(v) => { setPassword(v); clearFieldErrors(); }}
            secureTextEntry={!showPass}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPass((s) => !s)}>
            <Text style={styles.eyeIcon}>{showPass ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        </View>
        <FieldError message={fieldErrors.password} />

        {/* Remember me */}
        <View style={styles.rememberRow}>
          <Switch
            value={rememberMe}
            onValueChange={setRememberMe}
            trackColor={{ false: GRAY_BORDER, true: BRAND }}
            thumbColor="#fff"
            ios_backgroundColor={GRAY_BORDER}
          />
          <Text style={styles.rememberLabel}>Remember my details</Text>
        </View>

        {/* ── OTP step (shown after credentials verified) ── */}
        {otpPending && (
          <View style={styles.otpCard}>
            <Text style={styles.otpTitle}>Enter OTP</Text>
            <Text style={styles.otpSub}>
              A 6-digit code was sent to {otpPending.maskedPhone}
            </Text>
            <TextInput
              style={styles.otpInput}
              value={otp}
              onChangeText={(v) => { setOtp(v.replace(/\D/g, '').slice(0, 6)); setServerError(''); }}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor={GRAY}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
              onPress={handleVerifyOtp}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Verify OTP</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setOtpPending(null); setOtp(''); setServerError(''); }} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ color: BRAND, fontSize: 13, fontWeight: '600' }}>← Back to login</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sign in button — hidden during OTP step */}
        {!otpPending && (
          <TouchableOpacity
            style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
        )}

        <Text style={styles.hint}>
          Contact your manager if you don't have login credentials.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: {
    backgroundColor: BRAND,
    paddingTop: 70,
    paddingBottom: 40,
    alignItems: 'center',
  },
  logo: {
    width: 68,
    height: 68,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  logoText: { fontSize: 24, fontWeight: '900', color: BRAND },
  appTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
  appSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 4 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 48 },

  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  expiredIcon: { fontSize: 16 },
  expiredText: { flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 },

  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorBannerText: { color: '#991B1B', fontSize: 13, lineHeight: 18 },

  formHeading: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 20 },

  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  fieldError: { fontSize: 12, color: DANGER, marginTop: 4, marginBottom: 8, marginLeft: 2 },

  methodRow: {
    flexDirection: 'row',
    backgroundColor: GRAY_LIGHT,
    borderRadius: 10,
    padding: 4,
    marginBottom: 16,
    marginTop: 4,
    gap: 4,
  },
  methodBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  methodBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  methodBtnText: { fontSize: 14, fontWeight: '600', color: GRAY },
  methodBtnTextActive: { color: BRAND },

  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    backgroundColor: '#FAFAFA',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  eyeBtn: { padding: 12 },
  eyeIcon: { fontSize: 16 },

  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
    gap: 10,
  },
  rememberLabel: { fontSize: 14, color: '#374151' },

  loginBtn: {
    backgroundColor: BRAND,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  hint: { textAlign: 'center', color: GRAY, fontSize: 12, marginTop: 20, lineHeight: 18 },

  otpCard: {
    backgroundColor: '#F0F7FF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: BRAND + '40',
    padding: 20,
    marginBottom: 16,
  },
  otpTitle: { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 6 },
  otpSub: { fontSize: 13, color: GRAY, marginBottom: 16, lineHeight: 18 },
  otpInput: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 12,
    textAlign: 'center',
    borderWidth: 2,
    borderColor: BRAND,
    borderRadius: 14,
    paddingVertical: 14,
    color: '#111827',
    backgroundColor: '#fff',
    marginBottom: 16,
  },
});
