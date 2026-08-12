#!/usr/bin/env node
/**
 * Gera os efeitos sonoros retrô do jogo como WAV puro, em cima do motor de
 * síntese do `jsfxr` (devDependency — só este script usa; nunca entra no
 * bundle do app). Não os presets ALEATÓRIOS do jsfxr (`sfxr.generate('...')`
 * usa `Math.random()` a cada chamada, o que tornaria a regeneração
 * irreprodutível) — em vez disso, `Params`/`SoundEffect` (as classes de baixo
 * nível que o próprio pacote exporta) são alimentadas com valores FIXOS,
 * escolhidos a dedo por cue, inspirados nos presets (`powerUp`, `explosion`,
 * `hitHurt` etc. em `node_modules/jsfxr/sfxr.js`) mas determinísticos.
 *
 * Ganho sobre a v1 (osciladores quadrada/triângulo/ruído escritos à mão): o
 * motor do jsfxr tem vibrato, salto de arpejo (mudança de pitch no MEIO da
 * nota), sweep de duty cycle e filtros passa-baixa/passa-alta — é o que dá o
 * "punch" de jogo arcade que uma onda quadrada pura com envelope linear não
 * tem.
 *
 * Roda uma vez, manualmente (`node scripts/generate-sfx.mjs`); os `.wav`
 * resultantes ficam versionados em `assets/sounds/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import jsfxrModule from 'jsfxr';

const { Params, SoundEffect } = jsfxrModule;

const SAMPLE_RATE = 22050;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

const SQUARE = 0;
const SAWTOOTH = 1;
const SINE = 2;
const NOISE = 3;

/* -------------------------------------------------------------------------- */
/*                    PONTE ENTRE Hz E O PARÂMETRO DO JSFXR                    */
/* -------------------------------------------------------------------------- */
/* `p_base_freq` não é Hz — é derivado por engenharia reversa do preset
   `tone()` do próprio jsfxr (`p_base_freq: 0.35173364 // 440 Hz`): o motor
   soma 8 sub-amostras (`OVERSAMPLING`) por tick a uma taxa INTERNA fixa de
   44100Hz, independente do `sample_rate` configurado, então o pitch avança a
   44100*8 = 352800 "ticks de fase" por segundo. Invertendo
   `period = 100/(p_base_freq²+0.001)` e `freq = 352800/period`:
     p_base_freq = √(100·freq/352800 − 0.001)
   Confere exatamente com a constante documentada de `tone()` para 440Hz. */
const PHASE_TICK_RATE = 352800;
function freqToParam(hz) {
  return Math.sqrt(Math.max(0, (100 * hz) / PHASE_TICK_RATE - 0.001));
}

/* -------------------------------------------------------------------------- */
/*                                   SÍNTESE                                   */
/* -------------------------------------------------------------------------- */

/** Uma "nota": um `Params` do jsfxr renderizado via `SoundEffect`, devolvido
 * como amostras float normalizadas (`getRawBuffer().normalized`) — não a
 * `buffer` já quantizada de `sfxr.toBuffer`, que embute o `sample_size` (8
 * bits por padrão) direto nos bytes. Ficar nas floats deixa o requantizar
 * pra 16 bits em `writeWav`, sempre no mesmo bit-depth pros 13 arquivos. */
function note(overrides) {
  const params = new Params();
  params.sample_rate = SAMPLE_RATE;
  Object.assign(params, overrides);
  const effect = new SoundEffect(params);
  return Float32Array.from(effect.getRawBuffer().normalized);
}

function concatNotes(notes, gap = 0) {
  const gapSamples = Math.round(gap * SAMPLE_RATE);
  const total = notes.reduce((sum, n) => sum + n.length + gapSamples, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const n of notes) {
    out.set(n, offset);
    offset += n.length + gapSamples;
  }
  return out;
}

/** Soma camadas (ex.: thud grave + estouro de ruído) com soft-clip pra não estourar digitalmente. */
function mixDown(...layers) {
  const len = Math.max(...layers.map((layer) => layer.length));
  const out = new Float32Array(len);
  for (const layer of layers) {
    for (let i = 0; i < layer.length; i++) out[i] += layer[i];
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]);
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                  CATÁLOGO                                  */
/* -------------------------------------------------------------------------- */

