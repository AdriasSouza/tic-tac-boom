/**
 * Paleta provisória do Tic Tac Boom.
 *
 * Regra de pixel art: poucas cores, alto contraste, e sempre um par
 * `light`/`shadow` por superfície para fazer o bisel chapado (sem gradiente).
 * Quando os sprites finais chegarem, estes valores viram fallback.
 */
export const colors = {
  /* Fundo */
  bgDeep: '#0b0f14',
  bgPanel: '#1b2430',

  /* Tabuleiro */
  boardFrame: '#3d2b1f', // madeira escura da moldura
  boardFrameLight: '#6b4c35', // bisel superior/esquerdo
  boardFrameShadow: '#241812', // bisel inferior/direito
  boardGrid: '#0d1117', // traço entre células
  cellFill: '#2b3a4a',
  cellFillAlt: '#243141', // xadrez sutil, ajuda a ler o grid
  cellPressed: '#3a4d61',
  cellBlocked: '#4a2230',

  /* Peças */
  markX: '#ff5a5f',
  markXShadow: '#8f2226',
  markO: '#38bdf8',
  markOShadow: '#1a5f80',

  /* Feedback */
  winGlow: '#facc15',
  danger: '#ff2e63',
  terminalGreen: '#39ff7a',

  /* Texto */
  text: '#e8eef5',
  textDim: '#7a8b9c',
} as const;

export type AppColors = typeof colors;
