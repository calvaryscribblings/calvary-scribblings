import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';
import StoryCard from '../components/StoryCard';
import { router } from 'expo-router';

export default function HomeScreen() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchStories() {
    try {
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) {
        const data = snap.val();
        const list = Object.entries(data)
          .map(([id, s]) => ({ id, ...s }))
          .filter(s => s.published !== false)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        setStories(list);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { fetchStories(); }, []);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStories(); }} tintColor="#6b2fad" />}
    >
      <View style={styles.header}>
        <Text style={styles.logo}>Calvary <Text style={styles.accent}>Scribblings</Text></Text>
        <Text style={styles.tagline}>The Story Island 🏝️</Text>
      </View>

      <View style={styles.feed}>
        {loading ? (
          <ActivityIndicator color="#6b2fad" size="large" style={{ marginTop: 40 }} />
        ) : (
          stories.map(story => (
            <StoryCard
              key={story.id}
              story={story}
              onPress={() => router.push(`/${story.id}`)}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { padding: 24, paddingTop: 60, paddingBottom: 16 },
  logo: { fontSize: 26, fontWeight: '700', color: '#f0ead8' },
  accent: { color: '#6b2fad' },
  tagline: { fontSize: 13, color: 'rgba(240,234,216,0.45)', marginTop: 4 },
  feed: { paddingHorizontal: 16, paddingBottom: 40 },
});