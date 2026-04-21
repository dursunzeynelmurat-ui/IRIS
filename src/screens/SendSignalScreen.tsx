import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../hooks/useAuth';
import { useSignalSubmission } from '../hooks/useSignalSubmission';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'SendSignal'>;

const MAX_LENGTH = 140;

// ── Success state ─────────────────────────────────────────────

function SuccessView({ onReset }: { onReset: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.successContainer, { backgroundColor: colors.bg }]}>
      <Text style={[styles.successTitle, { color: colors.textPrimary }]}>
        Signal received.
      </Text>
      <Text style={[styles.successBody, { color: colors.textSecondary }]}>
        IRIS will review your submission. If it's relevant, it may inform event updates or help surface new developments.
      </Text>
      <TouchableOpacity
        style={[styles.resetBtn, { borderColor: colors.border }]}
        onPress={onReset}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Submit another signal"
      >
        <Text style={[styles.resetBtnText, { color: colors.textPrimary }]}>
          Submit another
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────

export function SendSignalScreen({ route }: Props) {
  const { colors } = useTheme();
  const { userId } = useAuth();
  const insets     = useSafeAreaInsets();

  const eventId    = route.params?.eventId;
  const eventTitle = route.params?.eventTitle;

  const [content, setContent] = useState('');

  const { submitting, success, error, cooldownRemaining, submit, reset } =
    useSignalSubmission(userId);

  const remaining  = MAX_LENGTH - content.length;
  const isOverLimit = remaining < 0;
  const canSubmit  = content.trim().length > 0 && !isOverLimit && !submitting && cooldownRemaining === 0;

  if (success) {
    return <SuccessView onReset={() => { reset(); setContent(''); }} />;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 24) + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Event context badge ── */}
        {!!eventTitle && (
          <View style={[styles.contextBadge, { backgroundColor: colors.irisSubtle, borderColor: colors.border }]}>
            <Text style={[styles.contextLabel, { color: colors.iris }]}>
              Related event
            </Text>
            <Text
              style={[styles.contextTitle, { color: colors.textSecondary }]}
              numberOfLines={2}
            >
              {eventTitle}
            </Text>
          </View>
        )}

        {/* ── Explanatory copy ── */}
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Submit a signal to IRIS for review. Signals are processed privately — they are not public comments. If relevant, a signal may inform event updates or help surface new developments.
        </Text>

        {/* ── Input area ── */}
        <View
          style={[
            styles.inputContainer,
            {
              borderColor: isOverLimit ? colors.danger : colors.border,
              backgroundColor: colors.bgInput,
            },
          ]}
        >
          <TextInput
            style={[styles.input, { color: colors.textPrimary }]}
            value={content}
            onChangeText={setContent}
            placeholder="Describe what you know…"
            placeholderTextColor={colors.textTertiary}
            multiline
            textAlignVertical="top"
            autoFocus
            accessibilityLabel="Signal content"
            accessibilityHint="Describe your signal. Maximum 140 characters."
          />
          <Text
            style={[
              styles.counter,
              {
                color: isOverLimit
                  ? colors.danger
                  : remaining <= 20
                    ? colors.textSecondary
                    : colors.textTertiary,
              },
            ]}
          >
            {remaining}
          </Text>
        </View>

        {/* ── Cooldown notice ── */}
        {cooldownRemaining > 0 && (
          <Text style={[styles.cooldownText, { color: colors.textTertiary }]}>
            Next signal available in {cooldownRemaining}s
          </Text>
        )}

        {/* ── Error ── */}
        {!!error && (
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
        )}

        {/* ── Submit ── */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: colors.iris },
            !canSubmit && styles.submitBtnDisabled,
          ]}
          onPress={() => submit(content, eventId)}
          disabled={!canSubmit}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={submitting ? 'Submitting signal' : 'Submit signal'}
          accessibilityState={{ disabled: !canSubmit }}
        >
          {submitting
            ? <ActivityIndicator color="#FFFFFF" size="small" />
            : <Text style={styles.submitBtnText}>Submit Signal</Text>
          }
        </TouchableOpacity>

        {/* ── Footer disclaimer ── */}
        <Text style={[styles.disclaimer, { color: colors.textTertiary }]}>
          Signals feed the IRIS intelligence pipeline and are not shared publicly.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: 20,
  },

  // ── Success ──
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  successBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  resetBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  resetBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Context badge ──
  contextBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 20,
    gap: 4,
  },
  contextLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  contextTitle: {
    fontSize: 14,
    lineHeight: 20,
  },

  // ── Description ──
  description: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20,
  },

  // ── Input ──
  inputContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    minHeight: 120,
  },
  input: {
    fontSize: 15,
    lineHeight: 22,
    minHeight: 80,
  },
  counter: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'right',
    marginTop: 8,
  },

  // ── Cooldown / error ──
  cooldownText: {
    fontSize: 13,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    marginBottom: 12,
  },

  // ── Submit ──
  submitBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Disclaimer ──
  disclaimer: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
