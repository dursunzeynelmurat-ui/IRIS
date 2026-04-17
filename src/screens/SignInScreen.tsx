import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  type TextInput as TextInputRef,
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
  const passwordRef             = useRef<TextInputRef>(null);

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
          placeholderTextColor="#9AA0A6"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />

        <TextInput
          ref={passwordRef}
          style={styles.input}
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          placeholder="Password"
          placeholderTextColor="#9AA0A6"
          secureTextEntry={true}
          textContentType="password"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
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
            ? <ActivityIndicator color="#FFFFFF" size="small" />
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
            ? <ActivityIndicator color="#1A73E8" size="small" />
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
    backgroundColor: '#FFFFFF',
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
    backgroundColor: '#FFFFFF',
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    color: '#1A73E8',
    letterSpacing: 6,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 13,
    color: '#9AA0A6',
    letterSpacing: 0.3,
    marginBottom: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#5F6368',
    marginBottom: 28,
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E8EAED',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 12,
    backgroundColor: '#F2F4F7',
    color: '#1A1A2E',
  },
  error: {
    fontSize: 13,
    color: '#C5221F',
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#1A73E8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: '#1A73E8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonSecondaryText: {
    color: '#1A73E8',
    fontSize: 15,
    fontWeight: '600',
  },
  link: {
    marginTop: 20,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1A73E8',
    textDecorationLine: 'underline',
  },
});
