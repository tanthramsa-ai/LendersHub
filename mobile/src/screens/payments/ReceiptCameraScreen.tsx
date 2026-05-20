import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert } from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { CollectionsStackParamList } from '../../types';
import { BRAND, ACCENT } from '../../utils/constants';

type Props = {
  navigation: NativeStackNavigationProp<CollectionsStackParamList, 'ReceiptCamera'>;
  route: RouteProp<CollectionsStackParamList, 'ReceiptCamera'>;
};

export default function ReceiptCameraScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.permissionTitle}>Camera Access Needed</Text>
        <Text style={styles.permissionText}>
          We need camera access to capture payment receipts.
        </Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  async function handleCapture() {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) setCapturedUri(photo.uri);
    } catch {
      Alert.alert('Error', 'Failed to capture photo.');
    }
  }

  function handleRetake() {
    setCapturedUri(null);
  }

  function handleConfirm() {
    // In production: upload capturedUri to backend or attach to payment
    Alert.alert('Receipt saved', 'Receipt captured and attached to this payment.');
    navigation.goBack();
  }

  if (capturedUri) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <Image source={{ uri: capturedUri }} style={styles.preview} resizeMode="contain" />
        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
            <Text style={styles.retakeBtnText}>↩ Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
            <Text style={styles.confirmBtnText}>✓ Use Photo</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Capture Receipt</Text>
          <TouchableOpacity
            style={styles.flipBtn}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
          >
            <Text style={styles.flipBtnText}>⇄</Text>
          </TouchableOpacity>
        </View>

        {/* Guide frame */}
        <View style={styles.guideFrame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {/* Bottom bar */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.captureBtn} onPress={handleCapture}>
            <View style={styles.captureInner} />
          </TouchableOpacity>
          <Text style={styles.captureHint}>Align receipt within the frame</Text>
        </View>
      </CameraView>
    </View>
  );
}

const CORNER_SIZE = 24;
const cornerBase: object = {
  position: 'absolute' as const,
  width: CORNER_SIZE,
  height: CORNER_SIZE,
  borderColor: '#fff',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  permissionScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  permissionTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 12 },
  permissionText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  permissionBtn: { backgroundColor: BRAND, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 },
  permissionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  closeBtn: { padding: 8 },
  closeBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  topBarTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  flipBtn: { padding: 8 },
  flipBtnText: { color: '#fff', fontSize: 22 },
  guideFrame: {
    width: 280,
    height: 180,
    alignSelf: 'center',
    marginTop: 40,
    position: 'relative',
  },
  corner: { ...cornerBase, borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  bottomBar: { position: 'absolute', bottom: 50, left: 0, right: 0, alignItems: 'center' },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  captureHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  preview: { flex: 1 },
  previewActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    backgroundColor: '#000',
  },
  retakeBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
  },
  retakeBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  confirmBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: ACCENT,
    alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
