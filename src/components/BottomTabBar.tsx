import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import type { RootStackParamList } from '../types/navigation';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

interface Tab {
  key: 'EventList' | 'Profile';
  label: string;
  symbol: string;
  a11yLabel: string;
}

const TABS: Tab[] = [
  { key: 'EventList', label: 'Feed',    symbol: '◎', a11yLabel: 'Feed tab' },
  { key: 'Profile',   label: 'Profile', symbol: '○', a11yLabel: 'Profile tab' },
];

export function BottomTabBar() {
  const navigation = useNavigation<NavProp>();
  const route      = useRoute();
  const insets     = useSafeAreaInsets();
  const { colors } = useTheme();

  const activeKey = route.name;

  function handlePress(key: Tab['key']) {
    if (key === activeKey) return;

    if (key === 'EventList') {
      // Profile is always at index 1 directly above EventList in the stack —
      // goBack() is correct and preserves EventList scroll position.
      // (Profile is only reachable via this tab bar, never from EventDetail.)
      navigation.goBack();
    } else {
      navigation.navigate(key);
    }
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: insets.bottom,
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
        },
      ]}
    >
      {TABS.map(({ key, label, symbol, a11yLabel }) => {
        const isActive = activeKey === key;
        const tint = isActive ? colors.iris : colors.textTertiary;

        return (
          <TouchableOpacity
            key={key}
            style={styles.tab}
            onPress={() => handlePress(key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityLabel={a11yLabel}
            accessibilityState={{ selected: isActive }}
          >
            {/* Top-edge active indicator stripe */}
            {isActive && (
              <View style={[styles.activeIndicator, { backgroundColor: colors.iris }]} />
            )}
            <Text style={[styles.symbol, { color: tint }]}>{symbol}</Text>
            <Text style={[styles.label, { color: tint }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 10,
    gap: 3,
    position: 'relative',
    minHeight: 52,
  },
  symbol: {
    fontSize: 18,
    lineHeight: 22,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  activeIndicator: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 2,
    borderRadius: 1,
  },
});
