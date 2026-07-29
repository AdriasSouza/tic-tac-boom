import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      {/*
        Estava faltando: o `<SafeAreaView>` de `app/game/[mode].tsx` (e
        qualquer `useSafeAreaInsets` futuro) depende de um `SafeAreaProvider`
        ancestral. No NATIVO isso passava despercebido — a `SafeAreaView` do
        `react-native-safe-area-context` mede seus próprios insets via um
        componente nativo, sem depender do Context — mas na WEB a mesma
        `SafeAreaView` lê os insets via `useSafeAreaInsets()`, que LANÇA sem
        um Provider por perto. Sem isto o build web quebraria assim que a
        tela de jogo montasse.
      */}
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}