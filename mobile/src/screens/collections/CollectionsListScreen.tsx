import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCollectionStore } from '../../store/collectionStore';
import { fetchTodayCollections, fetchOverdueCollections } from '../../api/collections';
import { fmtCurrency, fmtDate, statusColor } from '../../utils/format';
import { BRAND, ACCENT, DANGER, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';
import { CollectionItem, CollectionsStackParamList } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<CollectionsStackParamList, 'CollectionsList'>;
};

const TABS = ['today', 'overdue', 'completed'] as const;

export default function CollectionsListScreen({ navigation }: Props) {
  const { todayItems, overdueItems, activeTab, setActiveTab, setTodayItems, setOverdueItems } =
    useCollectionStore();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [today, overdue] = await Promise.all([
        fetchTodayCollections().catch(() => [] as CollectionItem[]),
        fetchOverdueCollections().catch(() => [] as CollectionItem[]),
      ]);
      setTodayItems(today);
      setOverdueItems(overdue);
    } catch { /* offline */ }
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  const completedItems = todayItems.filter((i) => i.status === 'PAID');
  const listMap = {
    today: todayItems.filter((i) => i.status !== 'PAID'),
    overdue: overdueItems,
    completed: completedItems,
  };
  const currentList = listMap[activeTab].filter((i) =>
    search.length === 0 ||
    i.customerName.toLowerCase().includes(search.toLowerCase()) ||
    i.loanNumber.toLowerCase().includes(search.toLowerCase()),
  );

  const counts = {
    today: listMap.today.length,
    overdue: listMap.overdue.length,
    completed: listMap.completed.length,
  };

  return (
    <View style={styles.root}>
      {/* Search */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or loan #…"
          placeholderTextColor={GRAY}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}{' '}
              <Text style={[styles.tabBadge, activeTab === tab && { color: '#fff' }]}>
                {counts[tab]}
              </Text>
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <FlatList
        data={currentList}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 30 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>No items in this category</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[
              styles.card,
              item.status === 'OVERDUE' && styles.cardOverdue,
            ]}
            onPress={() => navigation.navigate('CollectionDetail', { itemId: item.id })}
          >
            <View style={[styles.avatar, { backgroundColor: item.status === 'OVERDUE' ? DANGER : BRAND }]}>
              <Text style={styles.avatarText}>
                {item.customerName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
              </Text>
            </View>

            <View style={styles.info}>
              <Text style={styles.name}>{item.customerName}</Text>
              <Text style={styles.sub}>{item.loanNumber} · EMI #{item.installmentNumber}</Text>
              <Text style={styles.address} numberOfLines={1}>{item.customerAddress}</Text>
            </View>

            <View style={styles.right}>
              <Text style={[styles.amount, { color: item.status === 'OVERDUE' ? DANGER : BRAND }]}>
                {fmtCurrency(item.amountDue)}
              </Text>
              <View style={[styles.badge, { backgroundColor: statusColor(item.status).bg }]}>
                <Text style={[styles.badgeText, { color: statusColor(item.status).text }]}>
                  {item.status === 'OVERDUE' && item.daysOverdue
                    ? `${item.daysOverdue}d overdue`
                    : item.status.replace('_', ' ')}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    margin: 12,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: '#111827' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: GRAY_LIGHT,
    marginHorizontal: 12,
    borderRadius: 12,
    padding: 4,
    marginBottom: 4,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: BRAND },
  tabText: { fontSize: 12, fontWeight: '600', color: GRAY },
  tabTextActive: { color: '#fff' },
  tabBadge: { color: GRAY },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
    gap: 12,
  },
  cardOverdue: { borderLeftWidth: 3, borderLeftColor: DANGER },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: '#111827' },
  sub: { fontSize: 12, color: GRAY, marginTop: 2 },
  address: { fontSize: 11, color: GRAY, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 6 },
  amount: { fontSize: 16, fontWeight: '800' },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: GRAY, fontSize: 14 },
});
