import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation, CompositeNavigationProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../../store/authStore';
import { useCollectionStore } from '../../store/collectionStore';
import { fetchTodayCollections, fetchOverdueCollections } from '../../api/collections';
import { syncPendingPayments } from '../../db/syncService';
import { fmtCurrency, fmtDate } from '../../utils/format';
import { BRAND, ACCENT, SUCCESS, DANGER, WARNING, GRAY_LIGHT, GRAY, GRAY_BORDER } from '../../utils/constants';
import { CollectionItem, MainTabParamList } from '../../types';

type NavProp = BottomTabNavigationProp<MainTabParamList, 'Home'>;

export default function HomeScreen() {
  const navigation = useNavigation<NavProp>();
  const { session } = useAuthStore();
  const { setTodayItems, setOverdueItems, todayItems, overdueItems } = useCollectionStore();
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const pendingItems = todayItems.filter((i) => i.status === 'PENDING');
  const collectedItems = todayItems.filter((i) => i.status === 'PAID');
  const totalTarget = [...todayItems, ...overdueItems].reduce((s, i) => s + i.amountDue, 0);
  const totalCollected = collectedItems.reduce((s, i) => s + i.paidAmount, 0);
  const progressPct = totalTarget > 0 ? Math.round((totalCollected / totalTarget) * 100) : 0;

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [today, overdue] = await Promise.all([
        fetchTodayCollections().catch(() => [] as CollectionItem[]),
        fetchOverdueCollections().catch(() => [] as CollectionItem[]),
      ]);
      setTodayItems(today);
      setOverdueItems(overdue);
    } catch {
      // offline — use cached store data
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const { synced, failed } = await syncPendingPayments();
      Alert.alert('Sync complete', `Synced: ${synced}, Failed: ${failed}`);
    } catch {
      Alert.alert('Sync failed', 'Check your internet connection.');
    } finally {
      setSyncing(false);
    }
  }

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Gradient header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Good morning,</Text>
            <Text style={styles.agentName}>
              {session?.user.firstName} {session?.user.lastName}
            </Text>
            <Text style={styles.dateText}>{today}</Text>
          </View>
          <TouchableOpacity style={styles.syncBtn} onPress={handleSync} disabled={syncing}>
            <Text style={styles.syncIcon}>{syncing ? '⟳' : '☁'}</Text>
          </TouchableOpacity>
        </View>

        {/* Target card */}
        <View style={styles.targetCard}>
          <View style={styles.targetRow}>
            <View>
              <Text style={styles.targetLabel}>Today's Target</Text>
              <Text style={styles.targetAmount}>{fmtCurrency(totalTarget)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.targetLabel}>Collected</Text>
              <Text style={[styles.targetAmount, { color: SUCCESS }]}>
                {fmtCurrency(totalCollected)}
              </Text>
            </View>
          </View>

          {/* Progress bar */}
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${progressPct}%` as `${number}%` }]} />
          </View>
          <View style={styles.progressRow}>
            <Text style={styles.progressPct}>{progressPct}% completed</Text>
            <Text style={styles.progressCount}>
              {collectedItems.length}/{todayItems.length} done
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={BRAND} />}
      >
        {/* Stats */}
        <View style={styles.statsRow}>
          {[
            { label: 'Pending', value: pendingItems.length, color: BRAND },
            { label: 'Overdue', value: overdueItems.length, color: DANGER },
            { label: 'Collected', value: collectedItems.length, color: SUCCESS },
          ].map((s) => (
            <View key={s.label} style={styles.statCard}>
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {[
            { label: 'Collect', icon: '💳', color: BRAND, tab: 'Collections' as const },
            { label: 'Customers', icon: '👥', color: '#8B5CF6', tab: 'Customers' as const },
          ].map((a) => (
            <TouchableOpacity
              key={a.label}
              style={[styles.actionCard, { borderColor: a.color + '30' }]}
              onPress={() => navigation.navigate(a.tab)}
            >
              <Text style={styles.actionIcon}>{a.icon}</Text>
              <Text style={[styles.actionLabel, { color: a.color }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Upcoming collections */}
        {pendingItems.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Pending Today</Text>
            {pendingItems.slice(0, 5).map((item) => (
              <CollectionCard key={item.id} item={item} onPress={() => navigation.navigate('Collections')} />
            ))}
          </>
        )}

        {/* Overdue */}
        {overdueItems.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: DANGER }]}>
              ⚠ Overdue ({overdueItems.length})
            </Text>
            {overdueItems.slice(0, 3).map((item) => (
              <CollectionCard key={item.id} item={item} onPress={() => navigation.navigate('Collections')} overdue />
            ))}
          </>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

function CollectionCard({
  item,
  onPress,
  overdue = false,
}: {
  item: CollectionItem;
  onPress: () => void;
  overdue?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.collCard, overdue && { borderLeftColor: DANGER, borderLeftWidth: 3 }]}
      onPress={onPress}
    >
      <View style={[styles.collAvatar, { backgroundColor: overdue ? DANGER : BRAND }]}>
        <Text style={styles.collAvatarText}>
          {item.customerName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.collName}>{item.customerName}</Text>
        <Text style={styles.collSub}>{item.loanNumber} · {fmtDate(item.dueDate)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.collAmount, { color: overdue ? DANGER : BRAND }]}>
          {fmtCurrency(item.amountDue)}
        </Text>
        {overdue && item.daysOverdue && (
          <Text style={{ fontSize: 10, color: DANGER, fontWeight: '600' }}>
            {item.daysOverdue}d overdue
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    backgroundColor: BRAND,
    paddingTop: 55,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  agentName: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 2 },
  dateText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  syncBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncIcon: { color: '#fff', fontSize: 18 },
  targetCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  targetRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  targetLabel: { fontSize: 12, color: GRAY, fontWeight: '500' },
  targetAmount: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 2 },
  progressBg: {
    height: 10,
    backgroundColor: GRAY_LIGHT,
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    backgroundColor: SUCCESS,
    borderRadius: 5,
  },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  progressPct: { fontSize: 12, color: GRAY },
  progressCount: { fontSize: 12, color: ACCENT, fontWeight: '600' },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 11, color: GRAY, marginTop: 2, fontWeight: '500' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },
  actionsGrid: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  actionCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  actionIcon: { fontSize: 28, marginBottom: 6 },
  actionLabel: { fontSize: 13, fontWeight: '700' },
  collCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
    gap: 12,
  },
  collAvatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  collAvatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  collName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  collSub: { fontSize: 12, color: GRAY, marginTop: 2 },
  collAmount: { fontSize: 15, fontWeight: '800' },
});
