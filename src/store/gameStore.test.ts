import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyBoard } from '@/engine/rules';
import { ENERGY_CAP, selectHighlightedOldest, useGameStore } from '@/store/gameStore';

/**
 * Testes de integração direto na store — sem React, só `getState()`/
 * `setState()`/chamando as actions. `gameStore.ts` só importa `zustand` +
 * `@/engine/*` (nenhum React Native/Haptics/Firebase), então roda limpo sob
 * Node puro.
 */
beforeEach(() => {
  useGameStore.getState().startMatch(1);
});

afterEach(() => {
  // Rede de segurança para os testes que fecham rodada: `placeMark` agenda um
  // `setTimeout` real (`scheduleRoundTransition`) mesmo quando o teste avança
  // a rodada manualmente. Sem isto o timer despertaria ~1.3s depois, no meio
  // de um teste seguinte, chamando `startNextRound()` num estado que não é
  // mais o dele.
  vi.useRealTimers();
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

describe('ANTIMAGIA — cobre também o ARMAR de outra armadilha, de ponta a ponta', () => {
  it('anula o armar de SHIELD_TRAP: a armadilha nova nunca chega à mesa, mas a carta é consumida', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 's', cardId: 'SHIELD_TRAP' }],
      playerTraps: [{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }],
    });

    const played = useGameStore.getState().playMachineCard('s');
    expect(played).toBe(true);

    const state = useGameStore.getState();
    // ANTIMAGIA do PLAYER disparou e se consumiu.
    expect(state.playerTraps).toEqual([]);
    // SHIELD_TRAP nunca chegou a ficar virada na mesa da MACHINE.
    expect(state.machineTraps).toEqual([]);
    // Mas a carta saiu da mão e a energia foi gasta — foi jogada, só anulada.
    expect(state.machineHand).toEqual([]);
    expect(state.machineEnergy).toBe(2); // 3 - custo 1 do SHIELD_TRAP
  });
});

describe('RICOCHETE — inverte dano de ponta a ponta (resolveCounterTraps processa damage/heal)', () => {
  it('DIRECT_DAMAGE refletido atinge quem jogou, não quem armou o RICOCHETE', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'd', cardId: 'DIRECT_DAMAGE' }],
      playerTraps: [{ uid: 'r', cardId: 'REFLECT_TRAP' }],
    });

    const played = useGameStore.getState().playMachineCard('d');
    expect(played).toBe(true);

    const state = useGameStore.getState();
    // O dano voltou pra MACHINE (quem jogou DIRECT_DAMAGE), não pro PLAYER.
    expect(state.machineHp).toBe(4); // 5 - 1
    expect(state.playerHp).toBe(5); // intocado
    // RICOCHETE do PLAYER se consumiu; a carta da MACHINE foi gasta sem efeito próprio.
    expect(state.playerTraps).toEqual([]);
    expect(state.machineHand).toEqual([]);
  });
});

