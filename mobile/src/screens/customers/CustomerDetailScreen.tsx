import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomer } from '../../api/customers';
import { fmtCurrency, fmtDate } from '../../utils/format';
import { BRAND, ACCENT, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';
import { CustomersStackParamList } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<CustomersStackParamList, 'CustomerDetail'>;
  route: RouteProp<CustomersStackParamList, 'CustomerDetail'>;
};

export default function CustomerDetailScreen({ route }: Props) {
  const { customerId } = route.params;
  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(customerId),
  });

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={BRAND} />
      </View>
    );
  }

  if (!customer) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: GRAY }}>Customer not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{customer.firstName[0]}{customer.lastName[0]}</Text>
        </View>
        <Text style={styles.customerName}>{customer.firstName} {customer.lastName}</Text>
        <Text style={styles.customerCode}>{customer.customerCode}</Text>
        {customer.creditScore && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreValue}>{customer.creditScore}</Text>
            <Text style={styles.scoreLabel}>Credit Score</Text>
          </View>
        )}
      </View>

      {/* Contact actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: BRAND + '15' }]}
          onPress={() => Linking.openURL(`tel:${customer.phone}`)}
        >
          <Text style={styles.actionIcon}>📞</Text>
          <Text style={[styles.actionLabel, { color: BRAND }]}>Call</Text>
        </TouchableOpacity>
        {customer.email && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: ACCENT + '15' }]}
            onPress={() => Linking.openURL(`mailto:${customer.email}`)}
          >
            <Text style={styles.actionIcon}>✉</Text>
            <Text style={[styles.actionLabel, { color: ACCENT }]}>Email</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Total Loans', value: String(customer.totalLoans ?? 0) },
          { label: 'Active', value: String(customer.activeLoans ?? 0) },
          { label: 'Total Paid', value: fmtCurrency(customer.totalPaid ?? 0) },
        ].map((s) => (
          <View key={s.label} style={styles.statCard}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Contact info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact Information</Text>
        {[
          { label: 'Phone', value: customer.phone },
          { label: 'Email', value: customer.email ?? '—' },
          { label: 'Address', value: customer.address ?? '—' },
          { label: 'City', value: customer.city ?? '—' },
          { label: 'State', value: customer.state ?? '—' },
        ].map((r) => (
          <View key={r.label} style={styles.infoRow}>
            <Text style={styles.infoLabel}>{r.label}</Text>
            <Text style={styles.infoValue}>{r.value}</Text>
          </View>
        ))}
      </View>

      {/* KYC */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>KYC Details</Text>
        {[
          { label: 'PAN Number', value: customer.panNumber ?? '—' },
          { label: 'Member Since', value: fmtDate((customer as { createdAt?: string }).createdAt ?? null) },
          { label: 'Status', value: customer.isActive ? 'Active' : 'Inactive' },
        ].map((r) => (
          <View key={r.label} style={styles.infoRow}>
            <Text style={styles.infoLabel}>{r.label}</Text>
            <Text style={[styles.infoValue, r.label === 'Status' && { color: customer.isActive ? '#10B981' : GRAY }]}>
              {r.value}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerCard: {
    backgroundColor: BRAND,
    padding: 28,
    alignItems: 'center',
    paddingTop: 40,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 26, fontWeight: '900', color: BRAND },
  customerName: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  customerCode: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
  scoreBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignItems: 'center',
  },
  scoreValue: { fontSize: 24, fontWeight: '900', color: '#fff' },
  scoreLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 14,
    marginTop: 14,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  actionIcon: { fontSize: 24 },
  actionLabel: { fontSize: 12, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  statValue: { fontSize: 18, fontWeight: '800', color: BRAND },
  statLabel: { fontSize: 11, color: GRAY, marginTop: 2 },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 14,
    marginTop: 14,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_LIGHT,
  },
  infoLabel: { fontSize: 13, color: GRAY },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#111827', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
});
