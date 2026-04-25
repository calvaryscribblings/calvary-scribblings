import { Tabs } from 'expo-router';

function HomeIcon({ color }) {
  return null;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: '#111',
          borderTopColor: 'rgba(255,255,255,0.06)',
          borderTopWidth: 1,
          height: 85,
          paddingBottom: 28,
          paddingTop: 10,
        },
        tabBarActiveTintColor: '#6b2fad',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.35)',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.5,
        },
        headerStyle: { backgroundColor: '#0a0a0a' },
        headerTintColor: '#f0ead8',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => (
            <TabIcon name="home" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarLabel: 'Search',
          tabBarIcon: ({ color }) => (
            <TabIcon name="search" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color }) => (
            <TabIcon name="profile" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

function TabIcon({ name, color }) {
  const icons = {
    home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    profile: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  };
  const { Svg, Path } = require('react-native-svg');
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill={color}>
      <Path d={icons[name]} />
    </Svg>
  );
}