const CUES = {
  // --- 8 sons base: espelham os sabores de expo-haptics já em uso ---
  tap_light: () =>
    note({
      wave_type: SQUARE,
      p_base_freq: freqToParam(1046.5),
      p_env_sustain: 0.02,
      p_env_decay: 0.08,
      p_env_punch: 0.15,
      p_duty: 0.5,
      sound_vol: 0.18,
    }),

  tap_medium: () =>
    note({
      wave_type: SQUARE,
      p_base_freq: freqToParam(659.25),
      p_env_sustain: 0.03,
      p_env_decay: 0.12,
      p_env_punch: 0.3,
      p_duty: 0.4,
      sound_vol: 0.26,
    }),

  tap_soft: () =>
    note({
      wave_type: SINE,
      p_base_freq: freqToParam(392),
      p_env_attack: 0.02,
      p_env_sustain: 0.03,
      p_env_decay: 0.1,
      p_lpf_freq: 0.35,
      sound_vol: 0.16,
    }),

  tap_rigid: () =>
    note({
      wave_type: SQUARE,
      p_base_freq: freqToParam(1200),
      p_freq_ramp: -0.35,
      p_env_sustain: 0.012,
      p_env_decay: 0.055,
      p_env_punch: 0.45,
      p_duty: 0.15,
      p_hpf_freq: 0.2,
      sound_vol: 0.28,
    }),

  tap_heavy: () =>
    mixDown(
      note({
        wave_type: SAWTOOTH,
        p_base_freq: freqToParam(150),
        p_freq_ramp: -0.3,
        p_env_sustain: 0.05,
        p_env_decay: 0.18,
        p_env_punch: 0.5,
        p_duty: 1,
        sound_vol: 0.34,
      }),
      note({
        wave_type: NOISE,
        p_base_freq: 0.55,
        p_env_sustain: 0.008,
        p_env_decay: 0.045,
        p_env_punch: 0.3,
        sound_vol: 0.22,
      }),
    ),

  notify_success: () =>
    note({
      wave_type: SAWTOOTH,
      p_base_freq: freqToParam(523.25),
      p_freq_ramp: 0.12,
      p_env_sustain: 0.09,
      p_env_decay: 0.22,
      p_env_punch: 0.35,
      p_duty: 1,
      p_arp_mod: 0.3, // salto de pitch PRA CIMA no meio da nota — o "ding" de recompensa
      p_arp_speed: 0.55,
      sound_vol: 0.3,
    }),

  notify_error: () =>
    note({
      wave_type: SQUARE,
      p_base_freq: freqToParam(300),
      p_freq_ramp: -0.4,
      p_env_sustain: 0.04,
      p_env_decay: 0.18,
      p_env_punch: 0.25,
      p_duty: 0.35,
      p_hpf_freq: 0.15,
      sound_vol: 0.3,
    }),

  notify_warning: () => {
    const beep = () =>
      note({
        wave_type: SQUARE,
        p_base_freq: freqToParam(440),
        p_env_attack: 0.002,
        p_env_sustain: 0.05,
        p_env_decay: 0.06,
        p_env_punch: 0.2,
        p_duty: 0.5,
        sound_vol: 0.26,
      });
    return concatNotes([beep(), beep()], 0.05);
  },

  // --- 5 estingues únicos: momentos de destaque, timbre próprio ---
  match_win: () =>
    concatNotes(
      [
        note({
          wave_type: SAWTOOTH,
          p_base_freq: freqToParam(523.25),
          p_env_sustain: 0.06,
          p_env_decay: 0.05,
          p_env_punch: 0.3,
          p_duty: 1,
          sound_vol: 0.28,
        }),
        note({
          wave_type: SAWTOOTH,
          p_base_freq: freqToParam(659.25),
          p_env_sustain: 0.06,
          p_env_decay: 0.05,
          p_env_punch: 0.32,
          p_duty: 1,
          sound_vol: 0.3,
        }),
        note({
          wave_type: SAWTOOTH,
          p_base_freq: freqToParam(783.99),
          p_env_sustain: 0.06,
          p_env_decay: 0.05,
          p_env_punch: 0.34,
          p_duty: 1,
          sound_vol: 0.32,
        }),
        note({
          wave_type: SAWTOOTH,
          p_base_freq: freqToParam(1046.5),
          p_env_sustain: 0.14,
          p_env_decay: 0.2,
          p_env_punch: 0.42,
          p_duty: 1,
          p_vib_strength: 0.15,
          p_vib_speed: 0.4,
          sound_vol: 0.36,
        }),
      ],
      0.006,
    ),

  match_lose: () =>
    concatNotes(
      [
        note({
          wave_type: SQUARE,
          p_base_freq: freqToParam(392),
          p_env_attack: 0.012,
          p_env_sustain: 0.1,
          p_env_decay: 0.06,
          p_env_punch: 0.2,
          p_duty: 0.4,
          sound_vol: 0.26,
        }),
        note({
          wave_type: SQUARE,
          p_base_freq: freqToParam(349.23),
          p_env_attack: 0.012,
          p_env_sustain: 0.1,
          p_env_decay: 0.06,
          p_env_punch: 0.18,
          p_duty: 0.4,
          sound_vol: 0.24,
        }),
        note({
          wave_type: SQUARE,
          p_base_freq: freqToParam(293.66),
          p_env_attack: 0.012,
          p_env_sustain: 0.1,
          p_env_decay: 0.06,
          p_env_punch: 0.16,
          p_duty: 0.4,
          sound_vol: 0.22,
        }),
        note({
          wave_type: SQUARE,
          p_base_freq: freqToParam(261.63),
          p_freq_ramp: -0.15, // sagging até perto de A3 — o "suspiro" final
          p_env_attack: 0.015,
          p_env_sustain: 0.1,
          p_env_decay: 0.28,
          p_env_punch: 0.14,
          p_duty: 0.4,
          sound_vol: 0.26,
        }),
      ],
      0.014,
    ),

  fusion_success: () =>
    concatNotes(
      [659.25, 830.61, 1046.5, 1318.51, 1567.98].map((freq, i) =>
        note({
          wave_type: SQUARE,
          p_base_freq: freqToParam(freq),
          p_env_attack: 0.001,
          p_env_sustain: 0.035,
          p_env_decay: 0.05,
          p_env_punch: 0.25,
          p_duty: 0.35,
          sound_vol: 0.24 + i * 0.02,
        }),
      ),
      0.004,
    ),

  roulette_boom: () =>
    mixDown(
      note({
        wave_type: NOISE,
        p_base_freq: 0.35,
        p_freq_ramp: -0.3,
        p_env_sustain: 0.15,
        p_env_decay: 0.3,
        p_env_punch: 0.5,
        p_pha_offset: 0.2,
        p_pha_ramp: -0.15,
        sound_vol: 0.42,
      }),
      note({
        wave_type: SAWTOOTH,
        p_base_freq: freqToParam(70),
        p_freq_ramp: -0.25,
        p_env_sustain: 0.1,
        p_env_decay: 0.32,
        p_env_punch: 0.5,
        p_duty: 1,
        sound_vol: 0.38,
      }),
    ),

  chaos_surge: () =>
    note({
      wave_type: SQUARE,
      p_base_freq: freqToParam(220),
      p_freq_ramp: 0.35,
      p_env_attack: 0.004,
      p_env_sustain: 0.12,
      p_env_decay: 0.12,
      p_env_punch: 0.3,
      p_duty: 0.3,
      p_vib_strength: 0.4,
      p_vib_speed: 0.7,
      p_arp_mod: 0.25,
      p_arp_speed: 0.5,
      sound_vol: 0.32,
    }),
};

/* -------------------------------------------------------------------------- */
/*                                    WAV                                     */
/* -------------------------------------------------------------------------- */

function writeWav(filename, floatSamples) {
  const n = floatSamples.length;
  const buffer = Buffer.alloc(44 + n * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(n * 2, 40);

  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, filename);
  writeFileSync(filePath, buffer);
  console.log('wrote', filePath, `(${((n / SAMPLE_RATE) * 1000).toFixed(0)}ms)`);
}

for (const [name, generate] of Object.entries(CUES)) {
  writeWav(`${name}.wav`, generate());
}
