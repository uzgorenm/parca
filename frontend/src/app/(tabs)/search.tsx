import React from 'react';
import { Map } from '../../components/Map';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet } from 'react-native';
import { List, Map as MapIcon, Search as SearchIcon } from 'lucide-react-native';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { useEffect, useState } from 'react';
import { SimulationNotice } from '../../components/SimulationNotice';

export default function SearchScreen() {
    const router = useRouter();
    const { user } = useUser();
    const syncUser = useMutation(api.users.syncUser);
    const [view, setView] = useState<'map' | 'list'>('list');
    const [bounds, setBounds] = useState<any>({});
    const properties = useQuery(api.properties.searchProperties, bounds);

    useEffect(() => {
        if (user) {
            syncUser({
                clerkId: user.id,
                email: user.primaryEmailAddress?.emailAddress || '',
                name: user.fullName || undefined,
            }).catch(console.error);
        }
    }, [user]);

    if (!properties) return null;

    const mapProperties = properties
        .filter(p => p.lat !== undefined && p.lng !== undefined)
        .map(p => ({
            id: p._id,
            address: p.address,
            price: (p.pricePerShare || 0) * 100,
            lat: p.lat!,
            lng: p.lng!,
        }));

    return (
        <View style={styles.root}>
            {/* Search Header */}
            <View style={styles.header}>
                <View style={styles.searchBar}>
                    <SearchIcon size={20} color="#9ca3af" />
                    <Text style={styles.searchPlaceholder}>Search properties, cities...</Text>
                </View>
            </View>

            <View style={styles.noticeWrap}>
                <SimulationNotice compact />
            </View>

            <View style={styles.flex}>
                {view === 'map' ? (
                    <Map
                        properties={mapProperties}
                        onRegionChange={(newBounds) => setBounds(newBounds)}
                    />
                ) : (
                    <ScrollView style={styles.flex} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                        <View style={styles.listHeader}>
                            <View>
                                <Text style={styles.listTitle}>Explore</Text>
                                <Text style={styles.listSubtitle}>Found {properties.length} simulated property markets</Text>
                            </View>
                            <TouchableOpacity onPress={() => setView('map')} style={styles.mapToggleBtn}>
                                <MapIcon size={24} color="#1E3A8A" />
                            </TouchableOpacity>
                        </View>

                        {properties.map((prop) => (
                            <TouchableOpacity
                                key={prop._id}
                                onPress={() => router.push(`/property/${prop._id}`)}
                                activeOpacity={0.9}
                                style={styles.propertyCard}
                            >
                                <Image
                                    source={{ uri: prop.media[0]?.url || '' }}
                                    style={styles.propertyImage}
                                    resizeMode="cover"
                                />
                                <View style={styles.propertyInfo}>
                                    <Text style={styles.propertyAddress}>{prop.address}</Text>
                                    <View style={styles.propertyStats}>
                                        <View>
                                            <Text style={styles.projectedReturn}>4.2% Projected Net Return</Text>
                                            <Text style={styles.propertyAvailable}>
                                                {(prop as any).availableShares?.toFixed(2) || '0.00'}% Simulated Supply
                                            </Text>
                                        </View>
                                        <View style={styles.propertyPriceBlock}>
                                            <Text style={styles.propertyPrice}>
                                                ${(prop.pricePerShare || 0).toLocaleString()}
                                            </Text>
                                            <Text style={styles.propertyPriceLabel}>MOCK PRICE / 1%</Text>
                                        </View>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        ))}
                        <View style={{ height: 120 }} />
                    </ScrollView>
                )}
            </View>

            {view === 'map' && (
                <TouchableOpacity onPress={() => setView('list')} style={styles.listViewBtn}>
                    <List size={20} color="#1E3A8A" />
                    <Text style={styles.listViewBtnText}>List View</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#fff' },
    flex: { flex: 1 },
    noticeWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    header: {
        paddingTop: 64,
        paddingHorizontal: 24,
        paddingBottom: 24,
        backgroundColor: '#fff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 2,
        zIndex: 10,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderWidth: 1,
        borderColor: '#f3f4f6',
        gap: 12,
    },
    searchPlaceholder: { color: '#9ca3af', fontWeight: '500', fontSize: 15 },
    list: { paddingHorizontal: 16, paddingTop: 16 },
    listHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 24,
        paddingHorizontal: 8,
    },
    listTitle: { fontSize: 30, fontWeight: '700', color: '#0F172A' },
    listSubtitle: { color: '#9ca3af', fontWeight: '500', marginTop: 4 },
    mapToggleBtn: {
        backgroundColor: '#f9fafb',
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    propertyCard: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#f3f4f6',
        borderRadius: 32,
        overflow: 'hidden',
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
        elevation: 2,
    },
    propertyImage: { width: '100%', height: 200 },
    propertyInfo: { padding: 24 },
    propertyAddress: { fontWeight: '700', fontSize: 22, color: '#0F172A' },
    propertyStats: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16 },
    projectedReturn: { color: '#1E3A8A', fontWeight: '700', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
    propertyAvailable: { color: '#9ca3af', fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
    propertyPriceBlock: { alignItems: 'flex-end' },
    propertyPrice: { color: '#1E3A8A', fontWeight: '700', fontSize: 28 },
    propertyPriceLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
    listViewBtn: {
        position: 'absolute',
        bottom: 40,
        alignSelf: 'center',
        backgroundColor: '#fff',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 999,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 8,
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    listViewBtnText: { fontWeight: '700', color: '#0F172A' },
});
