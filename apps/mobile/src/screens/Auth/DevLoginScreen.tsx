import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { useAuth } from '../../contexts/AuthContext';
import { API_BASE } from '../../services/api';

interface DevUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export default function DevLoginScreen({ navigation }: { navigation: { goBack: () => void } }) {
  const { setUser } = useAuth();
  const [users, setUsers] = useState<DevUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [signingInId, setSigningInId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dev/list-users`);
        if (!res.ok) throw new Error(`list-users returned ${res.status}`);
        const body = (await res.json()) as { users: DevUser[] };
        if (!cancelled) setUsers(body.users ?? []);
      } catch (err) {
        if (!cancelled) {
          Alert.alert(
            'Dev login unavailable',
            err instanceof Error ? err.message : String(err),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signInAs = async (user: DevUser) => {
    setSigningInId(user.id);
    try {
      const res = await fetch(`${API_BASE}/api/dev/issue-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`issue-token failed: ${res.status} ${body}`);
      }
      const body = (await res.json()) as {
        token: string;
        user: { id: string; name: string; email: string; image: string | null };
      };
      setUser(body.user, body.token);
    } catch (err) {
      Alert.alert('Sign-in failed', err instanceof Error ? err.message : String(err));
      setSigningInId(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.brand.black} />
        </TouchableOpacity>
        <Text style={styles.title}>Dev login</Text>
      </View>
      <Text style={styles.subtitle}>
        Pick a seeded user. Available because EXPO_PUBLIC_DEV_AUTH=true and the
        backend has ENABLE_DEV_AUTH=true.
      </Text>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand.green} />
        </View>
      ) : users.length === 0 ? (
        <Text style={styles.empty}>
          No anchor users found. Run `pnpm db:seed` against your local DB.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {users.map((u) => (
            <TouchableOpacity
              key={u.id}
              style={[styles.row, signingInId === u.id && styles.rowDisabled]}
              disabled={signingInId !== null}
              onPress={() => signInAs(u)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{u.name}</Text>
                <Text style={styles.email}>{u.email}</Text>
              </View>
              {signingInId === u.id ? (
                <ActivityIndicator color={colors.brand.green} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.text.muted} />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.brand.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 4, marginRight: 8 },
  title: { fontSize: 22, fontWeight: '700', color: colors.brand.black },
  subtitle: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    color: colors.text.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: {
    paddingHorizontal: 24,
    color: colors.text.muted,
    fontSize: 14,
  },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  rowDisabled: { opacity: 0.5 },
  name: { fontSize: 15, fontWeight: '600', color: colors.brand.black },
  email: { fontSize: 13, color: colors.text.muted, marginTop: 2 },
});
