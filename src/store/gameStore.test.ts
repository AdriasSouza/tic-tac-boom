import { beforeEach, describe, expect, it } from 'vitest';

import { ENERGY_CAP, useGameStore } from '@/store/gameStore';

/**
 * Testes de integração direto na store — sem React, só `getState()`/
 * `setState()`/chamando as actions. `gameStore.ts` só importa `zustand` +
 * `@/engine/*` (nenhum React Native/Haptics/Firebase), então roda limpo sob
 * Node puro.
 */
beforeEach(() => {
  useGameStore.getState().startMatch(1);
});

describe('energia — regen simétrico ao longo de vários turnos', () => {
  it('os dois lados ganham +1 a cada turno, respeitando o teto de ENERGY_CAP', () => {
    // Estado inicial forçado: player gastou tudo, machine já está no teto.
    useGameStore.setState({ playerEnergy: 0, machineEnergy: ENERGY_CAP });

    // Turno 1: PLAYER coloca peça em 0. Regen roda pros DOIS lados.
    useGameStore.getState().placeMark('PLAYER', 0);
    expect(useGameStore.getState().playerEnergy).toBe(1); // 0 + 1
    expect(useGameStore.getState().machineEnergy).toBe(ENERGY_CAP); // já no teto, não passa

    // Turno 2: MACHINE coloca peça em 1.
    useGameStore.getState().placeMark('MACHINE', 1);
    expect(useGameStore.getState().playerEnergy).toBe(2); // 1 + 1
    expect(useGameStore.getState().machineEnergy).toBe(ENERGY_CAP);

    // Turno 3: PLAYER coloca peça em 2.
    useGameStore.getState().placeMark('PLAYER', 2);
    expect(useGameStore.getState().playerEnergy).toBe(3); // 2 + 1, agora no teto
    expect(useGameStore.getState().machineEnergy).toBe(ENERGY_CAP);

    // Turno 4: MACHINE coloca peça em 3 — player já no teto, não deveria passar.
    useGameStore.getState().placeMark('MACHINE', 3);
    expect(useGameStore.getState().playerEnergy).toBe(ENERGY_CAP);
  });
});

describe('validação de custo — aborta sem nenhum efeito colateral', () => {
  it('energia insuficiente devolve false e não muda NADA no estado', () => {
    useGameStore.setState({
      playerEnergy: 1,
      playerHand: [{ uid: 'x', cardId: 'DIRECT_DAMAGE' }], // custo 3
    });

    const before = useGameStore.getState();
    const played = useGameStore.getState().playCard('x');
    const after = useGameStore.getState();

    expect(played).toBe(false);
    // Referência idêntica: `resolveCardPlay` só cria estado novo via `set()`,
    // então se abortou ANTES de qualquer `set()`, o objeto de estado nem
    // trocou — a prova mais forte possível de "nenhum efeito colateral".
    expect(after).toBe(before);
  });
});

describe('turno errado — não dá pra jogar pelo outro lado', () => {
  it('placeMark com o combatente que não é o dono da vez devolve false e não muda nada', () => {
    // startMatch deixa turn: 'PLAYER'. Tentar posicionar como MACHINE aqui é
    // exatamente o bug relatado: um toque durante a vez do oponente colocando
    // peça como se fosse ele.
    expect(useGameStore.getState().turn).toBe('PLAYER');

    const before = useGameStore.getState();
    const played = useGameStore.getState().placeMark('MACHINE', 0);
    const after = useGameStore.getState();

    expect(played).toBe(false);
    // Mesma prova de "nenhum efeito colateral" do teste de custo: a guarda
    // (`canPlaceAt`) precisa recusar ANTES de qualquer `set()`.
    expect(after).toBe(before);
    expect(after.board[0]).toBeNull();
  });

  it('jogar carta pelo combatente que não é o dono da vez devolve false e não muda nada', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      machineHand: [{ uid: 'm', cardId: 'HEAL_SELF' }],
      machineEnergy: 3,
    });

    const before = useGameStore.getState();
    // É a vez do PLAYER — jogar uma carta da MACHINE agora é o mesmo bug,
    // só que do lado das cartas. `resolveCardPlay` já checa `state.turn !==
    // caster`, então isto documenta uma garantia que já existe, não corrige
    // nada novo (ver auditoria da Tarefa B).
    const played = useGameStore.getState().playMachineCard('m');
    const after = useGameStore.getState();

    expect(played).toBe(false);
    expect(after).toBe(before);
  });
});

describe('TURNO_EXTRA — segunda colocação sem refil de energia', () => {
  it('a energia da segunda colocação é a de depois da primeira, sem regen no meio', () => {
    useGameStore.setState({
      machineHand: [{ uid: 't', cardId: 'TURNO_EXTRA' }],
      machineEnergy: 3,
      turn: 'MACHINE',
    });

    const played = useGameStore.getState().playMachineCard('t');
    expect(played).toBe(true);
    // Offline, jogada da MACHINE é sempre anunciada (`announcesCardPlay`) —
    // o efeito só aplica de fato depois do "Entendi".
    useGameStore.getState().acknowledgePending();
    // TURNO_EXTRA custa 3⚡ e não consumesTurn — energia cai pro custo, mão
    // some a carta, e `extraTurnPending` marca a MACHINE.
    expect(useGameStore.getState().machineEnergy).toBe(0);
    expect(useGameStore.getState().extraTurnPending).toBe('MACHINE');
    expect(useGameStore.getState().turn).toBe('MACHINE');

    // Primeira colocação (ainda a mesma vez, `extraTurnPending` consumido aqui).
    useGameStore.getState().placeMark('MACHINE', 0);
    const afterFirst = useGameStore.getState();
    expect(afterFirst.turn).toBe('MACHINE'); // continua com a MACHINE — turno extra
    expect(afterFirst.extraTurnPending).toBeNull(); // consumido
    expect(afterFirst.machineEnergy).toBe(0); // SEM regen — é a mesma jogada de TURNO_EXTRA

    // Segunda colocação: agora sim passa a vez de verdade, e O REGEN NORMAL
    // (fim de turno de fato) volta a valer — inclusive pro lado que esperou.
    useGameStore.getState().placeMark('MACHINE', 3);
    const afterSecond = useGameStore.getState();
    expect(afterSecond.turn).toBe('PLAYER');
    expect(afterSecond.machineEnergy).toBe(1); // 0 + 1, regen normal desta vez
    expect(afterSecond.playerEnergy).toBe(ENERGY_CAP); // já estava no teto, +1 não passa
  });
});
