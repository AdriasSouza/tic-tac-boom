#!/usr/bin/env node
/**
 * Gera os efeitos sonoros retrô do jogo como WAV puro — sem áudio gravado, sem
 * banco de assets externo. Mesma técnica por trás de sfxr/jsfxr: osciladores
 * simples (quadrada/triângulo/ruído) com sweep de frequência e um envelope de
 * volume curto e percussivo. Roda uma vez, manualmente (`node
 * scripts/generate-sfx.mjs`); os `.wav` resultantes ficam versionados em
 * `assets/sounds/` — não faz parte do bundle/build do app.
 *
 * 22050 Hz mono 16-bit de propósito: além de gerar arquivos bem menores, a
 * taxa de amostragem mais baixa dá um caráter granulado/lo-fi que É o som
 * "8-bit" — não é uma limitação, é o timbre.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22050;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

/* -------------------------------------------------------------------------- */
/*                                 OSCILADORES                                */
/* -------------------------------------------------------------------------- */

function square(phase, duty = 0.5) {
  return (phase % 1) < duty ? 1 : -1;
}

function triangle(phase) {
  const p = phase % 1;
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
}

/** Interpolação exponencial: passos de razão igual soam como um bend de pitch natural. */
function expLerp(a, b, t) {
  if (a <= 0 || b <= 0) return a + (b - a) * t;
  return a * Math.pow(b / a, t);
}

/**
 * Uma "nota": oscilador + sweep de frequência + envelope percussivo (ataque
 * linear curto, depois uma curva de decaimento até o silêncio — sem sustain,
 * blips de retrô são só isso).
 */
function renderNote({
  wave = 'square',
  duty = 0.5,
  freqFrom,
  freqTo = freqFrom,
  duration,
  volume = 0.3,
  attack = 0.003,
  curve = 2,
}) {
  const n = Math.round(duration * SAMPLE_RATE);
  const samples = new Float32Array(n);
  let phase = 0;
  let noiseState = 0;

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const frac = duration > 0 ? t / duration : 0;

    let s;
    if (wave === 'noise') {
      noiseState += 0.35 * (Math.random() * 2 - 1 - noiseState);
      s = noiseState;
    } else {
      const freq = expLerp(freqFrom, freqTo, frac);
      phase += freq / SAMPLE_RATE;
      if (wave === 'square') s = square(phase, duty);
      else if (wave === 'triangle') s = triangle(phase);
      else s = Math.sin(2 * Math.PI * phase);
    }

    let env;
    if (t < attack) {
      env = t / attack;
    } else {
      const rel = (t - attack) / Math.max(duration - attack, 1e-6);
      env = Math.pow(Math.max(1 - rel, 0), curve);
    }

    samples[i] = s * env * volume;
  }

  return samples;
}

