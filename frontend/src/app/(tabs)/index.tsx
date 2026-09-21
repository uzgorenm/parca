import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { TrendingUp, ArrowUpRight, PieChart, LogOut, User as UserIcon, TrendingDown } from 'lucide-react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { SimulationNotice } from '../../components/SimulationNotice';

type Timeframe = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000,
  '1M': 30 * 24 * 60 * 60 * 1000,
  '3M': 90 * 24 * 60 * 60 * 1000,
  '1Y': 365 * 24 * 60 * 60 * 1000,
  'ALL': 10 * 365 * 24 * 60 * 60 * 1000, // 10 years
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 48;
const CHART_HEIGHT = 140;
const CHART_PADDING = 8;

function buildSvgPath(points: { timestamp: number; value: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const x = CHART_PADDING;
    const y = CHART_HEIGHT / 2;
    return `M${x},${y} L${CHART_WIDTH - CHART_PADDING},${y}`;
  }

  const minV = Math.min(...points.map((p) => p.value));
  const maxV = Math.max(...points.map((p) => p.value));
  const range = maxV - minV || 1;

  const minT = points[0].timestamp;
  const maxT = points[points.length - 1].timestamp;
  const timeRange = maxT - minT || 1;

  const toX = (t: number) =>
    CHART_PADDING + ((t - minT) / timeRange) * (CHART_WIDTH - CHART_PADDING * 2);
  const toY = (v: number) =>
    CHART_PADDING + (1 - (v - minV) / range) * (CHART_HEIGHT - CHART_PADDING * 2);

  const coords = points.map((p) => ({ x: toX(p.timestamp), y: toY(p.value) }));

  // Smooth cubic bezier
  let d = `M${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cpX = (prev.x + curr.x) / 2;
    d += ` C${cpX},${prev.y} ${cpX},${curr.y} ${curr.x},${curr.y}`;
  }
  return d;
}

function buildGradientPath(points: { timestamp: number; value: number }[]): string {
  const linePath = buildSvgPath(points);
  if (!linePath) return '';
  return (
    linePath +
    ` L${CHART_WIDTH - CHART_PADDING},${CHART_HEIGHT} L${CHART_PADDING},${CHART_HEIGHT} Z`
  );
}

export default function PortfolioScreen() {
  const router = useRouter();
  const { isLoaded, signOut } = useAuth();
  const { user } = useUser();
  const [timeframe, setTimeframe] = useState<Timeframe>('1M');

  const now = useMemo(() => Date.now(), []);
  const since = now - TIMEFRAME_MS[timeframe];

  const holdings = useQuery(api.trading.getHoldings, {});
  const cashBalance = useQuery(api.trading.getUserBalance, {});
  const priceHistory = useQuery(api.trading.getPortfolioHistory, { since });

  if (!isLoaded) return null;

  const portfolioValue =
    holdings?.reduce((acc, h) => acc + h.shares_owned * h.current_price, 0) || 0;
  const totalValue = portfolioValue + (cashBalance || 0);

  // Chart data
  const chartPoints = priceHistory || [];
  const hasChart = chartPoints.length > 1;

  const firstValue = chartPoints[0]?.value ?? totalValue;
  const lastValue = chartPoints[chartPoints.length - 1]?.value ?? totalValue;
  const change = lastValue - firstValue;
  const changePct = firstValue > 0 ? (change / firstValue) * 100 : 0;
  const isUp = change >= 0;

  const primaryColor = isUp ? '#1E3A8A' : '#ef4444';
  const linePath = buildSvgPath(chartPoints);
  const gradientPath = buildGradientPath(chartPoints);

  return (
    <ScrollView style={styles.root} showsVerticalScrollIndicator={false}>
      {/* User Header */}
      <View style={styles.userHeader}>
        <View style={styles.userInfo}>
          <View style={styles.userAvatar}>
            <UserIcon size={20} color="#6b7280" />
          </View>
          <View>
            <Text style={styles.userLabel}>Account</Text>
            <Text style={styles.userEmail}>{user?.primaryEmailAddress?.emailAddress}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => signOut()} style={styles.signOutBtn}>
          <LogOut size={16} color="#ef4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.noticeWrap}>
        <SimulationNotice />
      </View>

      {/* Portfolio Value */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Simulated Account Value</Text>
        <Text style={styles.portfolioValue}>
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
        <View style={styles.changeRow}>
          <View style={[styles.changePill, { backgroundColor: isUp ? 'rgba(30,58,138,0.08)' : 'rgba(239,68,68,0.08)' }]}>
            {isUp
              ? <TrendingUp size={14} color={primaryColor} />
              : <TrendingDown size={14} color={primaryColor} />
            }
            <Text style={[styles.changeText, { color: primaryColor }]}>
              {isUp ? '+' : ''}${Math.abs(change).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
            </Text>
          </View>
          <Text style={styles.changeSubtext}>{timeframe}</Text>
        </View>

        {/* Simulated cash balance */}
        <View style={styles.balanceRow}>
          <View>
            <Text style={styles.sectionLabel}>Simulated Cash</Text>
            <Text style={styles.balanceValue}>
              ${(cashBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={styles.noDepositsBadge}>
            <Text style={styles.noDepositsText}>No deposits</Text>
          </View>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartContainer}>
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
          <Defs>
            <LinearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={primaryColor} stopOpacity={0.18} />
              <Stop offset="100%" stopColor={primaryColor} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {hasChart ? (
            <>
              <Path d={gradientPath} fill="url(#gradient)" />
              <Path d={linePath} fill="none" stroke={primaryColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </>
          ) : (
            // Flat placeholder line
            <Path
              d={`M${CHART_PADDING},${CHART_HEIGHT / 2} L${CHART_WIDTH - CHART_PADDING},${CHART_HEIGHT / 2}`}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth={2}
              strokeDasharray="6,4"
            />
          )}
        </Svg>

        {/* Timeframe buttons */}
        <View style={styles.timeframes}>
          {(['1D', '1W', '1M', '3M', '1Y', 'ALL'] as Timeframe[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTimeframe(t)}
              style={[styles.timeBtn, timeframe === t && styles.timeBtnActive]}
              activeOpacity={0.7}
            >
              <Text style={[styles.timeBtnText, timeframe === t && { color: primaryColor }]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {!hasChart && (
          <Text style={styles.noDataLabel}>
            {chartPoints.length === 0
              ? 'No trade history yet — place a trade to see your chart'
              : 'Not enough data for this timeframe'}
          </Text>
        )}
      </View>

      {/* Holdings */}
      <View style={styles.section}>
        <Text style={styles.holdingsTitle}>Simulated Positions</Text>
        {holdings?.map((holding) => (
          <TouchableOpacity
            key={holding._id}
            activeOpacity={0.7}
            onPress={() => router.push(`/property/${holding.property_id}`)}
            style={styles.holdingCard}
          >
            <View style={styles.holdingLeft}>
              <View style={styles.holdingIcon}>
                <PieChart size={24} color="#1E3A8A" />
              </View>
              <View>
                <Text style={styles.holdingAddress}>{holding.address}</Text>
                <Text style={styles.holdingShares}>{holding.shares_owned.toFixed(4)}% simulated position</Text>
                {holding.current_price > 0 && (
                  <Text style={styles.holdingPrice}>
                    @ ${holding.current_price.toLocaleString()} / 1%
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.holdingRight}>
              <Text style={styles.holdingValue}>
                ${(holding.shares_owned * holding.current_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
              <View style={styles.holdingChange}>
                <ArrowUpRight size={14} color="#1E3A8A" />
                <Text style={styles.holdingChangeText}>+0%</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
        {(!holdings || holdings.length === 0) && (
          <Text style={styles.emptyText}>No simulated positions yet. Place a mock order to begin.</Text>
        )}
      </View>

      {/* Insights */}
      <View style={[styles.section, { marginBottom: 100 }]}>
        <View style={styles.insightCard}>
          <Text style={styles.insightTitle}>Simulation Notes</Text>
          <Text style={styles.insightText}>
            Charts reflect mock fills and simulated market prices. They are not evidence of property ownership or actual investment performance.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  noticeWrap: { paddingHorizontal: 24, paddingTop: 24 },
  userHeader: {
    paddingHorizontal: 24, paddingTop: 64,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  userAvatar: { backgroundColor: '#f3f4f6', padding: 8, borderRadius: 999 },
  userLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  userEmail: { color: '#0F172A', fontWeight: '700', fontSize: 13, marginTop: 2 },
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#f9fafb', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 12, borderWidth: 1, borderColor: '#f3f4f6',
  },
  signOutText: { color: '#ef4444', fontWeight: '700', fontSize: 12 },
  section: { paddingHorizontal: 24, paddingTop: 32 },
  sectionLabel: { color: '#9ca3af', fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5 },
  portfolioValue: { fontSize: 48, fontWeight: '700', letterSpacing: -1, marginTop: 8, color: '#0F172A' },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  changePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  changeText: { fontWeight: '700', fontSize: 14 },
  changeSubtext: { color: '#9ca3af', fontWeight: '500', fontSize: 14 },
  balanceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 32, paddingTop: 24, borderTopWidth: 1, borderTopColor: '#f3f4f6',
  },
  balanceValue: { fontSize: 24, fontWeight: '700', color: '#0F172A', marginTop: 4 },
  noDepositsBadge: { backgroundColor: '#f3f4f6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16 },
  noDepositsText: { color: '#6b7280', fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  chartContainer: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  timeframes: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 16, paddingHorizontal: 4,
  },
  timeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  timeBtnActive: { backgroundColor: 'rgba(30,58,138,0.08)' },
  timeBtnText: { fontSize: 12, fontWeight: '700', color: '#9ca3af' },
  noDataLabel: { fontSize: 12, color: '#d1d5db', textAlign: 'center', marginTop: 12, fontStyle: 'italic' },
  holdingsTitle: { fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 20 },
  holdingCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(249,250,251,0.8)', padding: 16, borderRadius: 24,
    borderWidth: 1, borderColor: '#f3f4f6', marginBottom: 12,
  },
  holdingLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  holdingIcon: {
    backgroundColor: '#fff', padding: 12, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  holdingAddress: { fontWeight: '700', fontSize: 16, color: '#0F172A' },
  holdingShares: { color: '#9ca3af', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
  holdingPrice: { color: '#1E3A8A', fontSize: 11, fontWeight: '600', marginTop: 2 },
  holdingRight: { alignItems: 'flex-end' },
  holdingValue: { fontWeight: '700', fontSize: 20, color: '#0F172A' },
  holdingChange: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  holdingChangeText: { color: '#1E3A8A', fontWeight: '700', fontSize: 13 },
  emptyText: { color: '#9ca3af', textAlign: 'center', paddingVertical: 40, fontSize: 15 },
  insightCard: {
    backgroundColor: 'rgba(30,58,138,0.04)', borderRadius: 24, padding: 24,
    borderWidth: 1, borderColor: 'rgba(30,58,138,0.12)',
  },
  insightTitle: { fontWeight: '700', color: '#1E3A8A', fontSize: 17, marginBottom: 8 },
  insightText: { fontSize: 14, color: '#4b5563', lineHeight: 24 },
});
