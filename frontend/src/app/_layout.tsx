import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, FadeIn, FadeOut } from 'react-native-reanimated';
import '../global.css';

export {
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth, SignedIn, SignedOut } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  console.error("Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env file");
}

const tokenCache = {
  async getToken(key: string) {
    try {
      return SecureStore.getItemAsync(key);
    } catch (err) {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      return SecureStore.setItemAsync(key, value);
    } catch (err) {
      return;
    }
  },
};

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!);

WebBrowser.maybeCompleteAuthSession();

function useWarmUpBrowser() {
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

import { LoginOptions } from '../components/LoginOptions';
import { SimulationNotice } from '../components/SimulationNotice';

function InitialLayout() {
  const [showAuth, setShowAuth] = useState(false);
  const colorScheme = useColorScheme();
  const slideAnim = useSharedValue(1000); // Start off-screen (bottom)

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: slideAnim.value }],
    };
  });

  const onGetStarted = () => {
    setShowAuth(true);
    slideAnim.value = withTiming(0, { duration: 400 });
  };

  const onHideAuth = () => {
    slideAnim.value = withTiming(1000, { duration: 300 });
    setTimeout(() => setShowAuth(false), 300);
  };

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SignedIn>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="property/[id]" options={{ presentation: 'card', headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
      </SignedIn>
      <SignedOut>
        <View className="flex-1 bg-white">
          {/* Welcome Screen */}
          <View className="flex-1 justify-center px-8">
            <View className="items-center mb-12">
              <Text className="text-5xl font-bold text-primary mb-2">Parça</Text>
              <Text className="text-gray-400 font-medium">Property Market Simulator</Text>
            </View>

            <View className="bg-gray-50 p-8 rounded-[40px] border border-gray-100 mb-12">
              <Text className="text-3xl font-bold text-foreground text-center mb-4">Welcome</Text>
              <Text className="text-gray-400 text-center leading-6 mb-8">
                Explore properties and practice continuous order-book trading with simulated cash.
              </Text>

              <SimulationNotice compact style={{ marginBottom: 24 }} />

              <TouchableOpacity
                className="bg-primary py-5 rounded-3xl shadow-xl shadow-primary/20"
                onPress={onGetStarted}
              >
                <Text className="text-white font-bold text-center text-lg">Get Started</Text>
              </TouchableOpacity>
            </View>

            <Text className="text-gray-400 text-center text-xs">
              By continuing, you agree to our Terms and Privacy Policy
            </Text>
          </View>

          {/* Auth Sheet (Slides up) */}
          {showAuth && (
            <Animated.View
              entering={FadeIn}
              exiting={FadeOut}
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10 }
              ]}
              className="justify-end"
            >
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={onHideAuth}
              />
              <Animated.View
                style={[animatedStyle]}
                className="bg-white rounded-t-[40px] p-8 pb-12 shadow-2xl"
              >
                <View className="w-12 h-1 bg-gray-200 rounded-full self-center mb-6" />
                <Text className="text-3xl font-bold text-foreground mb-2">Welcome Back</Text>
                <Text className="text-gray-400 mb-8">Choose your preferred login method to enter the simulation.</Text>

                <LoginOptions onSuccess={() => {
                  // Don't manually hide, let SignedIn handle the unmount
                  console.log('Login success in layout');
                }} />
              </Animated.View>
            </Animated.View>
          )}
        </View>
      </SignedOut>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  useWarmUpBrowser();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={{ textAlign: 'center', color: 'red', fontWeight: 'bold' }}>
          Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY.
        </Text>
        <Text style={{ textAlign: 'center', marginTop: 10 }}>
          Please ensure it is set in your .env file and restart your Expo server with 'npx expo start -c'.
        </Text>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <InitialLayout />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
