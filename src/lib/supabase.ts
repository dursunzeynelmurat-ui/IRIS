import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables.\n' +
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.'
  );
}

// expo-secure-store has a ~2 KB per-key limit. Supabase sessions can exceed that,
// so we split large values into fixed-size chunks keyed as `<key>.0`, `<key>.1`, …
// and store the chunk count at `<key>.n`.
const CHUNK_SIZE = 1800;

const SecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = await SecureStore.getItemAsync(`${key}.n`);
      if (count !== null) {
        const chunks: string[] = [];
        for (let i = 0; i < parseInt(count, 10); i++) {
          const chunk = await SecureStore.getItemAsync(`${key}.${i}`);
          if (chunk === null) return null;
          chunks.push(chunk);
        }
        return chunks.join('');
      }
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const total = Math.ceil(value.length / CHUNK_SIZE);
    await SecureStore.setItemAsync(`${key}.n`, String(total));
    for (let i = 0; i < total; i++) {
      await SecureStore.setItemAsync(
        `${key}.${i}`,
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
      const count = await SecureStore.getItemAsync(`${key}.n`);
      if (count !== null) {
        for (let i = 0; i < parseInt(count, 10); i++) {
          await SecureStore.deleteItemAsync(`${key}.${i}`);
        }
        await SecureStore.deleteItemAsync(`${key}.n`);
      }
    } catch {
      // best-effort cleanup
    }
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
