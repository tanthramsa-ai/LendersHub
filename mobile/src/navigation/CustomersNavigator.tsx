import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { CustomersStackParamList } from '../types';
import { BRAND } from '../utils/constants';

import CustomersListScreen from '../screens/customers/CustomersListScreen';
import CustomerDetailScreen from '../screens/customers/CustomerDetailScreen';

const Stack = createNativeStackNavigator<CustomersStackParamList>();

export default function CustomersNavigator() {
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
        name="CustomersList"
        component={CustomersListScreen}
        options={{ title: 'Customers' }}
      />
      <Stack.Screen
        name="CustomerDetail"
        component={CustomerDetailScreen}
        options={{ title: 'Customer Profile' }}
      />
    </Stack.Navigator>
  );
}
