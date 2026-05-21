import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking,
  ActivityIndicator, Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { fetchCustomer, fetchCustomerLoans } from '../../api/customers';
import { fmtCurrency, fmtDate, statusColor } from '../../utils/format';
import { BRAND, ACCENT, SUCCESS, DANGER, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';
import { CustomersStackParamList, Loan } from '../../types';

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

  const { data: loansData, isLoading: loansLoading } = useQuery({
    queryKey: ['customer-loans', customerId],
    queryFn: () => fetchCustomerLoans(customerId),
    enabled: !!customer,
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

  function handleCall() {
    Linking.openURL(`tel:${customer!.phone}`);
  }

  function handleWhatsApp() {
    const phone = customer!.phone.replace(/\D/g, '');
    Linking.openURL(`https://wa.me/91${phone}`).catch(() =>
      Alert.alert('WhatsApp not installed', 'Could not open WhatsApp.'),
    );
  }

  function handleEmail() {
    if (customer?.email) Linking.openURL(`mailto:${customer.email}`);
  }

  function handleNavigate() {
    const addr = [customer!.address, customer!.city, customer!.state].filter(Boolean).join(', ');
    if (!addr) { Alert.alert('No address', 'This customer has no address on file.'); return; }
    Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(addr)}`);
  }

  const loans = loansData?.data ?? [];

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 48 }}>
      {/* ── Header ── */}
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{customer.firstName[0]}{customer.lastName[0]}</Text>
        </View>
        <Text style={styles.customerName}>{customer.firstName} {customer.lastName}</Text>
        <Text style={styles.customerCode}>{customer.customerCode}</Text>
        <View style={[styles.statusPill, { backgroundColor: customer.isActive ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.15)' }]}>
          <Text style={[styles.statusPillText, { color: customer.isActive ? '#6EE7B7' : 'rgba(255,255,255,0.6)' }]}>
            {customer.isActive ? '● Active' : '○ Inactive'}
          </Text>
        </View>
        {customer.creditScore != null && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreValue}>{customer.creditScore}</Text>
            <Text style={styles.scoreLabel}>Credit Score</Text>
          </View>
        )}
      </View>

      {/* ── Quick actions ── */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: BRAND + '12' }]} onPress={handleCall}>
          <Text style={styles.actionIcon}>📞</Text>
          <Text style={[styles.actionLabel, { color: BRAND }]}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#25D36612' }]} onPress={handleWhatsApp}>
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={[styles.actionLabel, { color: '#25D366' }]}>WhatsApp</Text>
        </TouchableOpacity>
        {customer.email ? (
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: ACCENT + '12' }]} onPress={handleEmail}>
            <Text style={styles.actionIcon}>✉</Text>
            <Text style={[styles.actionLabel, { color: ACCENT }]}>Email</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#8B5CF612' }]} onPress={handleNavigate}>
          <Text style={styles.actionIcon}>🗺</Text>
          <Text style={[styles.actionLabel, { color: '#8B5CF6' }]}>Navigate</Text>
        </TouchableOpacity>
      </View>

      {/* ── Stats ── */}
      <View style={styles.statsRow}>
        {[
          { label: 'Total Loans', value: String(customer.totalLoans ?? 0), color: BRAND },
          { label: 'Active', value: String(customer.activeLoans ?? 0), color: SUCCESS },
          { label: 'Total Paid', value: fmtCurrency(customer.totalPaid ?? 0), color: '#8B5CF6' },
        ].map((s) => (
          <View key={s.label} style={styles.statCard}>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Contact info ── */}
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

      {/* ── KYC ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>KYC Details</Text>
        {[
          { label: 'PAN Number', value: customer.panNumber ?? '—' },
          { label: 'Member Since', value: fmtDate(customer.createdAt ?? null) },
          { label: 'Status', value: customer.isActive ? 'Active' : 'Inactive' },
        ].map((r) => (
          <View key={r.label} style={styles.infoRow}>
            <Text style={styles.infoLabel}>{r.label}</Text>
            <Text style={[styles.infoValue, r.label === 'Status' && { color: customer.isActive ? SUCCESS : GRAY }]}>
              {r.value}
            </Text>
          </View>
        ))}
      </View>

      {/* ── Active Loans ── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Loans{loans.length > 0 ? ` (${loans.length})` : ''}
        </Text>
        {loansLoading ? (
          <ActivityIndicator color={BRAND} style={{ paddingVertical: 16 }} />
        ) : loans.length === 0 ? (
          <Text style={styles.emptyLoans}>No loans on record</Text>
        ) : (
          loans.map((loan, idx) => <LoanCard key={loan.id} loan={loan} last={idx === loans.length - 1} />)
        )}
      </View>
    </ScrollView>
  );
}

function LoanCard({ loan, last }: { loan: Loan; last: boolean }) {
  const sc = statusColor(loan.status);
  return (
    <View style={[styles.loanCard, last && { borderBottomWidth: 0 }]}>
      <View style={styles.loanTop}>
        <Text style={styles.loanNumber}>{loan.loanNumber}</Text>
        <View style={[styles.loanBadge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.loanBadgeText, { color: sc.text }]}>{loan.status}</Text>
        </View>
      </View>
      <View style={styles.loanMeta}>
        <View style={styles.loanMetaItem}>
          <Text style={styles.loanMetaLabel}>Principal</Text>
          <Text style={styles.loanMetaValue}>{fmtCurrency(loan.principal)}</Text>
        </View>
        <View style={styles.loanMetaItem}>
          <Text style={styles.loanMetaLabel}>Outstanding</Text>
          <Text style={[styles.loanMetaValue, { color: loan.outstanding > 0 ? DANGER : SUCCESS }]}>
            {fmtCurrency(loan.outstanding)}
          </Text>
        </View>
        <View style={styles.loanMetaItem}>
          <Text style={styles.loanMetaLabel}>Term</Text>
          <Text style={styles.loanMetaValue}>{loan.termMonths}mo</Text>
        </View>
        <View style={styles.loanMetaItem}>
          <Text style={styles.loanMetaLabel}>Rate</Text>
          <Text style={styles.loanMetaValue}>{loan.interestRate}%</Text>
        </View>
      </View>
      {loan.disbursedAt && (
        <Text style={styles.loanDate}>Disbursed {fmtDate(loan.disbursedAt)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  headerCard: {
    backgroundColor: BRAND,
    paddingTop: 36,
    paddingBottom: 28,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 28, fontWeight: '900', color: BRAND },
  customerName: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  customerCode: { fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4 },
  statusPill: {
    marginTop: 8,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  scoreBadge: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignItems: 'center',
  },
  scoreValue: { fontSize: 26, fontWeight: '900', color: '#fff' },
  scoreLabel: { fontSize: 11, color: 'rgba(255,255,255,0.65)' },

  actionRow: {
    flexDirection: 'row',
    gap: 8,
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
  actionIcon: { fontSize: 22 },
  actionLabel: { fontSize: 10, fontWeight: '700' },

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
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 10, color: GRAY, marginTop: 3, fontWeight: '500' },

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
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_LIGHT,
  },
  infoLabel: { fontSize: 13, color: GRAY },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  emptyLoans: { color: GRAY, fontSize: 13, paddingVertical: 8 },

  loanCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_LIGHT,
  },
  loanTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  loanNumber: { fontSize: 13, fontWeight: '700', color: '#111827' },
  loanBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  loanBadgeText: { fontSize: 10, fontWeight: '700' },
  loanMeta: { flexDirection: 'row', gap: 12 },
  loanMetaItem: {},
  loanMetaLabel: { fontSize: 10, color: GRAY, fontWeight: '500' },
  loanMetaValue: { fontSize: 13, fontWeight: '700', color: '#111827', marginTop: 1 },
  loanDate: { fontSize: 11, color: GRAY, marginTop: 6 },
});