describe('TROCAR (SINGLE_CARD_TRADE) x RICOCHETE — RICOCHETE cai no fallback (Fase 4, Achado 2)', () => {
  it('RICOCHETE armada primeiro: dispara e SÓ ANULA (sem inverter) — TROCAR nunca abre pendingInteraction, ANTIMAGIA continua armada', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [
        { uid: 't', cardId: 'SINGLE_CARD_TRADE' },
        { uid: 'o', cardId: 'HEAL_SELF' },
      ],
      playerHand: [{ uid: 'p1', cardId: 'DIRECT_DAMAGE' }],
      // FIFO: RICOCHETE é a mais antiga (índice 0) — dispara primeiro.
      playerTraps: [
        { uid: 'r', cardId: 'REFLECT_TRAP' },
        { uid: 'a', cardId: 'ANTI_SPELL_TRAP' },
      ],
    });

    expect(useGameStore.getState().playMachineCard('t')).toBe(true);

    const state = useGameStore.getState();
    // RICOCHETE disparou e se consumiu; ANTIMAGIA nunca chegou a ser consultada.
    expect(state.playerTraps).toEqual([{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }]);
    // TROCAR foi vetada antes do passo 1 — nenhuma interação chegou a abrir.
    expect(state.pendingInteraction).toBeNull();
    // Sem inversão (Achado 2, sem entrada em RICOCHET_INVERSIONS): as mãos
    // não trocaram nada — só a própria TROCAR foi consumida.
    expect(state.machineHand).toEqual([{ uid: 'o', cardId: 'HEAL_SELF' }]);
    expect(state.playerHand).toEqual([{ uid: 'p1', cardId: 'DIRECT_DAMAGE' }]);
  });

  it('ANTIMAGIA armada primeiro: dispara ela — RICOCHETE continua armada intacta para o próximo gatilho', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [
        { uid: 't', cardId: 'SINGLE_CARD_TRADE' },
        { uid: 'o', cardId: 'HEAL_SELF' },
      ],
      playerHand: [{ uid: 'p1', cardId: 'DIRECT_DAMAGE' }],
      // FIFO: ANTIMAGIA é a mais antiga desta vez — dispara primeiro.
      playerTraps: [
        { uid: 'a', cardId: 'ANTI_SPELL_TRAP' },
        { uid: 'r', cardId: 'REFLECT_TRAP' },
      ],
    });

    expect(useGameStore.getState().playMachineCard('t')).toBe(true);

    const state = useGameStore.getState();
    expect(state.playerTraps).toEqual([{ uid: 'r', cardId: 'REFLECT_TRAP' }]);
    expect(state.pendingInteraction).toBeNull();
    expect(state.machineHand).toEqual([{ uid: 'o', cardId: 'HEAL_SELF' }]);
    expect(state.playerHand).toEqual([{ uid: 'p1', cardId: 'DIRECT_DAMAGE' }]);
  });
});

describe('forcedVanish não atravessa troca de rodada (bug encontrado limpando código morto na Fase 2)', () => {
  it('startNextRound limpa forcedVanish, igual ao antigo doomedCell', () => {
    useGameStore.setState({
      forcedVanish: { owner: 'MACHINE', mode: 'RANDOM' },
      status: 'ROUND_OVER',
      roundWinner: 'PLAYER',
    });

    useGameStore.getState().startNextRound();

    expect(useGameStore.getState().forcedVanish).toBeNull();
  });

  it('OBSOLESCÊNCIA marca uma peça, a rodada fecha (linha completada) e a marcação não sobrevive para a fila da rodada nova', () => {
    // Tabuleiro: MACHINE tem 1 peça em 8 (alvo da carta); PLAYER já tem 2 em
    // linha (0 e 1), faltando 1 jogada para fechar.
    const openingBoard = createEmptyBoard();
    openingBoard[0] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };
    openingBoard[1] = { owner: 'PLAYER', mark: 'X', turnPlaced: 2 };
    openingBoard[8] = { owner: 'MACHINE', mark: 'O', turnPlaced: 3 };

    useGameStore.setState({
      board: openingBoard,
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'o', cardId: 'OBSOLESCENCE' }],
    });

    // 1. PLAYER joga OBSOLESCÊNCIA na peça da MACHINE em 8 — não consome o
    // turno (`consumesTurn` ausente), então `turn` continua com o PLAYER.
    const played = useGameStore.getState().playCard('o', 8);
    expect(played).toBe(true);
    expect(useGameStore.getState().forcedVanish).toEqual({
      owner: 'MACHINE',
      mode: 'CHOSEN',
      index: 8,
      turnPlaced: 3,
    });

    // 2. PLAYER fecha a linha 0-1-2. `scheduleRoundTransition` (dentro de
    // `placeMark`) agenda um `setTimeout` real para o avanço automático —
    // fake timers seguram esse timer para o teste controlar a transição.
    vi.useFakeTimers();
    const won = useGameStore.getState().placeMark('PLAYER', 2);
    expect(won).toBe(true);
    expect(useGameStore.getState().status).toBe('ROUND_OVER');
    expect(useGameStore.getState().roundWinner).toBe('PLAYER');
    // A marca de OBSOLESCÊNCIA continua viva ao FECHAR a rodada — só o início
    // da rodada NOVA é que a invalida.
    expect(useGameStore.getState().forcedVanish).not.toBeNull();

    // 3. Avança a rodada manualmente (sem esperar o timer real).
    useGameStore.getState().startNextRound();
    expect(useGameStore.getState().forcedVanish).toBeNull();

    // 4. Rodada nova, tabuleiro limpo: MACHINE enche as 3 peças do "infinito"
    // em 3, 4, 8 (deliberadamente não-alinhadas — nenhum trio aqui fecha
    // linha, senão a rodada terminaria antes do overflow acontecer) e uma 4ª
    // jogada em 6 tem que remover a MAIS ANTIGA (3) — não a posição 8 marcada
    // na rodada anterior, que nem existe mais neste tabuleiro novo.
    //
    // `place` neutraliza qualquer surto de caos automático do relógio global
    // (`turnCount` cruzando `CHAOS_SURGE_INTERVAL_TURNS`, alheio ao que este
    // teste verifica) depois de cada jogada — sem isto um BLOCKED_CELL
    // sorteado poderia lacrar uma das células que a sequência ainda precisa.
    const place = (who: 'PLAYER' | 'MACHINE', index: number): void => {
      useGameStore.getState().placeMark(who, index);
      useGameStore.setState({ activeRule: 'NORMAL', blockedCell: null, ruleExpiresAtTurn: null });
    };

    expect(useGameStore.getState().turn).toBe('MACHINE'); // quem perdeu a rodada começa
    place('MACHINE', 3);
    place('PLAYER', 0);
    place('MACHINE', 4);
    place('PLAYER', 1);
    place('MACHINE', 8);
    place('PLAYER', 7);

    const beforeOverflow = useGameStore.getState();
    expect(beforeOverflow.board[3]?.owner).toBe('MACHINE');
    expect(beforeOverflow.status).toBe('PLAYING'); // ninguém fechou linha até aqui

    place('MACHINE', 6);
    const afterOverflow = useGameStore.getState();
    // A peça mais antiga (índice 3) sumiu — comportamento normal do
    // "infinito", sem interferência de uma marca fantasma da rodada anterior.
    expect(afterOverflow.board[3]).toBeNull();
    expect(afterOverflow.lastVanishedIndex).toBe(3);
    expect(afterOverflow.board[6]?.owner).toBe('MACHINE');
  });
});

