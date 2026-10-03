import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, SectionList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import {
  fetchLedgerSummary, fetchLedgerTransactions, ledgerPdfPath, LedgerBucket, LedgerPage, LedgerRow, LedgerSummary,
} from '../../api/ledger';
import { shareLedgerPdf } from '../../services/ledgerShare';
import {
  canPostEntry, currentFy, fmtMoney, fyLabel, groupByDate, kindMeta, LedgerPeriod, seesBalances, signedAmount,
} from '../../utils/ledger';
import { fmtDate } from '../../utils/format';
import { BRAND, BRAND_LIGHT, DANGER, GRAY, GRAY_BORDER, GRAY_LIGHT, SUCCESS } from '../../utils/constants';
import AddCashEntryModal from './AddCashEntryModal';

const PAGE = 50;

type Card = { label: string; value: number | null };

function summaryCards(s: LedgerSummary): Card[] {
  const c = s.cards;
  const all: Card[] = [
    { label: 'Total capital', value: c.totalCapital },
    { label: 'Fund available', value: c.fundAvailable },
    { label: 'Total lent', value: c.totalLent },
    { label: 'Outstanding principal', value: c.outstandingPrincipal },
    { label: 'Outstanding interest', value: c.outstandingInterest },
    { label: 'Interest collected', value: c.interestCollected },
    { label: 'Principal recovered', value: c.principalRecovered },
    { label: 'Cash in hand', value: c.cashInHand },
    { label: 'Bank balance', value: c.bankBalance },
  ];
  // The server returns null for figures the role may not see: show only what is present.
  return all.filter((x) => x.value !== null && x.value !== undefined);
}

