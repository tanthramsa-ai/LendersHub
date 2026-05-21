import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, Animated, LayoutChangeEvent,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCollectionStore } from '../../store/collectionStore';
import { fetchTodayCollections, fetchOverdueCollections, fetchAgentStats } from '../../api/collections';
import { cacheCollections, getCollectionCache } from '../../db/database';
import { fmtCurrency, fmtCurrencyFull, fmtDate, statusColor, initials } from '../../utils/format';
import {
  BRAND, BRAND_LIGHT, DANGER, SUCCESS, GRAY, GRAY_BORDER, GRAY_LIGHT,
} from '../../utils/constants';
import { CollectionItem, CollectionsStackParamList } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<CollectionsStackParamList, 'CollectionsList'>;
};

const TABS = ['today', 'overdue', 'completed'] as const;
type Tab = typeof TABS[number];
type SortKey = 'amount' | 'name' | 'date';

const SORT_CYCLE: SortKey[] = ['amount', 'name', 'date'];
const SORT_LABELS: Record<SortKey, string> = { amount: 'Amount', name: 'Name', date: 'Due Date' };

export default function CollectionsListScreen({ navigation }: Props) {
  const { todayItems, overdueItems, activeTab, setActiveTab, setTodayItems, setOverdueItems } =
    useCollectionStore();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('amount');
  const [officialTarget, setOfficialTarget] = useState<number | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [barWidth, setBarWidth] = useState(0);

  // ── Derived data ────────────────────────────────────────────────────────────
  const completedItems = todayItems.filter((i) => i.status === 'PAID');
  const pendingItems = todayItems.filter((i) => i.status !== 'PAID');

  const todayCollected = completedItems.reduce((s, i) => s + i.paidAmount, 0);
  const computedTarget = [...todayItems, ...overdueItems].reduce((s, i) => s + i.amountDue, 0);
  const todayTarget = officialTarget ?? computedTarget;
  const progressPct = todayTarget > 0 ? Math.min((todayCollected / todayTarget) * 100, 100) : 0;
  const remaining = Math.max(todayTarget - todayCollected, 0);

  const counts: Record<Tab, number> = {
    today: pendingItems.length,
    overdue: overdueItems.length,
    completed: completedItems.length,
  };

  // ── Animate progress bar ─────────────────────────────────────────────────────
  useEffect(() => {
    if (barWidth === 0) return;
    Animated.timing(progressAnim, {
      toValue: (progressPct / 100) * barWidth,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [progressPct, barWidth]);

  useEffect(() => { loadData(); }, []);

  // ── Data loading — network first, SQLite fallback ────────────────────────────
  async function loadData() {
    try {
      const [today, overdue, stats] = await Promise.all([
        fetchTodayCollections(),
        fetchOverdueCollections(),
        fetchAgentStats().catch(() => null),
      ]);
      setTodayItems(today);
      setOverdueItems(overdue);
      if (stats?.todayTarget) setOfficialTarget(stats.todayTarget);
      // Cache fresh data for offline use
      cacheCollections([...today, ...overdue]).catch(() => {});
    } catch {
      // Network failed — restore from SQLite
      try {
        const cached = await getCollectionCache();
        if (cached.length > 0) {
          setTodayItems(cached.filter((i) => i.status !== 'OVERDUE'));
          setOverdueItems(cached.filter((i) => i.status === 'OVERDUE'));
        }
      } catch { /* SQLite also failed — keep whatever is in store */ }
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  // ── Sort cycle ────────────────────────────────────────────────────────────────
  function cycleSortBy() {
    const next = SORT_CYCLE[(SORT_CYCLE.indexOf(sortBy) + 1) % SORT_CYCLE.length];
    setSortBy(next);
  }

  // ── Filtered + sorted list ────────────────────────────────────────────────────
  const listMap: Record<Tab, CollectionItem[]> = {
    today: pendingItems,
    overdue: overdueItems,
    completed: completedItems,
  };

  const currentList = listMap[activeTab]
    .filter(
      (i) =>
        search.length === 0 ||
        i.customerName.toLowerCase().includes(search.toLowerCase()) ||
        i.loanNumber.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === 'amount') return b.amountDue - a.amountDue;
      if (sortBy === 'name') return a.customerName.localeCompare(b.customerName);
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

  // ── Header ────────────────────────────────────────────────────────────────────
  const ListHeader = (
    <>
      {/* ── Summary card ── */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.summaryLabel}>Today's Target</Text>
            <Text style={styles.summaryTarget}>{fmtCurrencyFull(todayTarget)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.summaryLabel}>Collected</Text>
            <Text style={[styles.summaryTarget, { color: SUCCESS }]}>
              {fmtCurrencyFull(todayCollected)}
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View
          style={styles.progressBg}
          onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
        >
          <Animated.View style={[styles.progressFill, { width: progressAnim }]} />
        </View>
        <View style={styles.progressMeta}>
          <Text style={styles.progressPct}>{Math.round(progressPct)}% of target reached</Text>
          <Text style={styles.progressRemaining}>{fmtCurrencyFull(remaining)} remaining</Text>
        </View>

        {/* Stat chips */}
        <View style={styles.chipRow}>
          {([
            { label: 'Pending', count: counts.today, color: BRAND, bg: BRAND_LIGHT },
            { label: 'Overdue', count: counts.overdue, color: DANGER, bg: '#FEE2E2' },
            { label: 'Done', count: counts.completed, color: SUCCESS, bg: '#D1FAE5' },
          ] as const).map((chip) => (
            <View key={chip.label} style={[styles.chip, { backgroundColor: chip.bg }]}>
              <Text style={[styles.chipCount, { color: chip.color }]}>{chip.count}</Text>
              <Text style={[styles.chipLabel, { color: chip.color }]}>{chip.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Shortcut row ── */}
      <View style={styles.shortcutRow}>
        <TouchableOpacity style={styles.shortcutBtn} onPress={() => navigation.navigate('RouteMap')}>
          <Text style={styles.shortcutIcon}>🗺</Text>
          <Text style={styles.shortcutLabel}>Route</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.shortcutBtn} onPress={() => navigation.navigate('PaymentHistory')}>
          <Text style={styles.shortcutIcon}>📊</Text>
          <Text style={styles.shortcutLabel}>History</Text>
        </TouchableOpacity>
      </View>

      {/* ── Search bar ── */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or loan #…"
          placeholderTextColor={GRAY}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Tabs + Sort ── */}
      <View style={styles.tabRow}>
        <View style={styles.tabs}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {counts[tab] > 0 && (
                  <Text style={[styles.tabBadge, activeTab === tab && styles.tabBadgeActive]}>
                    {' '}{counts[tab]}
                  </Text>
                )}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.sortBtn} onPress={cycleSortBy}>
          <Text style={styles.sortBtnText}>↕ {SORT_LABELS[sortBy]}</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  // ── Empty state ───────────────────────────────────────────────────────────────
  const emptyIcon = activeTab === 'completed' ? '🎉' : activeTab === 'overdue' ? '✅' : '📋';
  const emptyTitle =
    search.length > 0
      ? 'No results found'
      : activeTab === 'overdue' && counts.overdue === 0
      ? 'No overdue items!'
      : activeTab === 'completed' && counts.completed === 0
      ? 'No collections yet today'
      : 'All caught up!';
  const emptySubtitle =
    search.length > 0 ? 'Try a different search term' : 'Pull down to refresh';

  return (
    <View style={styles.root}>
      <FlatList
        data={currentList}
        keyExtractor={(i) => i.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />
        }
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{emptyIcon}</Text>
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptySub}>{emptySubtitle}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <CustomerCollectionCard
            item={item}
            onPress={() => navigation.navigate('CollectionDetail', { itemId: item.id })}
            onQuickPay={
              item.status !== 'PAID'
                ? () => navigation.navigate('PaymentCapture', { item })
                : undefined
            }
          />
        )}
      />
    </View>
  );
}

// ── Customer Collection Card ─────────────────────────────────────────────────

function CustomerCollectionCard({
  item,
  onPress,
  onQuickPay,
}: {
  item: CollectionItem;
  onPress: () => void;
  onQuickPay?: () => void;
}) {
  const isOverdue = item.status === 'OVERDUE';
  const isPaid = item.status === 'PAID';
  const sc = statusColor(item.status);
  const avatarColor = isOverdue ? DANGER : isPaid ? SUCCESS : BRAND;
  const amountColor = isOverdue ? DANGER : isPaid ? SUCCESS : BRAND;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isOverdue && styles.cardOverdue,
        isPaid && styles.cardPaid,
      ]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
        <Text style={styles.avatarText}>{initials(item.customerName)}</Text>
      </View>

      {/* Details */}
      <View style={styles.cardBody}>
        {/* Row 1: Name + Amount */}
        <View style={styles.cardRow}>
          <Text style={styles.customerName} numberOfLines={1}>
            {item.customerName}
          </Text>
          <Text style={[styles.amountDue, { color: amountColor }]}>
            {fmtCurrency(item.amountDue)}
          </Text>
        </View>

        {/* Row 2: Loan # + EMI */}
        <Text style={styles.loanMeta}>
          {item.loanNumber} · EMI #{item.installmentNumber} · {fmtDate(item.dueDate)}
        </Text>

        {/* Row 3: Address */}
        {item.customerAddress ? (
          <Text style={styles.address} numberOfLines={1}>
            📍 {item.customerAddress}
          </Text>
        ) : null}

        {/* Row 4: Phone + Status badge */}
        <View style={styles.cardFooter}>
          <Text style={styles.phone}>📞 {item.customerPhone}</Text>
          <View style={styles.badgeRow}>
            {isOverdue && item.daysOverdue ? (
              <View style={styles.overduePill}>
                <Text style={styles.overduePillText}>{item.daysOverdue}d late</Text>
              </View>
            ) : null}
            <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
              <Text style={[styles.statusText, { color: sc.text }]}>
                {item.status === 'PARTIALLY_PAID' ? 'Partial' : item.status}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick-pay button */}
        {onQuickPay ? (
          <TouchableOpacity style={styles.quickPayBtn} onPress={onQuickPay} activeOpacity={0.8}>
            <Text style={styles.quickPayText}>💳  Quick Pay  {fmtCurrency(item.amountDue - item.paidAmount)}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  listContent: { paddingBottom: 30 },

  // Summary card
  summaryCard: {
    backgroundColor: '#fff',
    margin: 12,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  summaryLabel: { fontSize: 11, color: GRAY, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  summaryTarget: { fontSize: 20, fontWeight: '800', color: '#111827', marginTop: 3 },

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
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  progressPct: { fontSize: 12, color: GRAY },
  progressRemaining: { fontSize: 12, color: GRAY, fontWeight: '600' },

  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  chipCount: { fontSize: 20, fontWeight: '800' },
  chipLabel: { fontSize: 10, fontWeight: '700', marginTop: 1 },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: '#111827' },
  clearIcon: { color: GRAY, fontSize: 14, paddingLeft: 8 },

  // Tabs + Sort row
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 8,
    gap: 8,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: GRAY_LIGHT,
    borderRadius: 12,
    padding: 3,
  },
  tab: { flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: BRAND },
  tabText: { fontSize: 12, fontWeight: '600', color: GRAY },
  tabTextActive: { color: '#fff' },
  tabBadge: { color: GRAY, fontSize: 11 },
  tabBadgeActive: { color: 'rgba(255,255,255,0.8)' },

  sortBtn: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  sortBtnText: { fontSize: 11, fontWeight: '700', color: BRAND },

  // Customer card
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
    gap: 12,
  },
  cardOverdue: { borderLeftWidth: 3, borderLeftColor: DANGER },
  cardPaid: { opacity: 0.75 },

  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  cardBody: { flex: 1 },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 3,
  },
  customerName: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  amountDue: { fontSize: 16, fontWeight: '800', flexShrink: 0 },
  loanMeta: { fontSize: 11, color: GRAY, marginBottom: 3 },
  address: { fontSize: 11, color: GRAY, marginBottom: 5 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  phone: { fontSize: 11, color: GRAY },
  badgeRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  overduePill: {
    backgroundColor: '#FEE2E2',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  overduePillText: { fontSize: 10, fontWeight: '700', color: DANGER },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 10, fontWeight: '700' },

  // Shortcut row
  shortcutRow: { flexDirection: 'row', gap: 10, marginHorizontal: 12, marginBottom: 10 },
  shortcutBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 10, gap: 6,
    borderWidth: 1, borderColor: GRAY_BORDER,
  },
  shortcutIcon: { fontSize: 16 },
  shortcutLabel: { fontSize: 12, fontWeight: '700', color: BRAND },

  // Quick-pay
  quickPayBtn: {
    marginTop: 8,
    backgroundColor: BRAND,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  quickPayText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151', textAlign: 'center' },
  emptySub: { fontSize: 13, color: GRAY, marginTop: 6, textAlign: 'center' },
});
