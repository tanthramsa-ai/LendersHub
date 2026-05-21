import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { getAllPayments, resetFailedPayments } from '../../db/database';
import { syncPendingPayments } from '../../db/syncService';
import { fmtCurrency, fmtDate, fmtTime } from '../../utils/format';
import { BRAND, SUCCESS, DANGER, WARNING, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';
import { PaymentRecord } from '../../types';

const METHOD_ICONS: Record<string, string> = {
  CASH: '💵',
  UPI: '📱',
  BANK_TRANSFER: '🏦',
  CHEQUE: '📝',
  NEFT: '🔄',
  RTGS: '⚡',
};

const STATUS_CONFIG = {
  pending: { label: 'Pending sync', color: WARNING, bg: '#FEF9C3' },
  synced: { label: 'Synced', color: SUCCESS, bg: '#D1FAE5' },
  failed: { label: 'Sync failed', color: DANGER, bg: '#FEE2E2' },
};

export default function PaymentHistoryScreen() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadPayments = useCallback(async () => {
    try {
      const all = await getAllPayments();
      setPayments(all);
    } catch {
      // SQLite unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPayments(); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await loadPayments();
    setRefreshing(false);
  }

  async function handleSyncAll() {
    setSyncing(true);
    try {
      const { synced, failed } = await syncPendingPayments();
      await loadPayments();
      Alert.alert('Sync complete', `Synced: ${synced}   Failed: ${failed}`);
    } catch {
      Alert.alert('Sync failed', 'Check your internet connection.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleRetryFailed() {
    setSyncing(true);
    try {
      await resetFailedPayments();
      const { synced, failed } = await syncPendingPayments();
      await loadPayments();
      Alert.alert('Retry complete', `Synced: ${synced}   Still failed: ${failed}`);
    } catch {
      Alert.alert('Error', 'Could not retry payments.');
    } finally {
      setSyncing(false);
    }
  }

  // ── Summary stats ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const todayPayments = payments.filter((p) => p.paymentDate === today);
  const todayTotal = todayPayments.reduce((s, p) => s + p.amount, 0);
  const pendingCount = payments.filter((p) => p.syncStatus === 'pending').length;
  const failedCount = payments.filter((p) => p.syncStatus === 'failed').length;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  const ListHeader = (
    <>
      {/* Summary card */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{fmtCurrency(todayTotal)}</Text>
            <Text style={styles.summaryLabel}>Collected Today</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{todayPayments.length}</Text>
            <Text style={styles.summaryLabel}>Transactions</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: payments.length > 0 ? SUCCESS : GRAY }]}>
              {payments.length}
            </Text>
            <Text style={styles.summaryLabel}>Total Records</Text>
          </View>
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: BRAND + '40', backgroundColor: BRAND + '08' }]}
          onPress={handleSyncAll}
          disabled={syncing || pendingCount === 0}
        >
          <Text style={styles.actionBtnIcon}>☁</Text>
          <Text style={[styles.actionBtnText, { color: BRAND }]}>
            {syncing ? 'Syncing…' : `Sync Pending (${pendingCount})`}
          </Text>
        </TouchableOpacity>
        {failedCount > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: DANGER + '40', backgroundColor: DANGER + '08' }]}
            onPress={handleRetryFailed}
            disabled={syncing}
          >
            <Text style={styles.actionBtnIcon}>🔄</Text>
            <Text style={[styles.actionBtnText, { color: DANGER }]}>
              Retry Failed ({failedCount})
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={payments}
        keyExtractor={(p) => p.id ?? p.createdAt}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyTitle}>No payment records yet</Text>
            <Text style={styles.emptySub}>Payments you record will appear here</Text>
          </View>
        }
        renderItem={({ item }) => <PaymentCard payment={item} />}
      />
    </View>
  );
}

function PaymentCard({ payment }: { payment: PaymentRecord }) {
  const sc = STATUS_CONFIG[payment.syncStatus];
  const icon = METHOD_ICONS[payment.paymentMethod] ?? '💳';

  return (
    <View style={styles.card}>
      <View style={[styles.methodIcon, { backgroundColor: BRAND + '12' }]}>
        <Text style={{ fontSize: 22 }}>{icon}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.customerName} numberOfLines={1}>
            {payment.customerName ?? payment.loanId}
          </Text>
          <Text style={styles.amount}>{fmtCurrency(payment.amount)}</Text>
        </View>
        <Text style={styles.meta}>
          {payment.paymentMethod.replace('_', ' ')}
          {payment.referenceNumber ? ` · ${payment.referenceNumber}` : ''}
        </Text>
        <View style={styles.cardBottom}>
          <Text style={styles.date}>
            {fmtDate(payment.paymentDate)}  {fmtTime(payment.createdAt)}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 30 },

  summaryCard: {
    backgroundColor: BRAND,
    margin: 12,
    borderRadius: 16,
    padding: 20,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: 20, fontWeight: '900', color: '#fff' },
  summaryLabel: { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 3, fontWeight: '600' },
  divider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.2)' },

  actionRow: { flexDirection: 'row', gap: 10, marginHorizontal: 12, marginBottom: 8 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: 12, paddingVertical: 11, borderWidth: 1.5,
  },
  actionBtnIcon: { fontSize: 16 },
  actionBtnText: { fontSize: 12, fontWeight: '700' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
    gap: 12,
  },
  methodIcon: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  customerName: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  amount: { fontSize: 16, fontWeight: '800', color: BRAND },
  meta: { fontSize: 11, color: GRAY, marginTop: 3 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  date: { fontSize: 11, color: GRAY },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 56 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptySub: { fontSize: 13, color: GRAY, marginTop: 6 },
});
