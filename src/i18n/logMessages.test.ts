import { describe, expect, it } from 'vitest';

import { formatNotice } from './logMessages';

const PERSPECTIVE = { localCombatant: 'PLAYER', remoteCombatant: 'MACHINE', isOnline: false } as const;

describe('formatNotice — ESPIONAGEM (CARD_INTEL_REVEAL) tem toast próprio, não cai mais no fallback genérico', () => {
  it('devolve um texto dedicado, não a linha do terminal maiuscularizada', () => {
    const entry = {
      code: 'CARD_INTEL_REVEAL' as const,
      subject: 'MACHINE' as const,
      target: 'PLAYER' as const,
      value: 2,
    };

    const toast = formatNotice(entry, PERSPECTIVE);

    // O fallback genérico (`default`) produziria a linha do terminal
    // maiuscularizada, com "::" no meio — o texto dedicado não tem esse
    // separador, é uma frase curta e gritada como o resto dos toasts.
    expect(toast).not.toContain('::');
    expect(toast).toContain('2 CARTA(S)');
  });
});
