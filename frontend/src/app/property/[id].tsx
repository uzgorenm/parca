import React, { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { PropertyDetails } from '@/components/PropertyDetails';
import { TradeSheet, TradeSide, OrderType } from '@/components/TradeSheet';
import { Alert, View, ActivityIndicator, Text, StyleSheet } from 'react-native';

export default function PropertyScreen() {
    const router = useRouter();
    const { id } = useLocalSearchParams();

    const property = useQuery(api.properties.getProperty, { id: id as any });
    const holdings = useQuery(api.trading.getHoldings, {});
    const availability = useQuery(api.trading.getAvailability, { propertyId: id as any });
    const executeTrade = useMutation(api.trading.executeTrade);

    const [sheetVisible, setSheetVisible] = useState(false);
    const [tradeSide, setTradeSide] = useState<TradeSide>('buy');

    if (property === undefined) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#1E3A8A" />
            </View>
        );
    }

    if (property === null) {
        return (
            <View style={styles.center}>
                <Text style={styles.errorText}>Property not found.</Text>
            </View>
        );
    }

    const userHolding = holdings?.find(h => h.property_id === property._id);

    const openSheet = (side: TradeSide) => {
        setTradeSide(side);
        setSheetVisible(true);
    };

    const handleConfirm = async (qty: number, type: OrderType, price?: number) => {
        try {
            await executeTrade({
                propertyId: property._id,
                side: tradeSide,
                type,
                quantity: qty,
                price,
            });
            Alert.alert('Simulated Order Placed', `${type === 'limit' ? 'Limit order' : 'Market order'} added to the development simulation.`);
        } catch (error: any) {
            Alert.alert('Order Failed', error.message ?? 'Something went wrong.');
            throw error;
        }
    };

    return (
        <>
            <PropertyDetails
                property={{
                    id: property._id,
                    address: property.address,
                    description: property.specs
                        ? `${property.specs.bedrooms}BR, ${property.specs.bathrooms}BA • ${property.specs.sqft} sqft`
                        : 'No description available',
                    image: property.media[0]?.url ?? '',
                    projectedNetReturn: '4.2%',
                    yearOverYearValueChange: '+12%',
                    available: availability !== undefined ? `${availability.toFixed(2)}` : '...',
                    pricePerShare: property.pricePerShare ?? 0,
                    bestBid: (property as any).bestBid,
                }}
                userHolding={userHolding ? {
                    positionPercent: userHolding.shares_owned,
                    averageMockPrice: (userHolding as any).averagePrice ?? 0,
                } : undefined}
                onBack={() => router.back()}
                onBuyPress={() => openSheet('buy')}
                onSellPress={() => openSheet('sell')}
            />

            <TradeSheet
                visible={sheetVisible}
                side={tradeSide}
                pricePerShare={property.pricePerShare ?? 0}
                bestBid={(property as any).bestBid}
                sharesOwned={userHolding?.shares_owned ?? 0}
                onClose={() => setSheetVisible(false)}
                onConfirm={handleConfirm}
            />
        </>
    );
}

const styles = StyleSheet.create({
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
    errorText: { fontSize: 16, color: '#6b7280', fontWeight: '500' },
});
