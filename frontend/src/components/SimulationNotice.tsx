import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';

type SimulationNoticeProps = {
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const SIMULATION_NOTICE_TITLE = 'Development simulation';
export const SIMULATION_NOTICE_BODY =
  'All cash, positions, orders, returns, and distributions are simulated. No real money can be deposited, withdrawn, or traded. Displayed positions do not represent legal ownership, and simulated distributions are not earned investment income.';

export function SimulationNotice({ compact = false, style }: SimulationNoticeProps) {
  return (
    <View
      accessibilityRole="summary"
      style={[styles.root, compact && styles.rootCompact, style]}
      testID="simulation-notice"
    >
      <ShieldAlert size={compact ? 16 : 18} color="#92400e" />
      <View style={styles.copy}>
        <Text style={[styles.title, compact && styles.titleCompact]}>
          {SIMULATION_NOTICE_TITLE}
        </Text>
        <Text style={[styles.body, compact && styles.bodyCompact]}>
          {SIMULATION_NOTICE_BODY}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  rootCompact: {
    borderRadius: 14,
    padding: 11,
  },
  copy: { flex: 1 },
  title: {
    color: '#78350f',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 3,
  },
  titleCompact: { fontSize: 12 },
  body: {
    color: '#92400e',
    fontSize: 12,
    lineHeight: 18,
  },
  bodyCompact: {
    fontSize: 10,
    lineHeight: 15,
  },
});
