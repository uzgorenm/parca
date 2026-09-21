import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useOAuth, useSignIn, useSignUp } from '@clerk/clerk-expo';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons, FontAwesome } from '@expo/vector-icons';
import Animated, { FadeInUp } from 'react-native-reanimated';

WebBrowser.maybeCompleteAuthSession();

interface LoginOptionsProps {
    onSuccess?: () => void;
}

type AuthStage = 'initial' | 'email' | 'names' | 'code';

export const LoginOptions: React.FC<LoginOptionsProps> = ({ onSuccess }) => {
    const { startOAuthFlow: startGoogleFlow } = useOAuth({ strategy: 'oauth_google' });
    const { startOAuthFlow: startAppleFlow } = useOAuth({ strategy: 'oauth_apple' });
    const { signIn, setActive, isLoaded: signInLoaded } = useSignIn();
    const { signUp, isLoaded: signUpLoaded } = useSignUp();

    const [stage, setStage] = useState<AuthStage>('initial');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const onSelectAuth = useCallback(async (strategy: 'google' | 'apple') => {
        if (loading) return;
        try {
            setLoading(true);
            console.log(`[Auth] Starting ${strategy} OAuth flow...`);
            const { createdSessionId, setActive: setSessionActive } =
                strategy === 'google' ? await startGoogleFlow() : await startAppleFlow();

            if (createdSessionId && setSessionActive) {
                console.log(`[Auth] ${strategy} login successful, setting session...`);
                await setSessionActive({ session: createdSessionId });
                onSuccess?.();
            }
        } catch (err: any) {
            console.error(`[Auth] ${strategy} error:`, err);
            if (!err.message?.includes('Another web browser is already open')) {
                alert(`${strategy} login failed. ${err.message || 'Please try again.'}`);
            }
        } finally {
            setLoading(false);
        }
    }, [startGoogleFlow, startAppleFlow, onSuccess, loading]);

    const onContinueEmail = async () => {
        if (!signInLoaded || !email || loading) return;

        try {
            setLoading(true);
            console.log(`[Auth] Checking if user exists: ${email}`);

            try {
                const signinRecord = await signIn.create({ identifier: email });
                console.log('[Auth] User exists. Status:', signinRecord.status);

                const emailCodeFactor = signinRecord.supportedFirstFactors?.find(
                    (f: any) => f.strategy === 'email_code'
                );

                if (emailCodeFactor) {
                    await signinRecord.prepareFirstFactor({ strategy: 'email_code', emailAddressId: (emailCodeFactor as any).emailAddressId });
                    console.log('[Auth] Sign-in code sent');
                    setStage('code');
                } else {
                    throw new Error('Code login not available for this account.');
                }
            } catch (err: any) {
                if (err.errors?.[0]?.code === 'form_identifier_not_found' || err.message?.includes('identifier_not_found')) {
                    console.log('[Auth] User not found. Moving to Names stage.');
                    setStage('names');
                } else {
                    throw err;
                }
            }
        } catch (err: any) {
            console.error('[Auth] Email login error:', err);
            alert(err.message || 'Something went wrong.');
        } finally {
            setLoading(false);
        }
    };

    const onSignUpWithNames = async () => {
        if (!signUpLoaded || !firstName || !lastName || !password || loading) return;

        try {
            setLoading(true);
            console.log(`[Auth] Creating account for ${email} with password...`);

            await signUp.create({
                emailAddress: email,
                firstName,
                lastName,
                password,
            });

            console.log('[Auth] Record created, preparing verification...');
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            console.log('[Auth] Sign-up code sent');
            setStage('code');
        } catch (err: any) {
            console.error('[Auth] Sign-up error:', err);
            alert(err.message || 'Could not start sign-up.');
        } finally {
            setLoading(false);
        }
    };

    const onVerifyCode = async () => {
        if (!signInLoaded || !signUpLoaded || !code || loading) return;

        try {
            setLoading(true);
            console.log(`[Auth] Attempting verification for status: ${signIn.status || signUp.status}`);

            let result;
            if (signIn.status === 'needs_first_factor') {
                result = await signIn.attemptFirstFactor({
                    strategy: 'email_code',
                    code,
                });
            } else {
                result = await signUp.attemptEmailAddressVerification({
                    code,
                });
            }

            console.log('[Auth] Verification status:', result.status);

            if (result.status === 'complete') {
                console.log('[Auth] Success! Setting session...');
                await setActive({ session: result.createdSessionId });
                onSuccess?.();
            } else {
                console.warn('[Auth] Incomplete status after verification:', result.status);
                alert(`Status: ${result.status}. Please check for missing info.`);
            }
        } catch (err: any) {
            console.error('[Auth] Verification error:', err);
            alert(err.message || 'Verification failed.');
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setStage('initial');
        setEmail('');
        setCode('');
        setFirstName('');
        setLastName('');
        setPassword('');
    };

    return (
        <View className="w-full space-y-4">
            {stage === 'initial' ? (
                <Animated.View entering={FadeInUp} className="space-y-4">
                    <TouchableOpacity
                        className="flex-row items-center justify-center bg-white border border-gray-200 py-4 rounded-2xl shadow-sm"
                        onPress={() => onSelectAuth('google')}
                        disabled={loading}
                    >
                        <FontAwesome name="google" size={20} color="#DB4437" />
                        <Text className="ml-3 font-semibold text-gray-800 text-lg">Continue with Google</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        className="flex-row items-center justify-center bg-black py-4 rounded-2xl shadow-sm"
                        onPress={() => onSelectAuth('apple')}
                        disabled={loading}
                    >
                        <FontAwesome name="apple" size={20} color="white" />
                        <Text className="ml-3 font-semibold text-white text-lg">Continue with Apple</Text>
                    </TouchableOpacity>

                    <View className="flex-row items-center py-4">
                        <View className="flex-1 h-[1px] bg-gray-200" />
                        <Text className="mx-4 text-gray-400 font-medium">or</Text>
                        <View className="flex-1 h-[1px] bg-gray-200" />
                    </View>

                    <TouchableOpacity
                        className="flex-row items-center justify-center bg-gray-50 border border-gray-200 py-4 rounded-2xl"
                        onPress={() => setStage('email')}
                        disabled={loading}
                    >
                        <Ionicons name="mail-outline" size={20} color="#666" />
                        <Text className="ml-3 font-semibold text-gray-600 text-lg">Continue with Email</Text>
                    </TouchableOpacity>
                </Animated.View>
            ) : (
                <Animated.View entering={FadeInUp.duration(400)} className="space-y-4">
                    {stage === 'email' && (
                        <>
                            <TextInput
                                className="bg-white border border-gray-200 p-4 rounded-2xl text-lg text-foreground"
                                placeholder="Enter your email"
                                placeholderTextColor="#94A3B8"
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                            />
                            <TouchableOpacity
                                className="bg-primary py-4 rounded-2xl shadow-lg shadow-primary/20"
                                onPress={onContinueEmail}
                                disabled={loading || !email}
                            >
                                {loading ? <ActivityIndicator color="white" /> : <Text className="text-white font-bold text-center text-lg">Continue</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={reset}>
                                <Text className="text-center text-gray-400 mt-2">Go back</Text>
                            </TouchableOpacity>
                        </>
                    )}

                    {stage === 'names' && (
                        <>
                            <Text className="text-xl font-bold text-foreground mb-1">Create Account</Text>
                            <Text className="text-gray-500 mb-4">Please enter your details to continue.</Text>
                            <View className="flex-row space-x-2 mb-2">
                                <TextInput
                                    className="flex-1 bg-white border border-gray-200 p-4 rounded-2xl text-lg text-foreground"
                                    placeholder="First Name"
                                    placeholderTextColor="#94A3B8"
                                    value={firstName}
                                    onChangeText={setFirstName}
                                />
                                <TextInput
                                    className="flex-1 bg-white border border-gray-200 p-4 rounded-2xl text-lg text-foreground"
                                    placeholder="Last Name"
                                    placeholderTextColor="#94A3B8"
                                    value={lastName}
                                    onChangeText={setLastName}
                                />
                            </View>
                            <View className="relative">
                                <TextInput
                                    className="bg-white border border-gray-200 p-4 rounded-2xl text-lg text-foreground"
                                    placeholder="Create Password"
                                    placeholderTextColor="#94A3B8"
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry={!showPassword}
                                />
                                <TouchableOpacity
                                    className="absolute right-4 top-4"
                                    onPress={() => setShowPassword(!showPassword)}
                                >
                                    <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={24} color="#94A3B8" />
                                </TouchableOpacity>
                            </View>
                            <TouchableOpacity
                                className="bg-primary py-4 rounded-2xl shadow-lg shadow-primary/20 mt-4"
                                onPress={onSignUpWithNames}
                                disabled={loading || !firstName || !lastName || !password}
                            >
                                {loading ? <ActivityIndicator color="white" /> : <Text className="text-white font-bold text-center text-lg">Continue</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setStage('email')}>
                                <Text className="text-center text-gray-400 mt-2">Back to email</Text>
                            </TouchableOpacity>
                        </>
                    )}

                    {stage === 'code' && (
                        <>
                            <Text className="text-center text-gray-600 font-medium mb-2">Check your inbox for a code</Text>
                            <TextInput
                                className="bg-white border border-gray-200 p-4 rounded-2xl text-lg text-center tracking-widest text-foreground font-bold"
                                placeholder="000000"
                                placeholderTextColor="#CBD5E1"
                                value={code}
                                onChangeText={setCode}
                                keyboardType="number-pad"
                                maxLength={6}
                            />
                            <TouchableOpacity
                                className="bg-primary py-4 rounded-2xl shadow-lg shadow-primary/20"
                                onPress={onVerifyCode}
                                disabled={loading || code.length < 6}
                            >
                                {loading ? <ActivityIndicator color="white" /> : <Text className="text-white font-bold text-center text-lg">Verify Code</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setStage('email')}>
                                <Text className="text-center text-gray-400 mt-2">Re-enter email</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </Animated.View>
            )}
        </View>
    );
};
