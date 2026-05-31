import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { recordPaymentOnline } from '../../api/collections';
import { saveOfflinePayment } from '../../db/database';
import { useCollectionStore } from '../../store/collectionStore';
import { fmtCurrency } from '../../utils/format';
import { BRAND, SUCCESS, DANGER, GRAY, GRAY_BORDER, GRAY_LIGHT, PAYMENT_METHODS } from '../../utils/constants';
import { CollectionsStackParamList, PaymentRecord } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<CollectionsStackParamList, 'PaymentCapture'>;
  route: RouteProp<CollectionsStackParamList, 'PaymentCapture'>;
};

export default function PaymentCaptureScreen({ navigation, route }: Props) {
  const { item } = route.params;
  const { markItemCollected, pendingReceiptUri, setPendingReceiptUri } = useCollectionStore();

  const balanceDue = item.amountDue - item.paidAmount;
  const [amount, setAmount] = useState(String(balanceDue));
  const [method, setMethod] = useState<PaymentRecord['paymentMethod']>('CASH');
  const [reference, setReference] = useState('');
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Consume receipt photo only if it belongs to this specific installment
  useEffect(() => {
    if (
      pendingReceiptUri &&
      pendingReceiptUri.loanId === item.loanId &&
      pendingReceiptUri.installmentId === item.installmentId
    ) {
      setReceiptUri(pendingReceiptUri.uri);
      setPendingReceiptUri(null);
    }
  }, [pendingReceiptUri]);

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid payment amount.');
      return;
    }
    if (amt > balanceDue) {
      Alert.alert('Over payment', `Amount exceeds balance due of ${fmtCurrency(balanceDue)}.`);
      return;
    }

    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const paymentData = {
      loanId: item.loanId,
      installmentId: item.installmentId,
      customerName: item.customerName,
      amount: amt,
      paymentMethod: method,
      referenceNumber: reference.trim() || undefined,
      paymentDate: today,
      receiptUri: receiptUri ?? undefined,
    };

    try {
      await recordPaymentOnline(paymentData);
      markItemCollected(item.id, amt);
      Alert.alert('Payment recorded ✓', `${fmtCurrency(amt)} collected from ${item.customerName}.`, [
        { text: 'Done', onPress: () => navigation.goBack() },
      ]);
    } catch {
      await saveOfflinePayment({
        id: `offline_${Date.now()}`,
        ...paymentData,
        syncStatus: 'pending',
        createdAt: new Date().toISOString(),
      });
      markItemCollected(item.id, amt);
      Alert.alert(
        'Saved offline ☁',
        'Payment saved locally and will sync when you have internet.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Summary ── */}
        <View style={styles.summary}>
          <View style={styles.summaryAvatar}>
            <Text style={styles.summaryAvatarText}>
              {item.customerName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.summaryName}>{item.customerName}</Text>
            <Text style={styles.summarySub}>{item.loanNumber} · EMI #{item.installmentNumber}</Text>
          </View>
        </View>

        {/* ── Balance due ── */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Balance Due</Text>
          <Text style={styles.balanceAmount}>{fmtCurrency(balanceDue)}</Text>
          {item.paidAmount > 0 && (
            <Text style={styles.balancePaid}>Already paid: {fmtCurrency(item.paidAmount)}</Text>
          )}
          {item.status === 'OVERDUE' && item.daysOverdue ? (
            <View style={styles.overduePill}>
              <Text style={styles.overdueText}>⚠ {item.daysOverdue} days overdue</Text>
            </View>
          ) : null}
        </View>

        {/* ── Amount input ── */}
        <View style={styles.section}>
          <Text style={styles.label}>Payment Amount (₹) *</Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={GRAY}
          />
          <View style={styles.quickFill}>
            {[25, 50, 75, 100].map((pct) => (
              <TouchableOpacity
                key={pct}
                style={styles.quickBtn}
                onPress={() => setAmount(String(Math.round(balanceDue * pct / 100)))}
              >
                <Text style={styles.quickBtnText}>{pct}%</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Payment method ── */}
        <View style={styles.section}>
          <Text style={styles.label}>Payment Method *</Text>
          <View style={styles.methodGrid}>
            {PAYMENT_METHODS.map((m) => (
              <TouchableOpacity
                key={m.value}
                style={[styles.methodBtn, method === m.value && styles.methodBtnActive]}
                onPress={() => setMethod(m.value)}
              >
                <Text style={[styles.methodText, method === m.value && styles.methodTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Reference number (non-cash) ── */}
        {method !== 'CASH' && (
          <View style={styles.section}>
            <Text style={styles.label}>Reference Number</Text>
            <TextInput
              style={styles.input}
              value={reference}
              onChangeText={setReference}
              placeholder="UTR / Cheque / Transaction ID"
              placeholderTextColor={GRAY}
              autoCapitalize="characters"
            />
          </View>
        )}

        {/* ── Receipt camera ── */}
        {receiptUri ? (
          <View style={styles.receiptPreviewCard}>
            <Image source={{ uri: receiptUri }} style={styles.receiptThumb} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={styles.receiptAttached}>✓ Receipt attached</Text>
              <TouchableOpacity
                onPress={() =>
                  navigation.navigate('ReceiptCamera', { loanId: item.loanId, installmentId: item.installmentId })
                }
              >
                <Text style={styles.receiptRetake}>Retake photo</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setReceiptUri(null)}>
              <Text style={{ color: DANGER, fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.receiptBtn}
            onPress={() =>
              navigation.navigate('ReceiptCamera', { loanId: item.loanId, installmentId: item.installmentId })
            }
          >
            <Text style={styles.receiptBtnText}>📷  Capture Receipt (optional)</Text>
          </TouchableOpacity>
        )}

        {/* ── Submit ── */}
        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>
              Confirm Payment  {fmtCurrency(parseFloat(amount) || 0)}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  summary: {
    backgroundColor: '#fff',
    margin: 14,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  summaryAvatar: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center',
  },
  summaryAvatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  summaryName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  summarySub: { fontSize: 12, color: GRAY, marginTop: 2 },

  balanceCard: {
    backgroundColor: BRAND,
    marginHorizontal: 14,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 14,
  },
  balanceLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '500' },
  balanceAmount: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  balancePaid: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4 },
  overduePill: {
    marginTop: 10,
    backgroundColor: 'rgba(239,68,68,0.3)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  overdueText: { color: '#FCA5A5', fontSize: 12, fontWeight: '700' },

  section: {
    backgroundColor: '#fff',
    marginHorizontal: 14,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  amountInput: {
    fontSize: 34,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    borderWidth: 2,
    borderColor: BRAND + '40',
    borderRadius: 12,
    paddingVertical: 16,
    backgroundColor: BRAND + '06',
  },
  quickFill: { flexDirection: 'row', gap: 8, marginTop: 10 },
  quickBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    backgroundColor: GRAY_LIGHT, alignItems: 'center',
  },
  quickBtnText: { fontSize: 12, fontWeight: '700', color: GRAY },

  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  methodBtn: {
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1.5,
    borderColor: GRAY_BORDER, backgroundColor: '#FAFAFA',
  },
  methodBtnActive: { borderColor: BRAND, backgroundColor: BRAND + '10' },
  methodText: { fontSize: 13, color: GRAY, fontWeight: '500' },
  methodTextActive: { color: BRAND, fontWeight: '700' },

  input: {
    borderWidth: 1.5, borderColor: GRAY_BORDER, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: '#111827', backgroundColor: '#FAFAFA',
  },

  receiptBtn: {
    marginHorizontal: 14, borderRadius: 16,
    paddingVertical: 14, alignItems: 'center',
    borderWidth: 2, borderStyle: 'dashed',
    borderColor: GRAY_BORDER, marginBottom: 12,
  },
  receiptBtnText: { color: GRAY, fontWeight: '600', fontSize: 14 },

  receiptPreviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 14,
    marginBottom: 12,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1.5,
    borderColor: SUCCESS + '60',
    gap: 12,
  },
  receiptThumb: { width: 56, height: 56, borderRadius: 10 },
  receiptAttached: { fontSize: 13, fontWeight: '700', color: SUCCESS },
  receiptRetake: { fontSize: 12, color: BRAND, marginTop: 4, fontWeight: '600' },

  submitBtn: {
    backgroundColor: BRAND, marginHorizontal: 14,
    borderRadius: 16, paddingVertical: 18, alignItems: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
