import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Linking, Alert, ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { useCollectionStore } from '../../store/collectionStore';
import { fmtCurrency } from '../../utils/format';
import { BRAND, BRAND_LIGHT, DANGER, SUCCESS, GRAY, GRAY_BORDER, GRAY_LIGHT } from '../../utils/constants';
import { CollectionItem } from '../../types';

type StopItem = CollectionItem & { distanceKm: number | null };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function RouteMapScreen() {
  const { todayItems, overdueItems } = useCollectionStore();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [stops, setStops] = useState<StopItem[]>([]);

  const allPending = [...todayItems, ...overdueItems].filter((i) => i.status !== 'PAID');

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          buildStops(null);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocation(loc);
        buildStops(loc);
      } catch {
        buildStops(null);
      } finally {
        setGpsLoading(false);
      }
    })();
  }, []);

  function buildStops(loc: { lat: number; lng: number } | null) {
    const withDistance: StopItem[] = allPending.map((item) => ({
      ...item,
      distanceKm:
        loc && item.lat != null && item.lng != null
          ? haversineKm(loc.lat, loc.lng, item.lat, item.lng)
          : null,
    }));

    // Sort: items with distance first (nearest first), then by amount descending
    withDistance.sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      if (a.distanceKm !== null) return -1;
      if (b.distanceKm !== null) return 1;
      return b.amountDue - a.amountDue;
    });

    setStops(withDistance);
  }

  function openRouteInMaps() {
    const coordStops = stops.filter((s) => s.lat != null && s.lng != null);
    const addrStops = stops.filter((s) => s.lat == null && s.customerAddress);

    if (coordStops.length === 0 && addrStops.length === 0) {
      Alert.alert('No locations', 'None of your stops have address or GPS data.');
      return;
    }

    // Build Google Maps Directions URL (max 10 waypoints)
    const origin = location ? `${location.lat},${location.lng}` : 'My+Location';
    const allStops = [...coordStops, ...addrStops].slice(0, 10);
    const destination = allStops[allStops.length - 1];
    const waypoints = allStops.slice(0, -1);

    const destStr =
      destination.lat != null
        ? `${destination.lat},${destination.lng}`
        : encodeURIComponent(destination.customerAddress!);

    const waypointStr = waypoints
      .map((s) => (s.lat != null ? `${s.lat},${s.lng}` : encodeURIComponent(s.customerAddress!)))
      .join('|');

    const url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${origin}` +
      `&destination=${destStr}` +
      (waypointStr ? `&waypoints=${waypointStr}` : '') +
      `&travelmode=driving`;

    Linking.openURL(url).catch(() =>
      Alert.alert('Error', 'Could not open Google Maps.'),
    );
  }

  function navigateToStop(stop: StopItem) {
    if (stop.lat != null && stop.lng != null) {
      Linking.openURL(`https://maps.google.com/?q=${stop.lat},${stop.lng}`);
    } else if (stop.customerAddress) {
      Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(stop.customerAddress)}`);
    } else {
      Alert.alert('No location', 'This customer has no address or GPS coordinates.');
    }
  }

  const coordCount = stops.filter((s) => s.distanceKm !== null).length;

  return (
    <View style={styles.root}>
      {/* Header info */}
      <View style={styles.headerCard}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>
              {allPending.length} stops today
            </Text>
            <Text style={styles.headerSub}>
              {gpsLoading
                ? 'Getting your location…'
                : coordCount > 0
                ? `${coordCount} stops sorted by proximity`
                : 'Sorted by amount (no GPS coordinates)'}
            </Text>
          </View>
          {gpsLoading && <ActivityIndicator color="#fff" />}
        </View>
        <TouchableOpacity
          style={styles.openMapsBtn}
          onPress={openRouteInMaps}
          disabled={stops.length === 0}
        >
          <Text style={styles.openMapsBtnText}>🗺  Open Full Route in Google Maps</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={stops}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎉</Text>
            <Text style={styles.emptyTitle}>All done for today!</Text>
            <Text style={styles.emptySub}>No pending or overdue stops</Text>
          </View>
        }
        renderItem={({ item: stop, index }) => (
          <View style={styles.card}>
            {/* Stop number */}
            <View style={[styles.stopNum, { backgroundColor: stop.status === 'OVERDUE' ? DANGER : BRAND }]}>
              <Text style={styles.stopNumText}>{index + 1}</Text>
            </View>

            <View style={styles.cardBody}>
              <View style={styles.cardTop}>
                <Text style={styles.customerName} numberOfLines={1}>
                  {stop.customerName}
                </Text>
                <Text style={[styles.amount, { color: stop.status === 'OVERDUE' ? DANGER : BRAND }]}>
                  {fmtCurrency(stop.amountDue)}
                </Text>
              </View>

              {stop.customerAddress ? (
                <Text style={styles.address} numberOfLines={1}>📍 {stop.customerAddress}</Text>
              ) : null}

              <View style={styles.cardBottom}>
                {stop.distanceKm !== null ? (
                  <Text style={styles.distance}>
                    {stop.distanceKm < 1
                      ? `${Math.round(stop.distanceKm * 1000)}m away`
                      : `${stop.distanceKm.toFixed(1)} km away`}
                  </Text>
                ) : (
                  <Text style={styles.noGps}>No GPS data</Text>
                )}
                <TouchableOpacity style={styles.navBtn} onPress={() => navigateToStop(stop)}>
                  <Text style={styles.navBtnText}>Navigate ›</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F9FAFB' },
  listContent: { paddingBottom: 30 },

  headerCard: {
    backgroundColor: BRAND,
    padding: 16,
    paddingTop: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 },
  openMapsBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  openMapsBtnText: { color: BRAND, fontWeight: '800', fontSize: 14 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: GRAY_BORDER,
    gap: 12,
  },
  stopNum: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stopNumText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  customerName: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  amount: { fontSize: 15, fontWeight: '800' },
  address: { fontSize: 11, color: GRAY, marginBottom: 8 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  distance: { fontSize: 12, color: BRAND, fontWeight: '600' },
  noGps: { fontSize: 11, color: GRAY },
  navBtn: {
    backgroundColor: BRAND_LIGHT,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  navBtnText: { color: BRAND, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#374151' },
  emptySub: { fontSize: 13, color: GRAY, marginTop: 6 },
});
