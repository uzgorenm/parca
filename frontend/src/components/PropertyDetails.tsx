import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    Image,
    StyleSheet,
} from 'react-native';
import { ChevronLeft, TrendingUp, BarChart3 } from 'lucide-react-native';

type PropertyDetailsProps = {
    property: {
        id: string;
        address: string;
        description: string;
        image: string;
        yield: string;
        appreciation: string;
        available: string;
        pricePerShare: number;
        bestBid?: number;
    };
    userHolding?: {
        sharesOwned: number;
        averagePrice: number;
    };
    onBack: () => void;
    onBuyPress: () => void;
    onSellPress: () => void;
};

export const PropertyDetails = ({
    property,
    userHolding,
    onBack,
    onBuyPress,
    onSellPress,
}: PropertyDetailsProps) => {
    return (
        <View style={styles.root}>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                <View>
                    <Image
                        source={{ uri: property.image }}
                        style={styles.hero}
                        resizeMode="cover"
                    />
                    <TouchableOpacity onPress={onBack} style={styles.backBtn}>
                        <ChevronLeft size={24} color="#000" />
                    </TouchableOpacity>
                </View>

                <View style={styles.card}>
                    <View style={styles.handle} />

                    <Text style={styles.address}>{property.address}</Text>

                    <View style={styles.badgeRow}>
                        <View style={styles.badgePrimary}>
                            <Text style={styles.badgePrimaryText}>
                                {parseFloat(property.available).toFixed(2)}% AVAILABLE
                            </Text>
                        </View>
                        {userHolding && (
                            <View style={styles.badgeBlue}>
                                <Text style={styles.badgeBlueText}>
                                    YOU OWN {userHolding.sharesOwned.toFixed(2)}%
                                </Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.statsRow}>
                        <View style={styles.statCard}>
                            <BarChart3 size={20} color="#1E3A8A" />
                            <Text style={styles.statLabel}>Rental Yield</Text>
                            <Text style={styles.statValue}>{property.yield}</Text>
                        </View>
                        <View style={styles.statCard}>
                            <TrendingUp size={20} color="#1E3A8A" />
                            <Text style={styles.statLabel}>Appreciation</Text>
                            <Text style={styles.statValue}>{property.appreciation}</Text>
                        </View>
                    </View>

                    <View style={styles.descSection}>
                        <Text style={styles.descLabel}>About This Property</Text>
                        <Text style={styles.descText}>{property.description}</Text>
                    </View>

                    {property.bestBid !== undefined && (
                        <View style={styles.priceRow}>
                            <View style={styles.priceItem}>
                                <Text style={styles.priceLabel}>Best Ask (1%)</Text>
                                <Text style={[styles.priceValue, { color: '#1E3A8A' }]}>
                                    ${property.pricePerShare.toLocaleString()}
                                </Text>
                            </View>
                            <View style={[styles.priceItem, { alignItems: 'flex-end' }]}>
                                <Text style={styles.priceLabel}>Best Bid (1%)</Text>
                                <Text style={[styles.priceValue, { color: '#16a34a' }]}>
                                    ${property.bestBid.toLocaleString()}
                                </Text>
                            </View>
                        </View>
                    )}

                    <View style={{ height: 160 }} />
                </View>
            </ScrollView>

            <View style={styles.actionBar}>
                <View style={styles.actionLeft}>
                    <Text style={styles.actionLabel}>Entry Price (1%)</Text>
                    <Text style={styles.actionPrice}>${property.pricePerShare.toLocaleString()}</Text>
                </View>
                <View style={styles.actionButtons}>
                    <TouchableOpacity onPress={onSellPress} style={styles.sellBtn}>
                        <Text style={styles.sellBtnText}>Sell</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={onBuyPress} style={styles.buyBtn}>
                        <Text style={styles.buyBtnText}>Buy</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff' },
    scroll: { flex: 1 },
    hero: { width: '100%', height: 400 },
    backBtn: {
        position: 'absolute', top: 52, left: 20,
        padding: 14, backgroundColor: 'rgba(255,255,255,0.92)',
        borderRadius: 999,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4,
    },
    card: {
        marginTop: -40, backgroundColor: '#fff',
        borderTopLeftRadius: 40, borderTopRightRadius: 40,
        padding: 32,
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 8,
    },
    handle: { width: 44, height: 5, backgroundColor: '#f3f4f6', borderRadius: 99, alignSelf: 'center', marginBottom: 28 },
    address: { fontSize: 26, fontWeight: '700', color: '#0F172A', letterSpacing: -0.5 },
    badgeRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
    badgePrimary: { backgroundColor: 'rgba(30,58,138,0.08)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
    badgePrimaryText: { color: '#1E3A8A', fontWeight: '700', fontSize: 11 },
    badgeBlue: { backgroundColor: '#eff6ff', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
    badgeBlueText: { color: '#2563eb', fontWeight: '700', fontSize: 11 },
    statsRow: { flexDirection: 'row', gap: 16, marginTop: 32 },
    statCard: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#f3f4f6' },
    statLabel: { fontSize: 10, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 12, marginBottom: 4 },
    statValue: { fontSize: 22, fontWeight: '700', color: '#0F172A' },
    descSection: { marginTop: 32 },
    descLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
    descText: { fontSize: 16, color: '#6b7280', lineHeight: 28 },
    priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, backgroundColor: '#f9fafb', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#f3f4f6' },
    priceItem: {},
    priceLabel: { fontSize: 10, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
    priceValue: { fontSize: 22, fontWeight: '700' },
    actionBar: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 28, paddingTop: 16, paddingBottom: 44,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderTopWidth: 1, borderTopColor: '#f3f4f6', gap: 14,
    },
    actionLeft: { flex: 1 },
    actionLabel: { fontSize: 10, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
    actionPrice: { fontSize: 28, fontWeight: '700', color: '#1E3A8A' },
    actionButtons: { flexDirection: 'row', gap: 10 },
    sellBtn: { backgroundColor: '#f3f4f6', paddingHorizontal: 22, paddingVertical: 17, borderRadius: 22 },
    sellBtnText: { color: '#374151', fontWeight: '700', fontSize: 15, textTransform: 'uppercase', letterSpacing: 2 },
    buyBtn: { backgroundColor: '#1E3A8A', paddingHorizontal: 26, paddingVertical: 17, borderRadius: 22 },
    buyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15, textTransform: 'uppercase', letterSpacing: 2 },
});
