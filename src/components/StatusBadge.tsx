import { StyleSheet, Text, View } from 'react-native';
import { STATUS_COLOR, STATUS_LABEL } from '../lib/eventUtils';
import { EventStatus } from '../types';

interface StatusBadgeProps {
  status: EventStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const color = STATUS_COLOR[status];
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: color + '18' }]}>
      <Text style={[styles.text, { color }]}>
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
