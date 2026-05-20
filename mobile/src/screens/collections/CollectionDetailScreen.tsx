import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useCollectionStore } from '../../store/collectionStore';
import { fmtCurrency, fmtDate } from '../../utils/format';
import { BRAND, ACCENT, DANGER, SUCCESS, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';
import { CollectionsStackParamList } from '../../types';

type Props = {
  navigation: NativeStackNavigationProp<CollectionsStackParamList, 'CollectionDetail'>;
  route: RouteProp<CollectionsStackParamList, 'CollectionDetail'>;
};

export default function CollectionDetailScreen({ navigation, route }: Props) {
  const { itemId } = route.params;
  const { todayItems, overdueItems } = useCollectionStore();
  const item = [...todayItems, ...overdueItems].find((i) => i.id === itemId);

  if (!item) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>Collection not found</Text>
      </View>
    );
  }

  async function handleNavigate() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission denied', 'Location access is needed for navigation.');
      return;
    }
    if (item?.lat && item?.lng) {
      const url = `https://maps.google.com/?q=${item.lat},${item.lng}`;
      Linking.openURL(url);
    } else if (item?.customerAddress) {
      const encoded = encodeURIComponent(item.customerAddress);
      Linking.openURL(`https://maps.google.com/?q=${encoded}`);
    }
  }

  function handleCall() {
    Linking.openURL(`tel:${item.customerPhone}`);
  }

  const isPaid = item.status === 'PAID';

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 120 }}>
      {/* Customer header */}
      <View style={styles.customerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {item.customerName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.customerName}>{item.customerName}</Text>
          <Text style={styles.customerPhone}>{item.customerPhone}</Text>
          {item.customerAddress && (
            <Text style={styles.customerAddress}>{item.customerAddress}</Text>
          )}
        </View>
      </View>

      {/* Action buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: BRAND + '15' }]} onPress={handleCall}>
          <Text style={styles.actionBtnIcon}>📞</Text>
          <Text style={[styles.actionBtnLabel, { color: BRAND }]}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: ACCENT + '15' }]} onPress={handleNavigate}>
          <Text style={styles.actionBtnIcon}>🗺</Text>
          <Text style={[styles.actionBtnLabel, { color: ACCENT }]}>Navigate</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: '#8B5CF615' }]}
          onPress={() => navigation.navigate('ReceiptCamera', { loanId: item.loanId, installmentId: item.installmentId })}
        >
          <Text style={styles.actionBtnIcon}>📷</Text>
          <Text style={[styles.actionBtnLabel, { color: '#8B5CF6' }]}>Receipt</Text>
        </TouchableOpacity>
      </View>

      {/* Loan info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Loan Information</Text>
        {[
          { label: 'Loan Number', value: item.loanNumber },
          { label: 'Installment', value: `#${item.installmentNumber}` },
          { label: 'Due Date', value: fmtDate(item.dueDate) },
          { label: 'Amount Due', value: fmtCurrency(item.amountDue) },
          { label: 'Paid Amount', value: fmtCurrency(item.paidAmount) },
          { label: 'Balance', value: fmtCurrency(item.amountDue - item.paidAmount) },
        ].map((row) => (
          <View key={row.label} style={styles.infoRow}>
            <Text style={styles.infoLabel}>{row.label}</Text>
            <Text style={styles.infoValue}>{row.value}</Text>
          </View>
        ))}
      </View>

      {/* Status */}
      {item.status === 'OVERDUE' && (
        <View style={styles.overdueAlert}>
          <Text style={styles.overdueAlertText}>
            ⚠ This installment is {item.daysOverdue ?? 0} day(s) overdue
          </Text>
        </View>
      )}

      {isPaid ? (
        <View style={styles.paidBanner}>
          <Text style={styles.paidBannerText}>✓ Payment Collected</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={styles.collectBtn}
          onPress={() => navigation.navigate('PaymentCapture', { item })}
        >
          <Text style={styles.collectBtnText}>💳  Record Payment</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { color: GRAY, fontSize: 16 },
  customerCard: {
    backgroundColor: '#fff',
    margin: 14,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 18 },
  customerName: { fontSize: 17, fontWeight: '800', color: '#111827' },
  customerPhone: { fontSize: 13, color: GRAY, marginTop: 2 },
  customerAddress: { fontSize: 12, color: GRAY, marginTop: 4, lineHeight: 16 },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 14,
    marginBottom: 14,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  actionBtnIcon: { fontSize: 22 },
  actionBtnLabel: { fontSize: 12, fontWeight: '700' },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 14,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  sectionTitle: {
    fontSize: 12,
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
  infoValue: { fontSize: 13, fontWeight: '600', color: '#111827' },
  overdueAlert: {
    backgroundColor: '#FEF2F2',
    marginHorizontal: 14,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  overdueAlertText: { color: DANGER, fontWeight: '600', fontSize: 13 },
  collectBtn: {
    backgroundColor: BRAND,
    marginHorizontal: 14,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  collectBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  paidBanner: {
    backgroundColor: '#D1FAE5',
    marginHorizontal: 14,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6EE7B7',
  },
  paidBannerText: { color: '#065F46', fontSize: 16, fontWeight: '800' },
});
