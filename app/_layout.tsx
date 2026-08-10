import * as ScreenOrientation from 'expo-screen-orientation';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  /**
   * `app.json` já declara `"orientation": "portrait"`, mas isso é só uma
   * config estática lida em build-time — nada a reforça em runtime. Num
   * binário instalado a partir de um build desatualizado (ou no target web,
   * onde essa chave não tem efeito nenhum), o SO pode girar mesmo assim, o
   * que derruba e recria a Activity nativa e remonta o app inteiro do zero —
   * era essa a causa raiz de "girar o celular reinicia a partida" (nada em
   * `gameStore`/`multiplayerStore` sobrevive a um remount). Travar aqui
   * também, explicitamente, fecha essa lacuna para qualquer build que já
   * inclua este código nativo — exige rebuild (EAS/prebuild), instalar só o
   * pacote JS não é suficiente num binário já existente.
   */
  useEffect(() => {
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

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