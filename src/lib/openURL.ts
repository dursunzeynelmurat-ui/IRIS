import { Linking } from 'react-native';

/**
 * Opens a URL only when its scheme is http:// or https://.
 * All other schemes (javascript:, data:, tel:, mailto:, etc.) are silently
 * blocked — source URLs come from the database and must not be trusted to
 * carry safe schemes.
 */
export function safeOpenURL(url: string | null): void {
  if (!url) return;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) {
    if (__DEV__) {
      console.warn('[safeOpenURL] Blocked non-http(s) URL:', trimmed);
    }
    return;
  }
  Linking.openURL(trimmed).catch(() => {
    // Device unable to handle the URL — silently ignore
  });
}