export default function LedgerScreen() {
  const role = useAuthStore((st) => st.session?.user.role);
  const [fy, setFy] = useState<number>(currentFy());
  const [period, setPeriod] = useState<LedgerPeriod>('monthly');
  const [bucket, setBucket] = useState<LedgerBucket | null>(null);

  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageInfo, setPageInfo] = useState<Pick<LedgerPage, 'openingBalance' | 'closingBalance' | 'totalCredit' | 'totalDebit'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // A request counter lets a slow earlier response be ignored once the filters have changed.
  const seq = useRef(0);

  const range = bucket ? { from: bucket.from, to: bucket.to } : null;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    try {
      const sum = await fetchLedgerSummary({ fy, period });
      if (mine !== seq.current) return;
      setSummary(sum);
      const q = { fy, period: range ? ('custom' as const) : period, ...(range ?? {}), order: 'desc' as const, page: 1, limit: PAGE };
      const tx = await fetchLedgerTransactions(q);
      if (mine !== seq.current) return;
      setRows(tx.rows);
      setTotal(tx.total);
      setPageInfo(tx);
    } catch (e) {
      if (mine !== seq.current) return;
      setError((e as Error)?.message || 'Could not load the ledger');
    } finally {
      if (mine === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, [fy, period, range?.from, range?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setLoading(true); load(); }, [load]);

  async function loadMore() {
    if (loadingMore || loading || rows.length >= total) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const tx = await fetchLedgerTransactions({
        fy, period: range ? 'custom' : period, ...(range ?? {}), order: 'desc',
        page: Math.floor(rows.length / PAGE) + 1, limit: PAGE,
      });
      if (mine !== seq.current) return;
      setRows((prev) => [...prev, ...tx.rows]);
    } catch {
      // Keep what is shown; pulling to refresh retries.
    } finally {
      setLoadingMore(false);
    }
  }

  async function sharePdf() {
    if (sharing) return;
    setSharing(true);
    try {
      await shareLedgerPdf(
        ledgerPdfPath({ fy, period: range ? 'custom' : period, ...(range ?? {}) }),
        `ledger-${fy}-${String((fy + 1) % 100).padStart(2, '0')}.pdf`,
      );
    } catch (e) {
      Alert.alert('Could not share', (e as Error)?.message || 'Please try again.');
    } finally {
      setSharing(false);
    }
  }

  const cards = useMemo(() => (summary ? summaryCards(summary) : []), [summary]);
  const sections = useMemo(() => groupByDate(rows).map((g) => ({ title: g.date, data: g.rows })), [rows]);
  const fys = summary?.availableFys?.length ? summary.availableFys : [fy];

  const header = (
    <View>
      <View style={s.filterRow}>
        {(['monthly', 'quarterly'] as LedgerPeriod[]).map((p) => (
          <TouchableOpacity key={p} style={[s.chip, period === p && s.chipOn]} onPress={() => { setPeriod(p); setBucket(null); }}>
            <Text style={[s.chipText, period === p && s.chipTextOn]}>{p === 'monthly' ? 'Monthly' : 'Quarterly'}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        {fys.length > 1 && (
          <TouchableOpacity
            style={s.chip}
            onPress={() => { const i = fys.indexOf(fy); setFy(fys[(i + 1) % fys.length]); setBucket(null); }}
          >
            <Text style={s.chipText}>{fyLabel(fy)} ▾</Text>
          </TouchableOpacity>
        )}
        {fys.length <= 1 && <Text style={s.fyText}>{fyLabel(fy)}</Text>}
      </View>

      <View style={s.cardGrid}>
        {cards.map((c) => (
          <View key={c.label} style={s.card}>
            <Text style={s.cardLabel}>{c.label}</Text>
            <Text style={s.cardValue} numberOfLines={1} adjustsFontSizeToFit>{fmtMoney(c.value)}</Text>
          </View>
        ))}
      </View>

      {summary && summary.buckets.length > 0 && (
        <View style={s.bucketRow}>
          <TouchableOpacity style={[s.chip, !bucket && s.chipOn]} onPress={() => setBucket(null)}>
            <Text style={[s.chipText, !bucket && s.chipTextOn]}>Whole year</Text>
          </TouchableOpacity>
          {summary.buckets.map((b) => (
            <TouchableOpacity key={b.key} style={[s.chip, bucket?.key === b.key && s.chipOn]} onPress={() => setBucket(b)}>
              <Text style={[s.chipText, bucket?.key === b.key && s.chipTextOn]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {pageInfo && (
        <View style={s.totals}>
          <Text style={s.totalsText}>In {fmtMoney(pageInfo.totalCredit)}</Text>
          <Text style={s.totalsText}>Out {fmtMoney(pageInfo.totalDebit)}</Text>
          {seesBalances(role) && <Text style={s.totalsText}>Closing {fmtMoney(pageInfo.closingBalance)}</Text>}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.titleRow}>
        <Text style={s.title}>Ledger</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={s.action} onPress={sharePdf} disabled={sharing}>
            {sharing ? <ActivityIndicator size="small" color={BRAND} /> : <Text style={s.actionText}>Share PDF</Text>}
          </TouchableOpacity>
          {canPostEntry(role) && (
            <TouchableOpacity style={[s.action, s.actionPrimary]} onPress={() => setShowAdd(true)}>
              <Text style={[s.actionText, { color: '#fff' }]}>+ Add entry</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading && !summary ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={BRAND} />
      ) : error && !summary ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity style={[s.action, s.actionPrimary, { marginTop: 12 }]} onPress={() => { setLoading(true); load(); }}>
            <Text style={[s.actionText, { color: '#fff' }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={s.dateHeader}>{fmtDate(section.title)}</Text>}
          renderItem={({ item }) => <Row row={item} showBalance={seesBalances(role)} />}
          ListEmptyComponent={<Text style={s.empty}>No transactions in this period</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={BRAND} /> : null}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={BRAND} />}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}

      <AddCashEntryModal visible={showAdd} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); setLoading(true); load(); }} />
    </SafeAreaView>
  );
}

function Row({ row, showBalance }: { row: LedgerRow; showBalance: boolean }) {
  const meta = kindMeta(row.kind);
  const amt = signedAmount(row);
  const color = amt.tone === 'in' ? SUCCESS : amt.tone === 'out' ? DANGER : GRAY;
  const subtitle = [row.customerName, row.loanNumber, row.accountName && row.accountName !== 'CASH' ? row.accountName : null]
    .filter(Boolean).join(' · ');
  return (
    <View style={s.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={s.rowTitle}>{meta.label}</Text>
        {subtitle ? <Text style={s.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
        {row.remarks ? <Text style={s.rowSub} numberOfLines={2}>{row.remarks}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[s.rowAmt, { color }]}>{amt.text}</Text>
        {showBalance && row.runningBalance !== null ? <Text style={s.rowBal}>{fmtMoney(row.runningBalance)}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827' },
  action: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: BRAND, minWidth: 40, alignItems: 'center' },
  actionPrimary: { backgroundColor: BRAND },
  actionText: { fontSize: 13, fontWeight: '700', color: BRAND },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  fyText: { fontSize: 13, fontWeight: '700', color: GRAY },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: GRAY_BORDER, backgroundColor: GRAY_LIGHT },
  chipOn: { backgroundColor: BRAND, borderColor: BRAND },
  chipText: { fontSize: 12, fontWeight: '600', color: GRAY },
  chipTextOn: { color: '#fff' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  card: { width: '50%', padding: 4 },
  cardLabel: { fontSize: 11, color: GRAY, backgroundColor: BRAND_LIGHT, paddingHorizontal: 10, paddingTop: 8, borderTopLeftRadius: 10, borderTopRightRadius: 10, overflow: 'hidden' },
  cardValue: { fontSize: 16, fontWeight: '700', color: BRAND, backgroundColor: BRAND_LIGHT, paddingHorizontal: 10, paddingBottom: 8, paddingTop: 2, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden' },
  bucketRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  totals: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, marginTop: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: GRAY_BORDER },
  totalsText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  dateHeader: { fontSize: 12, fontWeight: '700', color: GRAY, backgroundColor: GRAY_LIGHT, paddingHorizontal: 16, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: GRAY_BORDER },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  rowSub: { fontSize: 12, color: GRAY, marginTop: 1 },
  rowAmt: { fontSize: 14, fontWeight: '700' },
  rowBal: { fontSize: 11, color: GRAY, marginTop: 2 },
  empty: { textAlign: 'center', color: GRAY, marginTop: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: DANGER, textAlign: 'center' },
});
