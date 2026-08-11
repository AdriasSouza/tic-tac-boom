/**
 * `require('...wav')` não tinha precedente no repo antes do motor de som —
 * imagens/ícones são resolvidos por fora do bundle JS (config nativa,
 * `expo-image` com URI), então nenhuma declaração de asset existia ainda.
 * O Metro transforma `require()` de um asset estático num id numérico — é
 * esse `number` (não uma string de caminho) que `expo-audio`'s `AudioSource`
 * espera para assets locais.
 */
declare module '*.wav' {
  const assetId: number;
  export default assetId;
}