describe('REBOBINAR — bloqueio de colocação de ponta a ponta (playerPlacementBlocked/machinePlacementBlocked)', () => {
  it('MACHINE bloqueada joga carta comum, arma armadilha, mas não coloca peça — endTurn libera e passa a vez', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machinePlacementBlocked: true,
      machineEnergy: 3,
      machineHp: 3,
      machineHand: [{ uid: 'heal', cardId: 'HEAL_SELF' }],
    });

    // 1. Carta comum: sucesso. Offline, toda jogada da MACHINE é anunciada
    // (`announcesCardPlay`) — o efeito só aplica de fato depois do "Entendi".
    expect(useGameStore.getState().playMachineCard('heal')).toBe(true);
    useGameStore.getState().acknowledgePending();
    expect(useGameStore.getState().machineHp).toBe(4);

    // 2. Arma uma armadilha: sucesso — o armar em si já commitou no estado
    // antes do "Entendi" (só o ANÚNCIO é que pausa, não a armadilha na mesa).
    useGameStore.setState({ machineHand: [{ uid: 'shield', cardId: 'SHIELD_TRAP' }], machineEnergy: 3 });
    expect(useGameStore.getState().playMachineCard('shield')).toBe(true);
    expect(useGameStore.getState().machineTraps).toEqual([{ uid: 'shield', cardId: 'SHIELD_TRAP' }]);
    useGameStore.getState().acknowledgePending();

    // 3. Colocar peça: recusado — mesma prova de "nenhum efeito colateral"
    // já usada nos testes de turno errado.
    const before = useGameStore.getState();
    const played = useGameStore.getState().placeMark('MACHINE', 0);
    const after = useGameStore.getState();
    expect(played).toBe(false);
    expect(after).toBe(before);

    // 4. endTurn consome o PRÓPRIO bloqueio e passa a vez.
    expect(useGameStore.getState().endTurn('MACHINE')).toBe(true);
    expect(useGameStore.getState().machinePlacementBlocked).toBe(false);
    expect(useGameStore.getState().turn).toBe('PLAYER');
  });

  it('os dois lados bloqueados simultaneamente: cada flag expira só no endTurn do PRÓPRIO dono', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      playerPlacementBlocked: true,
      machinePlacementBlocked: true,
    });

    expect(useGameStore.getState().endTurn('MACHINE')).toBe(true);
    let state = useGameStore.getState();
    expect(state.machinePlacementBlocked).toBe(false); // consumido
    expect(state.playerPlacementBlocked).toBe(true); // intocado — não é o dono passando a vez agora
    expect(state.turn).toBe('PLAYER');

    expect(useGameStore.getState().endTurn('PLAYER')).toBe(true);
    state = useGameStore.getState();
    expect(state.playerPlacementBlocked).toBe(false);
    expect(state.turn).toBe('MACHINE');
  });
});

