import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { BRAND, GRAY, GRAY_BORDER } from '../utils/constants';

// Auth screens
import SplashScreen from '../screens/auth/SplashScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import BiometricScreen from '../screens/auth/BiometricScreen';
import BiometricSetupScreen from '../screens/auth/BiometricSetupScreen';

// Main screens
import HomeScreen from '../screens/home/HomeScreen';
import CollectionsNavigator from './CollectionsNavigator';
import CustomersNavigator from './CustomersNavigator';
import ProfileScreen from '../screens/profile/ProfileScreen';

import {
  RootStackParamList,
  AuthStackParamList,
  MainTabParamList,
} from '../types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const color = focused ? BRAND : GRAY;
  const icons: Record<string, string> = {
    Home: '⊞',
    Collections: '📋',
    Customers: '👥',
    Profile: '👤',
  };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 18, color }}>{icons[name]}</Text>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor: BRAND,
        tabBarInactiveTintColor: GRAY,
        tabBarStyle: {
          borderTopColor: GRAY_BORDER,
          backgroundColor: '#fff',
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="Collections" component={CollectionsNavigator} options={{ title: 'Collect' }} />
      <Tab.Screen name="Customers" component={CustomersNavigator} options={{ title: 'Customers' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Biometric" component={BiometricScreen} />
      <AuthStack.Screen name="BiometricSetup" component={BiometricSetupScreen} />
    </AuthStack.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, isBiometricUnlocked, biometricEnabled, appInitState } =
    useAuthStore();

  // Determine which root screen to show
  const showMain =
    isAuthenticated &&
    (!biometricEnabled || isBiometricUnlocked) &&
    appInitState === 'ready';

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {appInitState === 'initializing' ? (
          // Always start at Splash; it handles all routing once bootstrap completes
          <RootStack.Screen name="Splash" component={SplashScreen} />
        ) : showMain ? (
          <RootStack.Screen name="Main" component={MainTabs} />
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
