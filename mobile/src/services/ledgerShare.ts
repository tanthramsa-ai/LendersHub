import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { API_URL, getAuthToken } from '../api/client';

/**
 * Downloads the statement PDF (the endpoint needs the Authorization header, so it cannot be opened
 * as a plain link) into the app's cache and hands it to the system share sheet: save to Files,
 * WhatsApp, email, print.
 */
export async function shareLedgerPdf(path: string, filename = 'ledger-statement.pdf'): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device');
  }
  const token = await getAuthToken();
  const target = new File(Paths.cache, filename);
  let file: File;
  try {
    file = await File.downloadFileAsync(`${API_URL}${path}`, target, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      idempotent: true, // a previous statement with the same name is simply replaced
    });
  } catch (e) {
    // expo-file-system reports a non-2xx response as an error that carries the status code.
    const status = /\b(4\d\d|5\d\d)\b/.exec(String((e as Error)?.message ?? ''))?.[1];
    if (status === '401') throw new Error('Your session has expired. Please sign in again.');
    if (status === '403') throw new Error('You do not have access to this statement.');
    if (status === '400') throw new Error('That period has too many rows to export. Pick a shorter period.');
    throw new Error(status ? `Could not prepare the PDF (error ${status}).` : 'Could not download the PDF. Check your connection.');
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Ledger statement' });
}
