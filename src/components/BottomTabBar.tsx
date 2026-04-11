import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import type { RootStackParamList } from '../types/navigation';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

// Tab height (excluding safe area — BottomTabBar adds insets.bottom internally).
export const TAB_BAR_HEIGHT = 52;

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
    if (key === activeKey) return; // already on this tab

    if (key === 'EventList') {
      // Reset the stack so Feed is always the root — gives clean tab-switch feel.
      navigation.reset({ index: 0, routes: [{ name: 'EventList' }] });
    } else {
      navigation.navigate(key);
    }
  }

  const containerStyle = [
    styles.container,
    {
      paddingBottom: insets.bottom,
      backgroundColor: colors.bgElevated,
      borderTopColor: colors.border,
    },
  ] as const;

  return (
    <View style={containerStyle}>
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
            <Text style={[styles.symbol, { color: tint }]}>{symbol}</Text>
            <Text style={[styles.label, { color: tint }]}>{label}</Text>
            {isActive && (
              <View style={[styles.activeIndicator, { backgroundColor: colors.iris }]} />
            )}
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
    height: undefined, // height is content-driven + paddingBottom
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    paddingBottom: 10,
    gap: 3,
    position: 'relative',
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
