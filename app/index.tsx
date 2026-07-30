import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { withRepeat, withTiming, withSequence, useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import PixelButton from '@/components/ui/PixelButton';
import HowToPlayModal from '@/components/ui/HowToPlayModal';
import CreditsModal from '@/components/ui/CreditsModal';

export default function TitleScreen() {
  const router = useRouter();
  const [modalVisible, setModalVisible] = useState(false);
  const [creditsVisible, setCreditsVisible] = useState(false);

  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 900 }), 
        withTiming(1, { duration: 900 })
      ),
      -1,
      true
    );
  }, []);

  const animatedTitle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }]
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.titleContainer, animatedTitle]}>
        <Text style={styles.titleText}>TIC TAC</Text>
        <Text style={styles.boomText}>BOOM</Text>
      </Animated.View>

    <View style={styles.menu}>
      <PixelButton 
        label="Jogar vs CPU" 
        onPress={() => router.push({ pathname: '/game/[mode]', params: { mode: 'cpu' } })} 
      />
      <PixelButton
        label="Jogar Local"
        onPress={() => router.push({ pathname: '/game/[mode]', params: { mode: 'local' } })}
      />
      <PixelButton
        label="Jogar Online"
        variant="secondary"
        onPress={() => router.push('/lobby')}
      />
      <PixelButton
        label="Como Jogar"
        onPress={() => setModalVisible(true)}
      />
      <PixelButton
        label="Créditos"
        variant="ghost"
        onPress={() => setCreditsVisible(true)}
      />
    </View>

      {modalVisible && (
        <HowToPlayModal visible={modalVisible} onClose={() => setModalVisible(false)} />
      )}
      {creditsVisible && (
        <CreditsModal visible={creditsVisible} onClose={() => setCreditsVisible(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  titleContainer: { marginBottom: 80, alignItems: 'center' },
  titleText: { fontSize: 44, color: '#FFF', fontWeight: 'bold', letterSpacing: 2 },
  boomText: { fontSize: 68, color: '#FF3366', fontWeight: '900', marginTop: -15, letterSpacing: 4 },
  menu: { gap: 20 }
});