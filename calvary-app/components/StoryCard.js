import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';

const CATEGORY_COLORS = {
  news: '#ef4444',
  flash: '#6b2fad',
  short: '#6b2fad',
  poetry: '#6b2fad',
  inspiring: '#d97706',
  novel: '#6b2fad',
};

export default function StoryCard({ story, onPress }) {
  const accentColor = CATEGORY_COLORS[story.category] || '#6b2fad';
  const coverUrl = story.cover?.startsWith('http')
    ? story.cover
    : `https://calvaryscribblings.co.uk${story.cover}`;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <Image source={{ uri: coverUrl }} style={styles.cover} />
      <View style={styles.overlay} />
      <View style={styles.content}>
        <View style={[styles.badge, { borderColor: accentColor }]}>
          <Text style={[styles.badgeText, { color: accentColor }]}>
            {story.categoryName || story.category}
          </Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{story.title}</Text>
        <Text style={styles.author}>by {story.author} · {story.date}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
  },
  cover: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  overlay: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  content: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f0ead8',
    marginBottom: 6,
    lineHeight: 26,
  },
  author: {
    fontSize: 12,
    color: 'rgba(240,234,216,0.55)',
    letterSpacing: 0.5,
  },
});