import { describe, expect, it } from 'vitest';

import { getCard } from '@/engine/cards/registry';
import { formatAcknowledgement, formatCardsReceivedNotice, formatLogEntry, formatNotice } from './logMessages';
import type { PendingAcknowledgement } from '@/engine/rules';

const PERSPECTIVE = { localCombatant: 'PLAYER', remoteCombatant: 'MACHINE', isOnline: false } as const;
const ONLINE_PERSPECTIVE = { ...PERSPECTIVE, isOnline: true } as const;

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

describe('formatAcknowledgement — conteúdo revelado só pra quem é o subject, no online', () => {
  it('PRESSÁGIO (CARD_SCRY_DECK): dono vê as cartas, texto completo', () => {
    const ack: PendingAcknowledgement = {
      id: 1,
      code: 'CARD_SCRY_DECK',
      kind: 'INTEL_FLIP',
      subject: 'PLAYER',
      revealedCards: ['DIRECT_DAMAGE', 'HAND_RAID', 'SCRY_DECK'],
    };

    const text = formatAcknowledgement(ack, ONLINE_PERSPECTIVE);

    expect(text.title).toBe('PRÓXIMAS CARTAS DO BARALHO');
    expect(text.description).toContain('fila compartilhada');
  });

  it('PRESSÁGIO (CARD_SCRY_DECK): adversário NÃO vê as cartas nem o texto que promete sigilo', () => {
    const ack: PendingAcknowledgement = {
      id: 2,
      code: 'CARD_SCRY_DECK',
      kind: 'INTEL_FLIP',
      subject: 'MACHINE',
      revealedCards: ['DIRECT_DAMAGE', 'HAND_RAID', 'SCRY_DECK'],
    };

    const text = formatAcknowledgement(ack, ONLINE_PERSPECTIVE);

    expect(text.title).not.toBe('PRÓXIMAS CARTAS DO BARALHO');
    expect(text.description).not.toContain('ninguém mais viu isto');
  });

  it('PRESSÁGIO: fora do online (CPU/Clássico) sempre mostra completo, mesmo com subject remoto', () => {
    const ack: PendingAcknowledgement = {
      id: 3,
      code: 'CARD_SCRY_DECK',
      kind: 'INTEL_FLIP',
      subject: 'MACHINE',
      revealedCards: ['DIRECT_DAMAGE'],
    };

    const text = formatAcknowledgement(ack, PERSPECTIVE); // isOnline: false

    expect(text.title).toBe('PRÓXIMAS CARTAS DO BARALHO');
  });

  it('SAQUE (HAND_REVEALED/INFO): quem roubou vê qual carta era', () => {
    const ack: PendingAcknowledgement = {
      id: 4,
      code: 'HAND_REVEALED',
      kind: 'INFO',
      subject: 'PLAYER',
      target: 'MACHINE',
      cardId: 'DIRECT_DAMAGE',
      revealedCards: [],
    };

    const text = formatAcknowledgement(ack, ONLINE_PERSPECTIVE);

    expect(text.title).not.toBe('UMA CARTA SUA FOI ROUBADA');
  });

  it('SAQUE (HAND_REVEALED/INFO): quem foi roubado NÃO vê qual carta era', () => {
    const ack: PendingAcknowledgement = {
      id: 5,
      code: 'HAND_REVEALED',
      kind: 'INFO',
      subject: 'MACHINE',
      target: 'PLAYER',
      cardId: 'DIRECT_DAMAGE',
      revealedCards: [],
    };

    const text = formatAcknowledgement(ack, ONLINE_PERSPECTIVE);

    expect(text.title).toBe('UMA CARTA SUA FOI ROUBADA');
  });

  it('VISÃO ABSOLUTA (HAND_REVEALED/INTEL_FLIP): alvo não vê a grade nem contagem detalhada', () => {
    const ack: PendingAcknowledgement = {
      id: 6,
      code: 'HAND_REVEALED',
      kind: 'INTEL_FLIP',
      subject: 'MACHINE',
      target: 'PLAYER',
      revealedCards: ['DIRECT_DAMAGE', 'HAND_RAID'],
    };

    const text = formatAcknowledgement(ack, ONLINE_PERSPECTIVE);

    expect(text.title).toBe('SUA MÃO FOI REVELADA');
    expect(text.description).not.toContain('Toque para virar');
  });
});

describe('formatCardsReceivedNotice — aviso "VOCÊ RECEBEU: ..." (lastCardsDrawnFor)', () => {
  it('dono nomeia a(s) carta(s)', () => {
    const text = formatCardsReceivedNotice('PLAYER', ['DIRECT_DAMAGE', 'HAND_RAID'], PERSPECTIVE);
    expect(text).toContain('VOCÊ RECEBEU');
    expect(text).toContain(getCard('DIRECT_DAMAGE').name);
    expect(text).toContain(getCard('HAND_RAID').name);
  });

  it('o outro lado só vê a contagem, nunca o nome — online', () => {
    const text = formatCardsReceivedNotice('MACHINE', ['DIRECT_DAMAGE'], ONLINE_PERSPECTIVE);
    expect(text).not.toContain(getCard('DIRECT_DAMAGE').name);
    expect(text).toContain('O RIVAL');
    expect(text).toContain('1 CARTA');
  });

  it('o outro lado só vê a contagem, nunca o nome — CPU', () => {
    const text = formatCardsReceivedNotice('MACHINE', ['DIRECT_DAMAGE'], PERSPECTIVE);
    expect(text).not.toContain(getCard('DIRECT_DAMAGE').name);
    expect(text).toContain('A CPU');
    expect(text).toContain('1 CARTA');
  });
});

describe('CARD_DRAFT_PICK — privacidade da escolha de PROCRASTINAR', () => {
  it('formatLogEntry: dono vê o nome da carta escolhida', () => {
    const line = formatLogEntry(
      { code: 'CARD_DRAFT_PICK', subject: 'PLAYER', value: 'DIRECT_DAMAGE' },
      PERSPECTIVE,
    );
    expect(line).toContain(getCard('DIRECT_DAMAGE').name);
  });

  it('formatLogEntry: o outro lado NÃO vê o nome, só que 1 carta foi escolhida', () => {
    const line = formatLogEntry(
      { code: 'CARD_DRAFT_PICK', subject: 'MACHINE', value: 'DIRECT_DAMAGE' },
      PERSPECTIVE,
    );
    expect(line).not.toContain(getCard('DIRECT_DAMAGE').name);
    expect(line).toContain('1 carta');
  });

  it('formatNotice: dono vê o nome, o outro lado só a contagem', () => {
    const mine = formatNotice({ code: 'CARD_DRAFT_PICK', subject: 'PLAYER', value: 'DIRECT_DAMAGE' }, PERSPECTIVE);
    expect(mine).toContain(getCard('DIRECT_DAMAGE').name);

    const theirs = formatNotice(
      { code: 'CARD_DRAFT_PICK', subject: 'MACHINE', value: 'DIRECT_DAMAGE' },
      PERSPECTIVE,
    );
    expect(theirs).not.toContain(getCard('DIRECT_DAMAGE').name);
    expect(theirs).toContain('1 CARTA');
  });
});
