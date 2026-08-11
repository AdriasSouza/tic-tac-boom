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
 * `require()` de asset é side-effect-free (o Metro só devolve um id numérico)
 * — pode ficar em escopo de módulo sem risco. `createAudioPlayer`, não: no
 * web ele toca o `Audio` do DOM, que não existe durante a pré-renderização
 * estática do `expo-router` (roda em Node puro, sem browser, no `expo export`/
 * build da Vercel) — importar QUALQUER tela que puxe este módulo já derrubava
 * o build inteiro com `ReferenceError: Audio is not defined`.
 */
const SOURCES: Record<SoundCue, number> = {
  TAP_LIGHT: require('@/assets/sounds/tap_light.wav'),
  TAP_MEDIUM: require('@/assets/sounds/tap_medium.wav'),
  TAP_SOFT: require('@/assets/sounds/tap_soft.wav'),
  TAP_RIGID: require('@/assets/sounds/tap_rigid.wav'),
  TAP_HEAVY: require('@/assets/sounds/tap_heavy.wav'),
  NOTIFY_SUCCESS: require('@/assets/sounds/notify_success.wav'),
  NOTIFY_ERROR: require('@/assets/sounds/notify_error.wav'),
  NOTIFY_WARNING: require('@/assets/sounds/notify_warning.wav'),
  MATCH_WIN: require('@/assets/sounds/match_win.wav'),
  MATCH_LOSE: require('@/assets/sounds/match_lose.wav'),
  FUSION_SUCCESS: require('@/assets/sounds/fusion_success.wav'),
  ROULETTE_BOOM: require('@/assets/sounds/roulette_boom.wav'),
  CHAOS_SURGE: require('@/assets/sounds/chaos_surge.wav'),
};

/**
 * Um `AudioPlayer` por cue, criado sob demanda na PRIMEIRA chamada de
 * `playSound` (nunca em escopo de módulo — ver comentário de `SOURCES`) e
 * reaproveitado dali em diante (`seekTo(0)` + `play()` a cada toque, em vez
 * de recriar o player) — padrão de baixa latência recomendado pelos docs do
 * `expo-audio` (SDK 57) para efeitos curtos que disparam em repetição. Como
 * `playSound` só roda a partir de um handler de evento real (toque, jogada),
 * nunca durante a pré-renderização estática, a criação preguiçosa por si só
 * já evita o `Audio is not defined` sem precisar checar plataforma/ambiente.
 */
const players: Partial<Record<SoundCue, AudioPlayer>> = {};

function getPlayer(cue: SoundCue): AudioPlayer {
  const existing = players[cue];
  if (existing) return existing;
  const created = createAudioPlayer(SOURCES[cue]);
  players[cue] = created;
  return created;
}

/**
 * Toca uma cue. No-op silencioso se o jogador desligou o som
 * (`settingsStore`) — mesmo formato "dispara e esquece" que
 * `Haptics.impactAsync(...)` já tem em cada call site (`void playSound(...)`
 * ao lado de `void Haptics.impactAsync(...)`).
 */
export function playSound(cue: SoundCue): void {
  if (!useSettingsStore.getState().soundEnabled) return;
  const player = getPlayer(cue);
  player.volume = VOLUME;
  void player.seekTo(0);
  player.play();
}
