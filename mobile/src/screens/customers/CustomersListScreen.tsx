import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomers } from '../../api/customers';
import { fmtDate } from '../../utils/format';
import { BRAND, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';
import { Customer, CustomersStackParamList } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<CustomersStackParamList, 'CustomersList'>;
};

export default function CustomersListScreen({ navigation }: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['customers', debouncedSearch],
    queryFn: () => fetchCustomers(1, 30, debouncedSearch || undefined),
    staleTime: 60_000,
  });

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    const timeout = setTimeout(() => setDebouncedSearch(text), 400);
    return () => clearTimeout(timeout);
  }, []);

  const customers = data?.data ?? [];

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or phone…"
          placeholderTextColor={GRAY}
          value={search}
          onChangeText={handleSearchChange}
        />
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} size="large" />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
          onRefresh={refetch}
          refreshing={isLoading}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>👥</Text>
              <Text style={styles.emptyText}>No customers found</Text>
            </View>
          }
          renderItem={({ item }: { item: Customer }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('CustomerDetail', { customerId: item.id })}
            >
              <View style={[styles.avatar, { backgroundColor: item.isActive ? BRAND : '#9CA3AF' }]}>
                <Text style={styles.avatarText}>
                  {item.firstName[0]}{item.lastName[0]}
                </Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.name}>{item.firstName} {item.lastName}</Text>
                <Text style={styles.code}>{item.customerCode}</Text>
                <Text style={styles.phone}>{item.phone}</Text>
                {item.city && <Text style={styles.city}>{item.city}{item.state ? `, ${item.state}` : ''}</Text>}
              </View>
              <View style={styles.right}>
                {item.creditScore && (
                  <View style={styles.scoreBadge}>
                    <Text style={styles.scoreText}>{item.creditScore}</Text>
                    <Text style={styles.scoreLabel}>Score</Text>
                  </View>
                )}
                <View style={[styles.activeBadge, { backgroundColor: item.isActive ? '#D1FAE5' : '#F3F4F6' }]}>
                  <Text style={[styles.activeBadgeText, { color: item.isActive ? '#065F46' : '#6B7280' }]}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
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
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: '#111827' },
  code: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  phone: { fontSize: 13, color: '#374151', marginTop: 2 },
  city: { fontSize: 11, color: GRAY, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 6 },
  scoreBadge: {
    backgroundColor: BRAND + '15',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  scoreText: { fontSize: 14, fontWeight: '800', color: BRAND },
  scoreLabel: { fontSize: 9, color: BRAND, fontWeight: '600' },
  activeBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  activeBadgeText: { fontSize: 10, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: GRAY, fontSize: 14 },
});
