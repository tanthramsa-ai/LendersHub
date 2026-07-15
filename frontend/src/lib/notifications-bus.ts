const REFRESH_EVENT = 'lendershub:notifications-refresh';

/** Call after an action that generates a notification for the current user
 *  (close/reopen loan, record payment, undo payment) so the header bell
 *  updates immediately instead of waiting for its 60s poll. */
export function refreshNotificationBell(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function onNotificationBellRefresh(handler: () => void): () => void {
  window.addEventListener(REFRESH_EVENT, handler);
  return () => window.removeEventListener(REFRESH_EVENT, handler);
}
