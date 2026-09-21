import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Dimensions } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import * as Location from 'expo-location';

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

export const Map = ({ properties, onRegionChange }: MapProps) => {
    const [location, setLocation] = useState<any>(null);

    useEffect(() => {
        (async () => {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setLocation({ latitude: 40.7128, longitude: -74.006, latitudeDelta: 0.0922, longitudeDelta: 0.0421 });
                return;
            }
            const userLoc = await Location.getCurrentPositionAsync({});
            setLocation({
                latitude: userLoc.coords.latitude,
                longitude: userLoc.coords.longitude,
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421,
            });
        })();
    }, []);

    if (!location) {
        return (
            <View style={styles.container}>
                <Text style={styles.loadingText}>Finding your location...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <MapView
                style={styles.map}
                initialRegion={location}
                showsUserLocation
                showsMyLocationButton={false}
                onRegionChangeComplete={(region) => {
                    onRegionChange?.({
                        minLat: region.latitude - region.latitudeDelta / 2,
                        maxLat: region.latitude + region.latitudeDelta / 2,
                        minLng: region.longitude - region.longitudeDelta / 2,
                        maxLng: region.longitude + region.longitudeDelta / 2,
                    });
                }}
            >
                {properties.map((prop) => (
                    <Marker key={prop.id} coordinate={{ latitude: prop.lat, longitude: prop.lng }}>
                        <Callout>
                            <View style={styles.callout}>
                                <Text style={styles.calloutAddress}>{prop.address}</Text>
                                <Text style={styles.calloutPrice}>${prop.price.toLocaleString()}</Text>
                            </View>
                        </Callout>
                    </Marker>
                ))}
            </MapView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB', alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: '#1E3A8A', fontWeight: '700', fontSize: 15 },
    map: { width: Dimensions.get('window').width, height: '100%' },
    callout: { padding: 8, minWidth: 120 },
    calloutAddress: { fontWeight: '700', fontSize: 13, color: '#0F172A' },
    calloutPrice: { color: '#1E3A8A', fontWeight: '700', marginTop: 4 },
});
