import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CollectionsStackParamList } from '../types';
import { BRAND } from '../utils/constants';

import CollectionsListScreen from '../screens/collections/CollectionsListScreen';
import CollectionDetailScreen from '../screens/collections/CollectionDetailScreen';
import RouteMapScreen from '../screens/collections/RouteMapScreen';
import PaymentCaptureScreen from '../screens/payments/PaymentCaptureScreen';
import ReceiptCameraScreen from '../screens/payments/ReceiptCameraScreen';
import PaymentHistoryScreen from '../screens/reports/PaymentHistoryScreen';

const Stack = createNativeStackNavigator<CollectionsStackParamList>();

export default function CollectionsNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: BRAND },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700', fontSize: 16 },
        headerBackTitle: '',
      }}
    >
      <Stack.Screen
        name="CollectionsList"
        component={CollectionsListScreen}
        options={{ title: 'Collection Dashboard' }}
      />
      <Stack.Screen
        name="CollectionDetail"
        component={CollectionDetailScreen}
        options={{ title: 'Collection Detail' }}
      />
      <Stack.Screen
        name="RouteMap"
        component={RouteMapScreen}
        options={{ title: 'Today\'s Route' }}
      />
      <Stack.Screen
        name="PaymentCapture"
        component={PaymentCaptureScreen}
        options={{ title: 'Record Payment', presentation: 'modal' }}
      />
      <Stack.Screen
        name="ReceiptCamera"
        component={ReceiptCameraScreen}
        options={{ title: 'Capture Receipt', headerShown: false }}
      />
      <Stack.Screen
        name="PaymentHistory"
        component={PaymentHistoryScreen}
        options={{ title: 'Payment History' }}
      />
    </Stack.Navigator>
  );
}
