import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Switch,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../../store/authStore';
import { clearSession } from '../../api/auth';
import { syncPendingPayments } from '../../db/syncService';
import { BRAND, ACCENT, DANGER, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';

export default function ProfileScreen() {
  const { session, logout } = useAuthStore();
  const [notifications, setNotifications] = useState(true);
  const [locationTracking, setLocationTracking] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function handleLogout() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await clearSession();
            logout();
          },
        },
      ],
    );
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const { synced, failed } = await syncPendingPayments();
      Alert.alert('Sync Complete', `Synced: ${synced} payment(s)\nFailed: ${failed}`);
    } catch {
      Alert.alert('Sync failed', 'Check your internet connection and try again.');
    } finally {
      setSyncing(false);
    }
  }

  if (!session) return null;

  const { user, tenant } = session;
  const initials = `${user.firstName[0]}${user.lastName[0]}`;

  const roleColors: Record<string, { bg: string; text: string }> = {
    ADMIN:        { bg: '#DBEAFE', text: '#1E40AF' },
    LOAN_OFFICER: { bg: '#D1FAE5', text: '#065F46' },
    COLLECTOR:    { bg: '#FEF3C7', text: '#92400E' },
    VIEWER:       { bg: '#F3F4F6', text: '#374151' },
  };
  const roleColor = roleColors[user.role] ?? roleColors.VIEWER;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 60 }}>
      <StatusBar style="light" />

      {/* Profile header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>{user.firstName} {user.lastName}</Text>
        <Text style={styles.email}>{user.email}</Text>
        <View style={[styles.roleBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
          <Text style={styles.roleBadgeText}>{user.role.replace('_', ' ')}</Text>
        </View>
      </View>

      {/* Tenant info */}
      <View style={styles.tenantCard}>
        <View style={styles.tenantLogo}>
          <Text style={styles.tenantLogoText}>LH</Text>
        </View>
        <View>
          <Text style={styles.tenantName}>{tenant.companyName}</Text>
          <Text style={styles.tenantDomain}>{tenant.subdomain}.lendershub.com</Text>
        </View>
      </View>

      {/* Settings */}
      <Text style={styles.sectionTitle}>Preferences</Text>
      <View style={styles.settingsCard}>
        <View style={styles.settingRow}>
          <View>
            <Text style={styles.settingLabel}>Push Notifications</Text>
            <Text style={styles.settingHint}>Collection reminders and alerts</Text>
          </View>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ true: BRAND }}
          />
        </View>
        <View style={[styles.settingRow, { borderBottomWidth: 0 }]}>
          <View>
            <Text style={styles.settingLabel}>Location Tracking</Text>
            <Text style={styles.settingHint}>Track visits for collection report</Text>
          </View>
          <Switch
            value={locationTracking}
            onValueChange={setLocationTracking}
            trackColor={{ true: BRAND }}
          />
        </View>
      </View>

      {/* Actions */}
      <Text style={styles.sectionTitle}>Actions</Text>
      <View style={styles.settingsCard}>
        <TouchableOpacity style={styles.actionRow} onPress={handleSync} disabled={syncing}>
          <Text style={styles.actionIcon}>☁</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionLabel}>{syncing ? 'Syncing…' : 'Sync Offline Payments'}</Text>
            <Text style={styles.actionHint}>Push pending payments to server</Text>
          </View>
          <Text style={styles.actionChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.actionIcon}>📊</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionLabel}>My Collection Report</Text>
            <Text style={styles.actionHint}>View your performance metrics</Text>
          </View>
          <Text style={styles.actionChevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* App info */}
      <Text style={styles.sectionTitle}>App</Text>
      <View style={styles.settingsCard}>
        {[
          { label: 'Version', value: '1.0.0' },
          { label: 'Build', value: 'Expo SDK 54' },
          { label: 'Environment', value: 'Production' },
        ].map((r, i, arr) => (
          <View key={r.label} style={[styles.infoRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>{r.label}</Text>
            <Text style={styles.infoValue}>{r.value}</Text>
          </View>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    backgroundColor: BRAND,
    paddingTop: 55,
    paddingBottom: 32,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '900' },
  name: { color: '#fff', fontSize: 20, fontWeight: '800' },
  email: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 4 },
  roleBadge: {
    marginTop: 10,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  roleBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tenantCard: {
    backgroundColor: '#fff',
    marginHorizontal: 14,
    marginTop: 14,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
  },
  tenantLogo: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tenantLogoText: { color: '#fff', fontWeight: '900', fontSize: 13 },
  tenantName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  tenantDomain: { fontSize: 12, color: GRAY, marginTop: 2 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginHorizontal: 14,
    marginTop: 20,
    marginBottom: 8,
  },
  settingsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_LIGHT,
  },
  settingLabel: { fontSize: 14, fontWeight: '600', color: '#111827' },
  settingHint: { fontSize: 11, color: GRAY, marginTop: 2 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_LIGHT,
    gap: 12,
  },
  actionIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  actionLabel: { fontSize: 14, fontWeight: '600', color: '#111827' },
  actionHint: { fontSize: 11, color: GRAY, marginTop: 2 },
  actionChevron: { color: GRAY, fontSize: 20 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: GRAY_LIGHT,
  },
  infoLabel: { fontSize: 13, color: GRAY },
  infoValue: { fontSize: 13, fontWeight: '600', color: '#111827' },
  logoutBtn: {
    marginHorizontal: 14,
    marginTop: 20,
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutText: { color: DANGER, fontWeight: '700', fontSize: 15 },
});
