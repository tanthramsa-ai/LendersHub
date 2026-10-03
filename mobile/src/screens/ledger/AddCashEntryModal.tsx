import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { createCashEntry } from '../../api/ledger';
import { ENTRY_TYPES, QuickEntryType, validateQuickEntry } from '../../utils/ledger';
import { BRAND, DANGER, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function AddCashEntryModal({ visible, onClose, onSaved }: Props) {
  const [type, setType] = useState<QuickEntryType>('CASH_IN');
  const [date, setDate] = useState(todayYmd());
  const [amount, setAmount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isBank = type === 'BANK_IN' || type === 'BANK_OUT';

  function reset() {
    setType('CASH_IN'); setDate(todayYmd()); setAmount(''); setAccountName('');
    setReferenceNo(''); setRemarks(''); setError(null);
  }

  async function save() {
    if (saving) return;
    const result = validateQuickEntry({ type, date, amount, accountName, referenceNo, remarks });
    if (!result.ok) { setError(result.error); return; }
    setError(null);
    setSaving(true);
    try {
      await createCashEntry(result.body);
      reset();
      onSaved();
    } catch (e) {
      setError((e as Error)?.message || 'Could not save the entry. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Add cash entry</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}><Text style={s.close}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={s.typeRow}>
              {ENTRY_TYPES.map((t) => (
                <TouchableOpacity key={t.key} style={[s.typeChip, type === t.key && s.typeChipOn]} onPress={() => setType(t.key)}>
                  <Text style={[s.typeText, type === t.key && s.typeTextOn]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>Amount (₹)</Text>
            <TextInput style={s.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" maxLength={14} />

            <Text style={s.label}>Date (YYYY-MM-DD)</Text>
            <TextInput style={s.input} value={date} onChangeText={setDate} placeholder="2026-04-01" maxLength={10} autoCorrect={false} />

            {isBank && (
              <>
                <Text style={s.label}>Bank account name</Text>
                <TextInput style={s.input} value={accountName} onChangeText={setAccountName} placeholder="e.g. HDFC Current" maxLength={60} />
              </>
            )}

            <Text style={s.label}>Reference no. (optional)</Text>
            <TextInput style={s.input} value={referenceNo} onChangeText={setReferenceNo} maxLength={100} />

            <Text style={s.label}>Remarks (optional)</Text>
            <TextInput style={[s.input, s.multiline]} value={remarks} onChangeText={setRemarks} multiline maxLength={500} />

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity style={[s.save, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Save entry</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '92%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '700', color: '#111827' },
  close: { fontSize: 18, color: GRAY },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: GRAY_BORDER, backgroundColor: GRAY_LIGHT },
  typeChipOn: { backgroundColor: BRAND, borderColor: BRAND },
  typeText: { fontSize: 13, fontWeight: '600', color: GRAY },
  typeTextOn: { color: '#fff' },
  label: { fontSize: 12, fontWeight: '600', color: GRAY, marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: GRAY_BORDER, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#111827' },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  error: { color: DANGER, fontSize: 13, marginTop: 12 },
  save: { backgroundColor: BRAND, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18, marginBottom: 8 },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