describe('startNextRound limpa playerPlacementBlocked/machinePlacementBlocked (auditoria de campos transitórios)', () => {
  it('as duas flags voltam para false', () => {
    useGameStore.setState({
      playerPlacementBlocked: true,
      machinePlacementBlocked: true,
      status: 'ROUND_OVER',
      roundWinner: 'PLAYER',
    });

    useGameStore.getState().startNextRound();

    const state = useGameStore.getState();
    expect(state.playerPlacementBlocked).toBe(false);
    expect(state.machinePlacementBlocked).toBe(false);
  });
});

describe('VIDENTE — destaque no tabuleiro (highlightedOldestFor, Fase 2.6)', () => {
  it('limpa quando o turno do próprio caster termina via placeMark normal', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 5, turnPlaced: 0 },
    });

    useGameStore.getState().placeMark('PLAYER', 0);

    expect(useGameStore.getState().highlightedOldestFor).toBeNull();
  });

  it('sobrevive à 2ª colocação de TURNO_EXTRA — é o MESMO turno do caster ainda', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      extraTurnPending: 'PLAYER',
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 5, turnPlaced: 0 },
    });

    // 1ª colocação: keepsTurn consome extraTurnPending, mas o turno continua com PLAYER.
    useGameStore.getState().placeMark('PLAYER', 0);
    expect(useGameStore.getState().turn).toBe('PLAYER');
    expect(useGameStore.getState().highlightedOldestFor).not.toBeNull();

    // 2ª colocação: agora sim passa a vez de verdade — o destaque limpa junto.
    useGameStore.getState().placeMark('PLAYER', 1);
    expect(useGameStore.getState().turn).toBe('MACHINE');
    expect(useGameStore.getState().highlightedOldestFor).toBeNull();
  });

  it('limpa via endTurn quando o caster passa a vez sem colocar peça', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 5, turnPlaced: 0 },
    });

    useGameStore.getState().endTurn('PLAYER');

    expect(useGameStore.getState().highlightedOldestFor).toBeNull();
  });

  it('startNextRound limpa o destaque', () => {
    useGameStore.setState({
      highlightedOldestFor: { caster: 'PLAYER', owner: 'MACHINE', index: 5, turnPlaced: 0 },
      status: 'ROUND_OVER',
      roundWinner: 'PLAYER',
    });

    useGameStore.getState().startNextRound();

    expect(useGameStore.getState().highlightedOldestFor).toBeNull();
  });

  it('DEMOLIR remove a peça destacada: o glow para de acender por identidade, não por limpeza de campo', () => {
    const board = createEmptyBoard();
    board[4] = { owner: 'MACHINE', mark: 'O', turnPlaced: 1 };

    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      board,
      playerHand: [
        { uid: 'v', cardId: 'HIGHLIGHT_OLDEST' },
        { uid: 'd', cardId: 'BREAK_PIECE' },
      ],
    });

    // VIDENTE destaca a peça da MACHINE em 4.
    expect(useGameStore.getState().playCard('v')).toBe(true);
    expect(useGameStore.getState().highlightedOldestFor).toEqual({
      caster: 'PLAYER',
      owner: 'MACHINE',
      index: 4,
      turnPlaced: 1,
    });
    expect(selectHighlightedOldest(useGameStore.getState())).not.toBeNull();

    // DEMOLIR remove aquela MESMA peça — ainda o turno de PLAYER, o destaque
    // não teve chance de expirar por tempo.
    expect(useGameStore.getState().playCard('d', 4)).toBe(true);
    expect(useGameStore.getState().board[4]).toBeNull();

    // O CAMPO ainda guarda o valor antigo (nada no caminho de DEMOLIR limpa
    // highlightedOldestFor) — mas o SELETOR já reporta null: a peça na
    // posição 4 não existe mais, então a identidade não bate.
    expect(useGameStore.getState().highlightedOldestFor).not.toBeNull();
    expect(selectHighlightedOldest(useGameStore.getState())).toBeNull();
  });
});
