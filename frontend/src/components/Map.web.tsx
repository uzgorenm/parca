import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Property = {
    id: string;
    address: string;
    price: number;
    lat: number;
    lng: number;
};

type MapProps = {
    properties: Property[];
    onRegionChange?: (bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => void;
};

export const Map = ({ properties }: MapProps) => {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Map View</Text>
            <Text style={styles.subtitle}>Maps are not available on web. Switch to list view.</Text>
            <View style={styles.propertyList}>
                {properties.map((prop) => (
                    <View key={prop.id} style={styles.item}>
                        <Text style={styles.address}>{prop.address}</Text>
                        <Text style={styles.price}>${prop.price.toLocaleString()}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 20, fontWeight: '700', color: '#1E3A8A', marginBottom: 8 },
    subtitle: { color: '#9ca3af', fontSize: 14, marginBottom: 24 },
    propertyList: { width: '100%', maxWidth: 400 },
    item: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
    address: { fontWeight: '600', color: '#0F172A' },
    price: { fontWeight: '700', color: '#1E3A8A' },
});
