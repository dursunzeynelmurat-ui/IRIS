import { Component, ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Top-level error boundary. Catches unhandled render errors so the user sees
 * a recovery screen instead of a blank crash. Re-mounts children on retry.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred.';
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.message}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={this.reset}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={styles.buttonText}>Try again</Text>
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
    backgroundColor: '#0d0d0d',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f2f2f2',
    marginBottom: 10,
  },
  message: {
    fontSize: 13,
    color: '#8e8e93',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  button: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#3a3a3c',
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f2f2f2',
  },
});
