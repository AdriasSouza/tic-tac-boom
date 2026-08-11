import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { useSettingsStore } from '@/store/settingsStore';

/**
 * Catálogo pequeno, não 47 sons únicos — espelha os sabores que
 * `expo-haptics` já usa nos mesmos pontos de chamada (5 de `impactAsync` + 3
 * de `notificationAsync`), reutilizados entre vários gatilhos, mais um punhado
 * de estingues com identidade própria para momentos de destaque (fusão no
 * Altar, roleta do caos, fim de partida). Ver `scripts/generate-sfx.mjs` para
 * como cada `.wav` foi sintetizado.
 */
export type SoundCue =
  | 'TAP_LIGHT'
  | 'TAP_MEDIUM'
  | 'TAP_SOFT'
  | 'TAP_RIGID'
  | 'TAP_HEAVY'
  | 'NOTIFY_SUCCESS'
  | 'NOTIFY_ERROR'
  | 'NOTIFY_WARNING'
  | 'MATCH_WIN'
  | 'MATCH_LOSE'
  | 'FUSION_SUCCESS'
  | 'ROULETTE_BOOM'
  | 'CHAOS_SURGE';

const VOLUME = 0.6;

/**
 * Um `AudioPlayer` por cue, criado em escopo de módulo e reaproveitado entre
 * chamadas (`seekTo(0)` + `play()` a cada toque, em vez de recriar o player) —
 * é o padrão de baixa latência recomendado pelos docs do `expo-audio` (SDK
 * 57) para efeitos curtos que disparam a repetição.
 */
const PLAYERS: Record<SoundCue, AudioPlayer> = {
  TAP_LIGHT: createAudioPlayer(require('@/assets/sounds/tap_light.wav')),
  TAP_MEDIUM: createAudioPlayer(require('@/assets/sounds/tap_medium.wav')),
  TAP_SOFT: createAudioPlayer(require('@/assets/sounds/tap_soft.wav')),
  TAP_RIGID: createAudioPlayer(require('@/assets/sounds/tap_rigid.wav')),
  TAP_HEAVY: createAudioPlayer(require('@/assets/sounds/tap_heavy.wav')),
  NOTIFY_SUCCESS: createAudioPlayer(require('@/assets/sounds/notify_success.wav')),
  NOTIFY_ERROR: createAudioPlayer(require('@/assets/sounds/notify_error.wav')),
  NOTIFY_WARNING: createAudioPlayer(require('@/assets/sounds/notify_warning.wav')),
  MATCH_WIN: createAudioPlayer(require('@/assets/sounds/match_win.wav')),
  MATCH_LOSE: createAudioPlayer(require('@/assets/sounds/match_lose.wav')),
  FUSION_SUCCESS: createAudioPlayer(require('@/assets/sounds/fusion_success.wav')),
  ROULETTE_BOOM: createAudioPlayer(require('@/assets/sounds/roulette_boom.wav')),
  CHAOS_SURGE: createAudioPlayer(require('@/assets/sounds/chaos_surge.wav')),
};

/**
 * Toca uma cue. No-op silencioso se o jogador desligou o som
 * (`settingsStore`) — mesmo formato "dispara e esquece" que
 * `Haptics.impactAsync(...)` já tem em cada call site (`void playSound(...)`
 * ao lado de `void Haptics.impactAsync(...)`).
 */
export function playSound(cue: SoundCue): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const player = PLAYERS[cue];
  player.volume = VOLUME;
  void player.seekTo(0);
  player.play();
}
