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
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';

type LoadingAction = 'signIn' | 'signUp' | null;

const MAX_ATTEMPTS   = 3;
const LOCKOUT_MS     = 30_000; // 30 seconds

export function SignInScreen() {
  const { colors } = useTheme();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState<LoadingAction>(null);
  const [error, setError]       = useState<string | null>(null);
  const [signedUp, setSignedUp] = useState(false);
  const passwordRef             = useRef<TextInputRef>(null);

  // Rate limiting state
  const failedAttemptsRef = useRef(0);
  const lockedUntilRef    = useRef<number>(0);

  function validate(): string | null {
    if (!email.trim())    return 'Please enter your email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.';
    if (!password)        return 'Please enter a password.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  function checkLockout(): boolean {
    const remaining = lockedUntilRef.current - Date.now();
    if (remaining > 0) {
      const secs = Math.ceil(remaining / 1000);
      setError(`Too many failed attempts. Please wait ${secs}s before trying again.`);
      return true;
    }
    return false;
  }

  function recordFailure() {
    failedAttemptsRef.current += 1;
    if (failedAttemptsRef.current >= MAX_ATTEMPTS) {
      lockedUntilRef.current = Date.now() + LOCKOUT_MS;
      failedAttemptsRef.current = 0;
    }
  }

  function recordSuccess() {
    failedAttemptsRef.current = 0;
    lockedUntilRef.current = 0;
  }

  async function handleSignIn() {
    if (checkLockout()) return;
    const err = validate();
    if (err) { setError(err); return; }

    setLoading('signIn');
    setError(null);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      recordFailure();
      setError('Sign-in failed. Check your credentials and try again.');
    } else {
      recordSuccess();
    }

    setLoading(null);
  }

  async function handleSignUp() {
    if (checkLockout()) return;
    const err = validate();
    if (err) { setError(err); return; }

    setLoading('signUp');
    setError(null);

    const { error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (authError) {
      recordFailure();
      setError('Could not create account. Please try again.');
    } else {
      recordSuccess();
      setSignedUp(true);
    }

    setLoading(null);
  }

  if (signedUp) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Check your email</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
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
          <Text style={[styles.linkText, { color: colors.iris }]}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const busy   = loading !== null;
  const locked = lockedUntilRef.current > Date.now();

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.wordmark, { color: colors.iris }]}>IRIS</Text>
        <Text style={[styles.tagline, { color: colors.textTertiary }]}>Real-time event intelligence</Text>

        <TextInput
          style={[styles.input, {
            borderColor: colors.border,
            backgroundColor: colors.bgInput,
            color: colors.textPrimary,
          }]}
          value={email}
          onChangeText={(v) => { setEmail(v); setError(null); }}
          placeholder="Email address"
          placeholderTextColor={colors.textTertiary}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy && !locked}
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />

        <TextInput
          ref={passwordRef}
          style={[styles.input, {
            borderColor: colors.border,
            backgroundColor: colors.bgInput,
            color: colors.textPrimary,
          }]}
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          placeholder="Password"
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={true}
          textContentType="password"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy && !locked}
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
        />

        {error && (
          <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
        )}

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.iris },
            (busy || locked) && styles.buttonDisabled,
          ]}
          onPress={handleSignIn}
          disabled={busy || locked}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={loading === 'signIn' ? 'Signing in' : 'Sign in'}
          accessibilityState={{ disabled: busy || locked }}
        >
          {loading === 'signIn'
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>Sign In</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.buttonSecondary,
            { borderColor: colors.iris },
            (busy || locked) && styles.buttonDisabled,
          ]}
          onPress={handleSignUp}
          disabled={busy || locked}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={loading === 'signUp' ? 'Creating account' : 'Sign up'}
          accessibilityState={{ disabled: busy || locked }}
        >
          {loading === 'signUp'
            ? <ActivityIndicator color={colors.iris} size="small" />
            : <Text style={[styles.buttonSecondaryText, { color: colors.iris }]}>Sign Up</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  },
  wordmark: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 6,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 13,
    letterSpacing: 0.3,
    marginBottom: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 28,
    lineHeight: 22,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    marginBottom: 12,
  },
  error: {
    fontSize: 13,
    marginBottom: 12,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonSecondaryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  link: {
    marginTop: 20,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
