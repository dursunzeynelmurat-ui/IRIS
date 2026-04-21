import { Component, ReactNode } from 'react';
import { Appearance, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.';
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    if (__DEV__) {
      console.error('[ErrorBoundary]', error, info.componentStack);
    }
  }

  reset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (this.state.hasError) {
      const isDark = Appearance.getColorScheme() === 'dark';
      const bg          = isDark ? '#0D1117' : '#FFFFFF';
      const textPrimary = isDark ? '#E6EDF3' : '#1A1A2E';
      const textMuted   = isDark ? '#8B949E' : '#5F6368';
      const border      = isDark ? '#30363D' : '#E8EAED';

      return (
        <View style={[styles.container, { backgroundColor: bg }]}>
          <Text style={[styles.title, { color: textPrimary }]}>
            Something went wrong
          </Text>
          <Text style={[styles.message, { color: textMuted }]}>
            {this.state.message}
          </Text>
          <TouchableOpacity
            style={[styles.button, { borderColor: border }]}
            onPress={this.reset}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={[styles.buttonText, { color: textPrimary }]}>
              Try again
            </Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
  },
  message: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
