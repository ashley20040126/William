import { Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useStore } from '@/services/store';
import AppShell from '@/components/AppShell';
import AuthScreen from '@/screens/AuthScreen';
import OnboardingScreen from '@/screens/OnboardingScreen';
import TodayScreen from '@/screens/TodayScreen';
import ChatScreen from '@/screens/ChatScreen';
import JourneyScreen from '@/screens/JourneyScreen';
import YouScreen from '@/screens/YouScreen';
import PathDetailScreen from '@/screens/PathDetailScreen';
import MoodScreen from '@/screens/MoodScreen';
import SettingsScreen from '@/screens/SettingsScreen';

export default function App() {
  const token = useStore((s) => s.token);
  const onboarded = useStore((s) => s.onboarded);

  // Not logged in → show auth screen
  if (!token) return <AuthScreen />;

  // Logged in but not onboarded → show profile setup
  if (!onboarded) return <OnboardingScreen />;

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/" element={<TodayScreen />} />
          <Route path="/chat" element={<ChatScreen />} />
          <Route path="/journey" element={<JourneyScreen />} />
          <Route path="/story" element={<Navigate to="/journey" replace />} />
          <Route path="/you" element={<YouScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/path/:pathId" element={<PathDetailScreen />} />
          <Route path="/mood" element={<MoodScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  );
}
