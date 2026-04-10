import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

type LoadingAction = 'signIn' | 'signUp' | null;

export function SignInScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState<LoadingAction>(null);
  const [error, setError]       = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);

  function validate(): string | null {
    if (!email.trim())    return 'Please enter your email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.';
    if (!password)        return 'Please enter a password.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  async function handleSignIn() {
    const err = validate();
    if (err) { setError(err); return; }

    setLoading('signIn');
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      console.error('[SignIn]', authError);
      setError('Invalid email or password. Please try again.');
    }
    // On success: onAuthStateChange fires → useAuth updates userId → App.tsx
    // renders the main stack automatically. No manual navigation needed.

    setLoading(null);
  }

  async function handleSignUp() {
    const err = validate();
    if (err) { setError(err); return; }

    setLoading('signUp');
    setError(null);

    const { error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (authError) {
      console.error('[SignUp]', authError);
      setError('Could not create account. Please try again.');
    } else {
      setSignedUp(true);
    }

    setLoading(null);
  }

  if (signedUp) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.subtitle}>
          A confirmation link was sent to {email.trim()}.{'\n'}
          Confirm your account, then sign in.
        </Text>
        <TouchableOpacity
          onPress={() => setSignedUp(false)}
          style={styles.link}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
        >
          <Text style={styles.linkText}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const busy = loading !== null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.wordmark}>IRIS</Text>
        <Text style={styles.tagline}>Real-time event intelligence</Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={(v) => { setEmail(v); setError(null); }}
          placeholder="Email address"
          placeholderTextColor="#636366"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!!(!busy)}
          returnKeyType="next"
        />

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          placeholder="Password"
          placeholderTextColor="#636366"
          secureTextEntry={true}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!!(!busy)}
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.button, !!busy && styles.buttonDisabled]}
          onPress={handleSignIn}
          disabled={!!busy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={loading === 'signIn' ? 'Signing in' : 'Sign in'}
          accessibilityState={{ disabled: !!busy }}
        >
          {loading === 'signIn'
            ? <ActivityIndicator color="#0d0d0d" size="small" />
            : <Text style={styles.buttonText}>Sign In</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.buttonSecondary, !!busy && styles.buttonDisabled]}
          onPress={handleSignUp}
          disabled={!!busy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={loading === 'signUp' ? 'Creating account' : 'Sign up'}
          accessibilityState={{ disabled: !!busy }}
        >
          {loading === 'signUp'
            ? <ActivityIndicator color="#f2f2f2" size="small" />
            : <Text style={styles.buttonSecondaryText}>Sign Up</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  form: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#0d0d0d',
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    color: '#f2f2f2',
    letterSpacing: 6,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 13,
    color: '#636366',
    letterSpacing: 0.3,
    marginBottom: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f2f2f2',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#8e8e93',
    marginBottom: 28,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 12,
    backgroundColor: '#1c1c1e',
    color: '#f2f2f2',
  },
  error: {
    fontSize: 13,
    color: '#ff453a',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#f2f2f2',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#0d0d0d',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonSecondaryText: {
    color: '#f2f2f2',
    fontSize: 15,
    fontWeight: '600',
  },
  link: {
    marginTop: 20,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#aeaeb2',
    textDecorationLine: 'underline',
  },
});
