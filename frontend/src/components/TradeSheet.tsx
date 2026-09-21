import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TextInput,
    Modal,
    Alert,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    TouchableWithoutFeedback,
    Keyboard,
    ActivityIndicator,
} from 'react-native';
import { X, DollarSign } from 'lucide-react-native';
import { SimulationNotice } from './SimulationNotice';

export type TradeSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';

type TradeSheetProps = {
    visible: boolean;
    side: TradeSide;
    pricePerShare: number;
    bestBid?: number;
    sharesOwned?: number;
    onClose: () => void;
    onConfirm: (qty: number, type: OrderType, price?: number) => Promise<void>;
};

export const TradeSheet = ({
    visible,
    side,
    pricePerShare,
    bestBid,
    sharesOwned = 0,
    onClose,
    onConfirm,
}: TradeSheetProps) => {
    const [orderType, setOrderType] = useState<OrderType>('market');
    const [quantity, setQuantity] = useState('');
    const [limitPrice, setLimitPrice] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (visible) {
            setOrderType('market');
            setQuantity(side === 'sell' ? sharesOwned.toFixed(2) : '');
            const defaultPrice = side === 'sell' && bestBid ? bestBid : pricePerShare;
            setLimitPrice(defaultPrice > 0 ? defaultPrice.toFixed(2) : '');
            setIsSubmitting(false);
        }
    }, [visible, side, pricePerShare, bestBid, sharesOwned]);

    const isBuy = side === 'buy';
    const accent = isBuy ? '#1E3A8A' : '#ef4444';

    const getUnitPrice = () => {
        if (orderType === 'limit') return parseFloat(limitPrice) || 0;
        return isBuy ? pricePerShare : (bestBid || pricePerShare);
    };

    const estimatedTotal = (() => {
        const qty = parseFloat(quantity);
        if (!qty || qty <= 0) return null;
        const unit = getUnitPrice();
        if (unit <= 0) return null;
        return (qty * unit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    })();

    const handleConfirm = async () => {
        const qty = parseFloat(quantity);
        const price = orderType === 'limit' ? parseFloat(limitPrice) : undefined;

        if (!qty || qty <= 0 || isNaN(qty)) {
            Alert.alert('Invalid Quantity', 'Please enter a valid quantity greater than 0.');
            return;
        }
        if (orderType === 'limit' && (!price || price <= 0 || isNaN(price))) {
            Alert.alert('Invalid Limit Price', 'Please enter a valid limit price greater than 0.');
            return;
        }
        if (side === 'sell') {
            const qtyR = Math.round(qty * 100) / 100;
            const ownedR = Math.round(sharesOwned * 100) / 100;
            if (qtyR > ownedR) {
                Alert.alert('Insufficient Position', `Your simulated position is ${sharesOwned.toFixed(2)}%. You cannot place a mock sell for ${qty.toFixed(2)}%.`);
                return;
            }
        }
        if (qty * getUnitPrice() < 10) {
            Alert.alert('Minimum Mock Order', 'The minimum simulated order value is $10.');
            return;
        }

        setIsSubmitting(true);
        try {
            await onConfirm(qty, orderType, price);
            onClose();
        } catch (_e) {
            // parent shows the alert
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback onPress={onClose}>
                        <View style={styles.backdrop} />
                    </TouchableWithoutFeedback>

                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.kav}>
                        <View style={styles.sheet}>
                            <View style={styles.handle} />

                            {/* Header */}
                            <View style={styles.header}>
                                <Text style={styles.title}>{isBuy ? 'Simulated Buy' : 'Simulated Sell'}</Text>
                                <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                                    <X size={20} color="#9ca3af" />
                                </TouchableOpacity>
                            </View>

                            {/* Market / Limit Toggle */}
                            <View style={styles.toggle}>
                                {(['market', 'limit'] as OrderType[]).map((t) => (
                                    <TouchableOpacity
                                        key={t}
                                        style={[styles.toggleBtn, orderType === t && styles.toggleBtnActive]}
                                        onPress={() => setOrderType(t)}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={[styles.toggleText, orderType === t && { color: accent }]}>
                                            {t.charAt(0).toUpperCase() + t.slice(1)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Quantity */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Position Size (%)</Text>
                                <View style={styles.inputRow}>
                                    <TextInput
                                        style={styles.inputField}
                                        placeholder="0.00"
                                        placeholderTextColor="#d1d5db"
                                        keyboardType="decimal-pad"
                                        value={quantity}
                                        onChangeText={setQuantity}
                                    />
                                    <Text style={styles.inputSuffix}>%</Text>
                                </View>
                                {estimatedTotal !== null && (
                                    <Text style={styles.estTotal}>Est. Total: ${estimatedTotal}</Text>
                                )}
                            </View>

                            {/* Limit Price */}
                            {orderType === 'limit' && (
                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>Limit Price ($)</Text>
                                    <View style={styles.inputRow}>
                                        <DollarSign size={22} color={accent} style={{ marginRight: 8 }} />
                                        <TextInput
                                            style={[styles.inputField, { flex: 1 }]}
                                            placeholder="0.00"
                                            placeholderTextColor="#d1d5db"
                                            keyboardType="decimal-pad"
                                            value={limitPrice}
                                            onChangeText={setLimitPrice}
                                        />
                                    </View>
                                    <Text style={styles.limitHint}>
                                        {isBuy ? 'Fills if ask drops to or below this price.' : 'Fills if bid rises to or above this price.'}
                                    </Text>
                                </View>
                            )}

                            {/* Market Price Reference */}
                            {orderType === 'market' && (
                                <View style={styles.marketRef}>
                                    <Text style={styles.marketRefLabel}>{isBuy ? 'Mock Best Ask' : 'Mock Best Bid'}</Text>
                                    <Text style={[styles.marketRefValue, { color: accent }]}>
                                        ${(isBuy ? pricePerShare : (bestBid || pricePerShare)).toLocaleString('en-US', { minimumFractionDigits: 2 })} / 1%
                                    </Text>
                                </View>
                            )}

                            <SimulationNotice compact style={styles.simulationNotice} />

                            {/* Confirm */}
                            <TouchableOpacity
                                style={[styles.confirmBtn, { backgroundColor: accent }, isSubmitting && styles.confirmDisabled]}
                                onPress={handleConfirm}
                                disabled={isSubmitting}
                                activeOpacity={0.85}
                            >
                                {isSubmitting
                                    ? <ActivityIndicator color="#fff" />
                                    : <Text style={styles.confirmText}>{isBuy ? 'Place Mock Buy' : 'Place Mock Sell'}</Text>
                                }
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                        </View>
                    </KeyboardAvoidingView>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    kav: { width: '100%' },
    sheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 36, borderTopRightRadius: 36,
        paddingHorizontal: 28, paddingBottom: 48, paddingTop: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 24,
    },
    handle: { width: 44, height: 5, backgroundColor: '#e5e7eb', borderRadius: 99, alignSelf: 'center', marginBottom: 24 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    title: { fontSize: 24, fontWeight: '700', color: '#0F172A' },
    closeBtn: { padding: 8, backgroundColor: '#f9fafb', borderRadius: 999 },
    toggle: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 16, padding: 4, marginBottom: 24 },
    toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
    toggleBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
    toggleText: { fontWeight: '700', fontSize: 15, color: '#9ca3af' },
    inputGroup: { marginBottom: 20 },
    inputLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10 },
    inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 18, borderWidth: 1, borderColor: '#f3f4f6' },
    inputField: { flex: 1, fontSize: 36, fontWeight: '700', color: '#0F172A', padding: 0 },
    inputSuffix: { fontSize: 28, fontWeight: '700', color: '#d1d5db', marginLeft: 8 },
    estTotal: { fontSize: 14, color: '#6b7280', fontWeight: '500', marginTop: 8, marginLeft: 4 },
    limitHint: { fontSize: 12, color: '#9ca3af', marginTop: 8, marginLeft: 4, lineHeight: 18 },
    marketRef: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 4 },
    marketRefLabel: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
    marketRefValue: { fontSize: 16, fontWeight: '700' },
    simulationNotice: { marginTop: 14 },
    confirmBtn: { width: '100%', paddingVertical: 22, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    confirmDisabled: { opacity: 0.6 },
    confirmText: { color: '#fff', fontWeight: '700', fontSize: 17, textTransform: 'uppercase', letterSpacing: 3 },
    cancelBtn: { width: '100%', paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    cancelText: { color: '#9ca3af', fontWeight: '700', fontSize: 13, textTransform: 'uppercase', letterSpacing: 2 },
});
