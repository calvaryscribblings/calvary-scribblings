import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { ref, get } from 'firebase/database';
import { db } from '../lib/firebase';

const CATEGORY_COLORS = {
  news: '#ef4444', flash: '#6b2fad', short: '#6b2fad',
  poetry: '#6b2fad', inspiring: '#d97706', novel: '#6b2fad',
};

function stripHTML(html) {
  return html
    ?.replace(/<[^>]*>/g, ' ')
    ?.replace(/&amp;/g, '&')
    ?.replace(/&nbsp;/g, ' ')
    ?.replace(/&lt;/g, '<')
    ?.replace(/&gt;/g, '>')
    ?.replace(/\s+/g, ' ')
    ?.trim() || '';
}

export default function StoryScreen() {
  const { slug } = useLocalSearchParams();
  const navigation = useNavigation();
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const snap = await get(ref(db, `cms_stories/${slug}`));
        if (snap.exists()) {
          const s = { id: slug, ...snap.val() };
          setStory(s);
          navigation.setOptions({ title: s.title, headerBackTitle: 'Back' });
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [slug]);

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator color="#6b2fad" size="large" />
    </View>
  );

  if (!story) return (
    <View style={styles.center}>
      <Text style={{ color: '#f0ead8' }}>Story not found.</Text>
    </View>
  );

  const accentColor = CATEGORY_COLORS[story.category] || '#6b2fad';
  const coverUrl = story.cover?.startsWith('http')
    ? story.cover
    : `https://calvaryscribblings.co.uk${story.cover}`;

  return (
    <ScrollView style={styles.container}>
      <Image source={{ uri: coverUrl }} style={styles.hero} />
      <View style={styles.body}>
        <View style={[styles.badge, { borderColor: accentColor }]}>
          <Text style={[styles.badgeText, { color: accentColor }]}>
            {story.categoryName || story.category}
          </Text>
        </View>
        <Text style={styles.title}>{story.title}</Text>
        <Text style={styles.byline}>by {story.author} · {story.date}</Text>
        <View style={styles.divider} />
        <Text style={styles.content}>{stripHTML(story.content)}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  hero: { width: '100%', height: 280, resizeMode: 'cover' },
  body: { padding: 24 },
  badge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 2,
    paddingHorizontal: 8, paddingVertical: 3, marginBottom: 12,
  },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  title: { fontSize: 26, fontWeight: '700', color: '#f0ead8', lineHeight: 34, marginBottom: 10, textAlign: 'left', fontFamily: 'Cochin' },
  byline: { fontSize: 13, color: 'rgba(240,234,216,0.45)', marginBottom: 20, textAlign: 'left' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 24 },
  content: { fontSize: 17, color: 'rgba(240,234,216,0.85)', lineHeight: 30, textAlign: 'left', fontFamily: 'Cochin' },
});