function concatNotes(notes, gap = 0) {
  const gapSamples = Math.round(gap * SAMPLE_RATE);
  const total = notes.reduce((sum, note) => sum + note.length + gapSamples, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const note of notes) {
    out.set(note, offset);
    offset += note.length + gapSamples;
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
    renderNote({ wave: 'square', freqFrom: 1046.5, duration: 0.045, volume: 0.22, attack: 0.002, curve: 3 }),

  tap_medium: () =>
    renderNote({ wave: 'square', freqFrom: 659.25, duration: 0.07, volume: 0.32, attack: 0.002, curve: 2.5 }),

  tap_soft: () =>
    renderNote({ wave: 'triangle', freqFrom: 392, duration: 0.06, volume: 0.16, attack: 0.006, curve: 2 }),

  tap_rigid: () =>
    renderNote({
      wave: 'square',
      duty: 0.2,
      freqFrom: 520,
      freqTo: 340,
      duration: 0.05,
      volume: 0.3,
      attack: 0.001,
      curve: 4,
    }),

  tap_heavy: () =>
    mixDown(
      renderNote({
        wave: 'square',
        freqFrom: 220,
        freqTo: 140,
        duration: 0.14,
        volume: 0.35,
        attack: 0.001,
        curve: 1.6,
      }),
      renderNote({ wave: 'noise', freqFrom: 1, duration: 0.03, volume: 0.25, attack: 0.001, curve: 6 }),
    ),

  notify_success: () =>
    concatNotes(
      [
        renderNote({ wave: 'square', freqFrom: 523.25, duration: 0.07, volume: 0.3, attack: 0.002, curve: 1.8 }),
        renderNote({ wave: 'square', freqFrom: 783.99, duration: 0.11, volume: 0.32, attack: 0.002, curve: 1.6 }),
      ],
      0.01,
    ),

  notify_error: () =>
    renderNote({
      wave: 'square',
      duty: 0.35,
      freqFrom: 300,
      freqTo: 110,
      duration: 0.2,
      volume: 0.34,
      attack: 0.001,
      curve: 1.4,
    }),

  notify_warning: () =>
    concatNotes(
      [
        renderNote({ wave: 'triangle', freqFrom: 440, duration: 0.06, volume: 0.28, attack: 0.002, curve: 2.2 }),
        renderNote({ wave: 'triangle', freqFrom: 440, duration: 0.06, volume: 0.28, attack: 0.002, curve: 2.2 }),
      ],
      0.05,
    ),

  // --- 5 estingues únicos: momentos de destaque, timbre próprio ---
  match_win: () =>
    concatNotes(
      [
        renderNote({ wave: 'square', freqFrom: 523.25, duration: 0.09, volume: 0.3, attack: 0.002, curve: 1.6 }),
        renderNote({ wave: 'square', freqFrom: 659.25, duration: 0.09, volume: 0.3, attack: 0.002, curve: 1.6 }),
        renderNote({ wave: 'square', freqFrom: 783.99, duration: 0.09, volume: 0.32, attack: 0.002, curve: 1.6 }),
        renderNote({ wave: 'square', freqFrom: 1046.5, duration: 0.22, volume: 0.36, attack: 0.002, curve: 1.2 }),
      ],
      0.008,
    ),

  match_lose: () =>
    concatNotes(
      [
        renderNote({ wave: 'square', freqFrom: 392, duration: 0.14, volume: 0.3, attack: 0.003, curve: 1.6 }),
        renderNote({ wave: 'square', freqFrom: 349.23, duration: 0.14, volume: 0.28, attack: 0.003, curve: 1.6 }),
        renderNote({ wave: 'square', freqFrom: 293.66, duration: 0.14, volume: 0.26, attack: 0.003, curve: 1.6 }),
        renderNote({
          wave: 'square',
          freqFrom: 261.63,
          freqTo: 220,
          duration: 0.32,
          volume: 0.28,
          attack: 0.004,
          curve: 1.1,
        }),
      ],
      0.012,
    ),

  fusion_success: () =>
    concatNotes(
      [
        renderNote({ wave: 'square', freqFrom: 659.25, duration: 0.045, volume: 0.26, attack: 0.001, curve: 2 }),
        renderNote({ wave: 'square', freqFrom: 830.61, duration: 0.045, volume: 0.28, attack: 0.001, curve: 2 }),
        renderNote({ wave: 'square', freqFrom: 1046.5, duration: 0.045, volume: 0.3, attack: 0.001, curve: 2 }),
        renderNote({ wave: 'square', freqFrom: 1318.5, duration: 0.09, volume: 0.34, attack: 0.001, curve: 1.5 }),
        renderNote({ wave: 'square', freqFrom: 1568, duration: 0.14, volume: 0.3, attack: 0.001, curve: 1.3 }),
      ],
      0.004,
    ),

  roulette_boom: () =>
    mixDown(
      renderNote({ wave: 'noise', freqFrom: 1, duration: 0.4, volume: 0.42, attack: 0.001, curve: 1.6 }),
      renderNote({
        wave: 'square',
        freqFrom: 130,
        freqTo: 45,
        duration: 0.42,
        volume: 0.4,
        attack: 0.001,
        curve: 1.3,
      }),
    ),

  chaos_surge: () =>
    renderNote({
      wave: 'square',
      duty: 0.3,
      freqFrom: 220,
      freqTo: 1320,
      duration: 0.26,
      volume: 0.3,
      attack: 0.004,
      curve: 1.4,
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
