import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

export function SignInScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendLink() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);
    setError(null);

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: true },
    });

    if (authError) {
      console.error('[SignIn]', authError);
      setError('Could not send sign-in link. Please try again.');
    } else {
      setSent(true);
    }

    setLoading(false);
  }

  if (sent) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          A sign-in link was sent to {email.trim()}.
        </Text>
        <TouchableOpacity onPress={() => setSent(false)} style={styles.link}>
          <Text style={styles.linkText}>Use a different email</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.form}>
        <Text style={styles.title}>IRIS</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={(v) => { setEmail(v); setError(null); }}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSendLink}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.buttonText}>Send Sign-in Link</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  form: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    marginBottom: 28,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 10,
  },
  error: {
    fontSize: 13,
    color: '#c00',
    marginBottom: 10,
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 6,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  link: {
    marginTop: 20,
  },
  linkText: {
    fontSize: 14,
    color: '#555',
    textDecorationLine: 'underline',
  },
});
