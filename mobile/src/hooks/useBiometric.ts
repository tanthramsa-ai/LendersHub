import { useState, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { BiometricCapability, BiometricAuthResult } from '../types';

export function useBiometric() {
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [loading, setLoading] = useState(false);

  const checkCapability = useCallback(async (): Promise<BiometricCapability> => {
    const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    const isPrimaryFace = supportedTypes.includes(
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    );
    const isPrimaryFingerprint = supportedTypes.includes(
      LocalAuthentication.AuthenticationType.FINGERPRINT,
    );

    const cap: BiometricCapability = {
      hasHardware,
      isEnrolled,
      supportedTypes,
      isPrimaryFace,
      isPrimaryFingerprint,
    };
    setCapability(cap);
    return cap;
  }, []);

  const authenticate = useCallback(
    async (promptMessage = 'Verify your identity'): Promise<BiometricAuthResult> => {
      setLoading(true);
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage,
          fallbackLabel: 'Use Password',
          disableDeviceFallback: true,
          cancelLabel: 'Cancel',
        });

        if (result.success) {
          return { success: true };
        }

        // Map expo error codes to our typed error union
        const error = result.error as string;
        if (error === 'user_cancel' || error === 'system_cancel' || error === 'app_cancel') {
          return { success: false, error: 'cancelled', message: 'Authentication cancelled' };
        }
        if (error === 'lockout') {
          return { success: false, error: 'lockout', message: 'Too many failed attempts. Try again in 30 seconds.' };
        }
        if (error === 'lockout_permanent') {
          return { success: false, error: 'lockout_permanent', message: 'Biometrics locked. Use your device PIN to unlock.' };
        }
        if (error === 'not_enrolled') {
          return { success: false, error: 'not_enrolled', message: 'No biometrics enrolled on this device.' };
        }
        if (error === 'not_available' || error === 'no_hardware') {
          return { success: false, error: 'unavailable', message: 'Biometric authentication is not available.' };
        }
        return { success: false, error: 'unknown', message: result.error ?? 'Authentication failed' };
      } catch {
        return { success: false, error: 'unavailable', message: 'Biometric authentication error.' };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const isAvailable = capability?.hasHardware && capability?.isEnrolled;

  return { capability, loading, checkCapability, authenticate, isAvailable };
}
