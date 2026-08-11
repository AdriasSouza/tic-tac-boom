import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CardDefinition, CardId } from '@/engine/cards/definitions';
import * as registry from '@/engine/cards/registry';
import { CENTER_INDEX } from '@/engine/events';
import { getChannel } from '@/engine/rng';
import { createEmptyBoard, type PendingInteraction } from '@/engine/rules';
import {
  CHAOS_ROULETTE_COLUMN_STOP_MS,
  ENERGY_CAP,
  selectHighlightedOldest,
  useGameStore,
} from '@/store/gameStore';

/**
 * Testes de integração direto na store — sem React, só `getState()`/
 * `setState()`/chamando as actions. `gameStore.ts` só importa `zustand` +
 * `@/engine/*` (nenhum React Native/Haptics/Firebase), então roda limpo sob
 * Node puro.
 */
/** Capturado ANTES de qualquer `vi.spyOn` — mesmo padrão de `pendingInteraction.test.ts` (Fase 3). */
const realGetCard = registry.getCard;

/** Fixtures sintéticas de mecanismo (Fase 5) — injetadas só via `vi.spyOn(registry, 'getCard')`. */
function installFixtureTraps(defs: Partial<Record<CardId, CardDefinition>>): void {
  vi.spyOn(registry, 'getCard').mockImplementation((id: CardId) => defs[id] ?? realGetCard(id));
}

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
  // Fase 5: alguns testes de exclusividade de `dispatchEvent` usam
  // `vi.spyOn(registry, 'getCard')` com fixtures sintéticas (mesmo padrão da
  // Fase 3) — restaura entre testes pra um mock não vazar pro próximo caso.
  vi.restoreAllMocks();
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

describe('TROCAR (SINGLE_CARD_TRADE) x RICOCHETE — fora do escopo de RICOCHETE (patch pós-Fase 7a, decisão do usuário)', () => {
  it('RICOCHETE armada não intercepta TROCAR — a carta abre a interação normalmente, RICOCHETE continua armada', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [
        { uid: 't', cardId: 'SINGLE_CARD_TRADE' },
        { uid: 'o', cardId: 'HEAL_SELF' },
      ],
      playerHand: [{ uid: 'p1', cardId: 'DIRECT_DAMAGE' }],
      playerTraps: [{ uid: 'r', cardId: 'REFLECT_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('t')).toBe(true);
    // Jogada de MACHINE é sempre anunciada — o efeito só aplica depois do "Entendi".
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    // RICOCHETE nem foi consultada — `targetsOpponentResource` não cobre
    // mais TROCAR — continua armada intacta.
    expect(state.playerTraps).toEqual([{ uid: 'r', cardId: 'REFLECT_TRAP' }]);
    // TROCAR resolveu normalmente: passo 1 (escolher carta própria) abriu.
    expect(state.pendingInteraction?.kind).toBe('PICK_ONE_FROM_HAND');
  });
});

/* -------------------------------------------------------------------------- */
/*                    FASE 5 — AUDITORIA DO SISTEMA DE ARMADILHAS             */
/* -------------------------------------------------------------------------- */

describe('MINA (BOMB_TRAP) — suíte e2e completa (Fase 5: única trap sem cobertura via store até aqui)', () => {
  it('arma e detona: dano + turno extra aplicados de verdade via dispatchEvent', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      machineTraps: [{ uid: 'mina', cardId: 'BOMB_TRAP' }],
    });

    expect(useGameStore.getState().placeMark('PLAYER', CENTER_INDEX)).toBe(true);

    // O disparo pausa atrás de um TRAP_TRIGGERED — dano/patch só aplicam
    // depois da confirmação, mesmo padrão de qualquer trap reativa.
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    expect(state.playerHp).toBe(4); // 5 - 1 (dano rebaixado de 2 para 1, patch pós-Fase 7a)
    expect(state.extraTurnPending).toBe('MACHINE');
    expect(state.machineTraps).toEqual([]); // consumida
  });

  it('imune a ANTIMAGIA armada de verdade — arma sem ser vetada (Lendária)', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'mina', cardId: 'BOMB_TRAP' }],
      playerTraps: [{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('mina')).toBe(true);

    const state = useGameStore.getState();
    expect(state.machineTraps).toEqual([{ uid: 'mina', cardId: 'BOMB_TRAP' }]); // chegou à mesa
    expect(state.playerTraps).toEqual([{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }]); // nunca disparou
  });

  it('imune a RICOCHETE armada de verdade — arma sem veto nem inversão (sem targetsOpponentResource, além da raridade)', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'mina', cardId: 'BOMB_TRAP' }],
      playerTraps: [{ uid: 'r', cardId: 'REFLECT_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('mina')).toBe(true);

    const state = useGameStore.getState();
    expect(state.machineTraps).toEqual([{ uid: 'mina', cardId: 'BOMB_TRAP' }]);
    expect(state.playerTraps).toEqual([{ uid: 'r', cardId: 'REFLECT_TRAP' }]);
  });

  it('detona mesmo com o ATACANTE tendo ANTIMAGIA/RICOCHETE armadas — as traps dele nunca são avaliadas (o evento não tem ele como defensor)', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      machineTraps: [{ uid: 'mina', cardId: 'BOMB_TRAP' }],
      // As armadilhas de quem vai PISAR na mina só reagem a
      // CARD_ABOUT_TO_RESOLVE (via resolveCounterTraps), nunca a
      // PIECE_PLACED (via dispatchEvent) — um jogador nunca é "defensor" do
      // próprio movimento de tabuleiro. Caso mais contraintuitivo da lista:
      // não "corrigir" isto como bug se reaparecer numa auditoria futura.
      playerTraps: [
        { uid: 'a', cardId: 'ANTI_SPELL_TRAP' },
        { uid: 'r', cardId: 'REFLECT_TRAP' },
      ],
    });

    useGameStore.getState().placeMark('PLAYER', CENTER_INDEX);
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    expect(state.playerHp).toBe(4); // a mina detonou normalmente (1 de dano, patch pós-Fase 7a)
    expect(state.playerTraps).toEqual([
      { uid: 'a', cardId: 'ANTI_SPELL_TRAP' },
      { uid: 'r', cardId: 'REFLECT_TRAP' },
    ]); // nenhuma delas foi sequer avaliada
  });
});

describe('dispatchEvent — exclusividade FIFO para traps reativas (Fase 5, mesma regra de resolveCounterTraps)', () => {
  const FIXTURE_REACTIVE_OLD = 'FIXTURE_REACTIVE_OLD' as CardId;
  const FIXTURE_REACTIVE_NEW = 'FIXTURE_REACTIVE_NEW' as CardId;

  // Os `LogCode`s reaproveitados aqui (`TRAP_SHIELD`/`TRAP_ANTI_SPELL`) não têm
  // relação nenhuma com PROTEÇÃO/ANTIMAGIA reais — servem só de marcador pra
  // provar QUAL das duas fixtures disparou, mesmo espírito das fixtures da Fase 3.
  const fixtureOldDef: CardDefinition = {
    id: FIXTURE_REACTIVE_OLD,
    name: 'Fixture Reactive Old',
    type: 'TRAP',
    description: 'fixture de mecanismo — reage a PIECE_PLACED',
    targeting: 'NONE',
    rarity: 'COMMON',
    weight: 1,
    cost: 0,
    triggerCondition: (event) => event.type === 'PIECE_PLACED',
    effect: ({ caster }) => ({ log: { code: 'TRAP_SHIELD', subject: caster } }),
  };
  const fixtureNewDef: CardDefinition = {
    ...fixtureOldDef,
    id: FIXTURE_REACTIVE_NEW,
    name: 'Fixture Reactive New',
    effect: ({ caster }) => ({ log: { code: 'TRAP_ANTI_SPELL', subject: caster } }),
  };

  it('duas traps reagindo ao MESMO evento do MESMO defensor: só a mais antiga dispara', () => {
    installFixtureTraps({ [FIXTURE_REACTIVE_OLD]: fixtureOldDef, [FIXTURE_REACTIVE_NEW]: fixtureNewDef });
    useGameStore.setState({
      turn: 'PLAYER',
      machineTraps: [
        { uid: 'old', cardId: FIXTURE_REACTIVE_OLD },
        { uid: 'new', cardId: FIXTURE_REACTIVE_NEW },
      ],
    });

    useGameStore.getState().placeMark('PLAYER', 0);
    // O `log` do resultado só aplica depois da confirmação (TRAP_TRIGGERED
    // pausa o jogo) — a remoção do array, essa sim, já é síncrona.
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    expect(state.terminalLog.at(-1)).toMatchObject({ code: 'TRAP_SHIELD' }); // só a mais antiga
    expect(state.machineTraps).toEqual([{ uid: 'new', cardId: FIXTURE_REACTIVE_NEW }]); // a nova sobrou, nem avaliada
  });

  it('cada lado defende o PRÓPRIO evento — o break de um lado nunca alcança as traps do outro', () => {
    installFixtureTraps({ [FIXTURE_REACTIVE_OLD]: fixtureOldDef, [FIXTURE_REACTIVE_NEW]: fixtureNewDef });
    useGameStore.setState({
      turn: 'PLAYER',
      playerTraps: [{ uid: 'p', cardId: FIXTURE_REACTIVE_OLD }],
      machineTraps: [{ uid: 'm', cardId: FIXTURE_REACTIVE_NEW }],
    });

    // PLAYER coloca peça — MACHINE é o defensor deste evento; a trap de
    // PLAYER nem entra no array `armed` considerado.
    useGameStore.getState().placeMark('PLAYER', 0);
    let state = useGameStore.getState();
    expect(state.machineTraps).toEqual([]); // disparou (remoção do array é síncrona)
    expect(state.playerTraps).toEqual([{ uid: 'p', cardId: FIXTURE_REACTIVE_OLD }]); // intacta
    // A confirmação do 1º disparo (TRAP_TRIGGERED) precisa ser resolvida —
    // senão `pendingAcknowledgement` bloqueia o `placeMark` seguinte.
    useGameStore.getState().acknowledgePending();

    // MACHINE coloca peça — agora PLAYER é o defensor, e a trap dele dispara.
    expect(useGameStore.getState().placeMark('MACHINE', 1)).toBe(true);
    state = useGameStore.getState();
    expect(state.playerTraps).toEqual([]);
  });
});

describe('FULL_INTEL ganha readsOrRemovesFromHand (Fase 5) — categoria bate, raridade vence', () => {
  it('PROTEÇÃO não veta FULL_INTEL apesar da categoria bater agora — isImmuneToTraps barra antes', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'fi', cardId: 'FULL_INTEL' }],
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      playerTraps: [{ uid: 'sh', cardId: 'SHIELD_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('fi')).toBe(true);
    // Jogada de MACHINE é sempre anunciada — o efeito (remoção da mão
    // incluída) só aplica depois do "Entendi".
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    expect(state.playerTraps).toEqual([{ uid: 'sh', cardId: 'SHIELD_TRAP' }]); // nunca disparou
    expect(state.machineHand).toEqual([]); // a carta resolveu normalmente
    // Fase 6: confirma que o campo novo (`fullIntelRevealFor`) é setado neste
    // MESMO caminho — este é o par que importa (não ANTIMAGIA): com
    // `readsOrRemovesFromHand` batendo a categoria de PROTEÇÃO antes de
    // `isImmuneToTraps` decidir o veto, uma inversão de ordem nesse
    // `triggerCondition` apareceria bem aqui (o campo ficaria `null` mesmo a
    // carta "passando"), o que o par com ANTIMAGIA nunca pegaria.
    expect(state.fullIntelRevealFor).toBe('MACHINE');
  });
});

describe('PROTEÇÃO (SHIELD_TRAP) x ANTIMAGIA — FIFO nos dois sentidos (Fase 5)', () => {
  it('PROTEÇÃO armada primeiro: dispara e cancela — ANTIMAGIA continua armada', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 's', cardId: 'SABOTAGE' }],
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      playerTraps: [
        { uid: 'sh', cardId: 'SHIELD_TRAP' },
        { uid: 'a', cardId: 'ANTI_SPELL_TRAP' },
      ],
    });

    expect(useGameStore.getState().playMachineCard('s')).toBe(true);

    const state = useGameStore.getState();
    expect(state.playerTraps).toEqual([{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }]);
    expect(state.pendingInteraction).toBeNull(); // SABOTAGEM nunca chegou a abrir a escolha
    expect(state.playerHand).toEqual([{ uid: 'p1', cardId: 'HEAL_SELF' }]); // intacta
    expect(state.machineHand).toEqual([]); // a carta jogada foi consumida mesmo vetada
  });

  it('ANTIMAGIA armada primeiro: dispara ela — PROTEÇÃO continua armada', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 's', cardId: 'SABOTAGE' }],
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      playerTraps: [
        { uid: 'a', cardId: 'ANTI_SPELL_TRAP' },
        { uid: 'sh', cardId: 'SHIELD_TRAP' },
      ],
    });

    expect(useGameStore.getState().playMachineCard('s')).toBe(true);

    const state = useGameStore.getState();
    expect(state.playerTraps).toEqual([{ uid: 'sh', cardId: 'SHIELD_TRAP' }]);
    expect(state.pendingInteraction).toBeNull();
    expect(state.playerHand).toEqual([{ uid: 'p1', cardId: 'HEAL_SELF' }]);
    expect(state.machineHand).toEqual([]);
  });
});

describe('PROTEÇÃO (SHIELD_TRAP) x RICOCHETE — FIFO nos dois sentidos (Fase 5)', () => {
  it('PROTEÇÃO armada primeiro: dispara e cancela — sem roubo, RICOCHETE continua armada', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'saque', cardId: 'HAND_RAID' }],
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      playerTraps: [
        { uid: 'sh', cardId: 'SHIELD_TRAP' },
        { uid: 'r', cardId: 'REFLECT_TRAP' },
      ],
    });

    expect(useGameStore.getState().playMachineCard('saque')).toBe(true);

    const state = useGameStore.getState();
    expect(state.playerTraps).toEqual([{ uid: 'r', cardId: 'REFLECT_TRAP' }]);
    expect(state.pendingInteraction).toBeNull();
    expect(state.playerHand).toEqual([{ uid: 'p1', cardId: 'HEAL_SELF' }]); // ninguém roubou nada
    expect(state.machineHand).toEqual([]);
  });

  it('RICOCHETE armada primeiro: dispara E inverte — rouba do próprio atacante; PROTEÇÃO continua armada', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'saque', cardId: 'HAND_RAID' }], // único item na mão
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      playerTraps: [
        { uid: 'r', cardId: 'REFLECT_TRAP' },
        { uid: 'sh', cardId: 'SHIELD_TRAP' },
      ],
    });

    expect(useGameStore.getState().playMachineCard('saque')).toBe(true);

    const state = useGameStore.getState();
    expect(state.playerTraps).toEqual([{ uid: 'sh', cardId: 'SHIELD_TRAP' }]);
    // RICOCHETE inverte ANTES da remoção padrão da própria carta jogada
    // acontecer — `stealRandomFromAttacker` vê a mão do atacante como ela
    // está NAQUELE instante, então a única carta lá (a própria SAQUE) é o
    // que a inversão rouba. Resultado correto, só peculiar — documentado
    // aqui, não bug.
    expect(state.machineHand).toEqual([]);
    expect(state.playerHand).toEqual([
      { uid: 'p1', cardId: 'HEAL_SELF' },
      { uid: 'saque', cardId: 'HAND_RAID' },
    ]);
  });
});

describe('RICOCHETE não intercepta AMALDIÇOAR nem ANOMALIA (patch pós-Fase 7a: fora do escopo, mexem em peças não em HP/energia/mão)', () => {
  it('AMALDIÇOAR resolve normal — forcedVanish é setado, RICOCHETE continua armada', () => {
    const board = createEmptyBoard();
    // canPlay exige >=3 peças do oponente (patch pós-Fase 7a) — antes bastava 1.
    board[4] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };
    board[0] = { owner: 'PLAYER', mark: 'X', turnPlaced: 2 };
    board[1] = { owner: 'PLAYER', mark: 'X', turnPlaced: 3 };
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      board,
      machineHand: [{ uid: 'o', cardId: 'OBSOLESCENCE' }],
      playerTraps: [{ uid: 'r', cardId: 'REFLECT_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('o', 4)).toBe(true);
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    expect(state.forcedVanish).toEqual({ owner: 'PLAYER', mode: 'CHOSEN', index: 4, turnPlaced: 1 });
    expect(state.playerTraps).toEqual([{ uid: 'r', cardId: 'REFLECT_TRAP' }]); // RICOCHETE nem foi consultada
    expect(state.machineHand).toEqual([]);
  });

  it('ANOMALIA resolve normal — forcedVanish é setado, RICOCHETE continua armada', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'q', cardId: 'QUEUE_SHUFFLE' }],
      playerTraps: [{ uid: 'r', cardId: 'REFLECT_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('q')).toBe(true);
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    expect(state.forcedVanish).toEqual({ owner: 'PLAYER', mode: 'RANDOM' });
    expect(state.playerTraps).toEqual([{ uid: 'r', cardId: 'REFLECT_TRAP' }]);
    expect(state.machineHand).toEqual([]);
  });
});

describe('Imunidade Lendária/Boom via store — ALTAR DE SACRIFÍCIO e VISÃO ABSOLUTA vs ANTIMAGIA (Fase 5)', () => {
  it('ALTAR_OF_SACRIFICE (Boom): ANTIMAGIA não veta — o Altar abre normalmente', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [
        { uid: 'altar', cardId: 'ALTAR_OF_SACRIFICE' },
        { uid: 'f1', cardId: 'HEAL_SELF' },
        { uid: 'f2', cardId: 'DIRECT_DAMAGE' },
      ],
      playerTraps: [{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('altar')).toBe(true);
    useGameStore.getState().acknowledgePending(); // jogada de MACHINE é sempre anunciada

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toMatchObject({ kind: 'SACRIFICE_DRAG', caster: 'MACHINE' });
    expect(state.playerTraps).toEqual([{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }]); // nunca disparou
  });

  it('FULL_INTEL (Lendária): ANTIMAGIA não veta — a revelação acontece normalmente', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHand: [{ uid: 'fi', cardId: 'FULL_INTEL' }],
      playerHand: [{ uid: 'p1', cardId: 'HEAL_SELF' }],
      playerTraps: [{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }],
    });

    expect(useGameStore.getState().playMachineCard('fi')).toBe(true);
    useGameStore.getState().acknowledgePending();

    const state = useGameStore.getState();
    expect(state.playerTraps).toEqual([{ uid: 'a', cardId: 'ANTI_SPELL_TRAP' }]);
    expect(state.machineHand).toEqual([]); // a carta foi jogada e resolveu
  });
});

describe('TRAP_LIMIT — a 4ª armadilha é recusada (Fase 5)', () => {
  it('playMachineCard recusa armar além do limite, sem efeito colateral', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineTraps: [
        { uid: 't1', cardId: 'SHIELD_TRAP' },
        { uid: 't2', cardId: 'SHIELD_TRAP' },
        { uid: 't3', cardId: 'SHIELD_TRAP' },
      ],
      machineHand: [{ uid: 't4', cardId: 'ANTI_SPELL_TRAP' }],
    });

    const before = useGameStore.getState();
    const played = useGameStore.getState().playMachineCard('t4');
    const after = useGameStore.getState();

    expect(played).toBe(false);
    expect(after).toBe(before); // zero efeito colateral
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
    // Tabuleiro: MACHINE tem 3 peças, incluindo o alvo da carta em 8 (canPlay
    // exige >=3 peças do oponente, patch pós-Fase 7a — antes bastava 1);
    // PLAYER já tem 2 em linha (0 e 1), faltando 1 jogada para fechar. 4/5
    // não fecham nenhuma linha pra MACHINE (nem com 8: [3,4,5] falta 3,
    // [0,4,8] falta 0 que é do PLAYER).
    const openingBoard = createEmptyBoard();
    openingBoard[0] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };
    openingBoard[1] = { owner: 'PLAYER', mark: 'X', turnPlaced: 2 };
    openingBoard[8] = { owner: 'MACHINE', mark: 'O', turnPlaced: 3 };
    openingBoard[4] = { owner: 'MACHINE', mark: 'O', turnPlaced: 4 };
    openingBoard[5] = { owner: 'MACHINE', mark: 'O', turnPlaced: 5 };

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
    expect(afterOverflow.lastVanishedIndex?.index).toBe(3);
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

describe('VISÃO ABSOLUTA (FULL_INTEL) — revelação automática com prazo, ponta a ponta', () => {
  it('joga e revela: fullIntelRevealFor marca o caster (offline, PLAYER não é anunciado)', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'fi', cardId: 'FULL_INTEL' }],
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
    });

    expect(useGameStore.getState().playCard('fi')).toBe(true);

    expect(useGameStore.getState().fullIntelRevealFor).toBe('PLAYER');
  });

  it('expira ao endTurn do caster', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerEnergy: 3,
      playerHand: [{ uid: 'fi', cardId: 'FULL_INTEL' }],
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
    });

    useGameStore.getState().playCard('fi');
    expect(useGameStore.getState().fullIntelRevealFor).toBe('PLAYER');
    // FULL_INTEL sempre devolve `acknowledge` pro humano que jogou (pra ELE
    // ler a mão revelada), mesmo offline sem anúncio de "carta jogada" —
    // precisa ser resolvido antes de qualquer ação nova (`endTurn` recusa
    // com `pendingAcknowledgement` pendente).
    useGameStore.getState().acknowledgePending();

    expect(useGameStore.getState().endTurn('PLAYER')).toBe(true);
    expect(useGameStore.getState().fullIntelRevealFor).toBeNull();
  });

  it('vitória de rodada limpa fullIntelRevealFor pelo PRÓPRIO ramo de vitória do placeMark — isolado de startNextRound (nunca chamado aqui)', () => {
    // Diferente dos outros 3 caminhos: aqui a limpeza roda DENTRO do mesmo
    // `placeMark` que fecha a rodada (HP zerando, transição, patches
    // concorrentes) — um caminho de execução DIFERENTE do ramo normal, não
    // "a mesma linha inferida por semelhança". `vi.useFakeTimers()` segura o
    // `setTimeout` real de `scheduleRoundTransition`, e `startNextRound`
    // nunca é chamado neste teste — se `fullIntelRevealFor` sair `null`
    // aqui, foi o ramo de vitória que limpou, não outro caminho mascarando.
    const board = createEmptyBoard();
    board[0] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };
    board[1] = { owner: 'PLAYER', mark: 'X', turnPlaced: 2 };
    useGameStore.setState({
      turn: 'PLAYER',
      board,
      playerEnergy: 3,
      playerHand: [{ uid: 'fi', cardId: 'FULL_INTEL' }],
      machineHand: [{ uid: 'm1', cardId: 'HEAL_SELF' }],
    });

    useGameStore.getState().playCard('fi');
    useGameStore.getState().acknowledgePending();
    expect(useGameStore.getState().fullIntelRevealFor).toBe('PLAYER');

    // FULL_INTEL não consome o turno (`consumesTurn` ausente) — ainda é a
    // vez de PLAYER pra fechar a linha 0-1-2 na sequência seguinte.
    vi.useFakeTimers();
    const won = useGameStore.getState().placeMark('PLAYER', 2);

    expect(won).toBe(true);
    const state = useGameStore.getState();
    expect(state.status).toBe('ROUND_OVER');
    expect(state.roundWinner).toBe('PLAYER');
    expect(state.fullIntelRevealFor).toBeNull();
  });

  it('expira via startNextRound se a rodada terminar antes do turno acabar', () => {
    useGameStore.setState({
      fullIntelRevealFor: 'PLAYER',
      status: 'ROUND_OVER',
      roundWinner: 'PLAYER',
    });

    useGameStore.getState().startNextRound();

    expect(useGameStore.getState().fullIntelRevealFor).toBeNull();
  });

  it('sobrevive à 2ª colocação de TURNO_EXTRA — é o MESMO turno do caster ainda', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      extraTurnPending: 'PLAYER',
      fullIntelRevealFor: 'PLAYER',
    });

    // 1ª colocação: keepsTurn consome extraTurnPending, mas o turno continua com PLAYER.
    useGameStore.getState().placeMark('PLAYER', 0);
    expect(useGameStore.getState().turn).toBe('PLAYER');
    expect(useGameStore.getState().fullIntelRevealFor).toBe('PLAYER');

    // 2ª colocação: agora sim passa a vez de verdade — a revelação expira junto.
    useGameStore.getState().placeMark('PLAYER', 1);
    expect(useGameStore.getState().turn).toBe('MACHINE');
    expect(useGameStore.getState().fullIntelRevealFor).toBeNull();
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
    // canPlay de VIDENTE exige >=3 peças do oponente (patch pós-Fase 7a) —
    // as duas extras são mais NOVAS (turnPlaced maior), então 4 continua
    // sendo a mais antiga e o resto do teste vale sem mudança.
    board[4] = { owner: 'MACHINE', mark: 'O', turnPlaced: 1 };
    board[0] = { owner: 'MACHINE', mark: 'O', turnPlaced: 2 };
    board[1] = { owner: 'MACHINE', mark: 'O', turnPlaced: 3 };

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

describe('TIC TAC BOOM! (CHAOS_ROULETTE) — fechamento duplo ponta a ponta (Fase 6a)', () => {
  it('reshuffle fecha linha para os dois símbolos ao mesmo tempo — findWinner escolhe pela ordem de WIN_LINES', () => {
    // Identidade — sem embaralhar de verdade — mesmo controle usado em
    // registry.effects.test.ts, agora mockando o canal real da store.
    vi.spyOn(getChannel('CARDS'), 'shuffle').mockImplementation((items) => [...items]);

    const board = createEmptyBoard();
    board[6] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };
    board[7] = { owner: 'PLAYER', mark: 'X', turnPlaced: 2 };
    board[8] = { owner: 'PLAYER', mark: 'X', turnPlaced: 3 };
    board[0] = { owner: 'MACHINE', mark: 'O', turnPlaced: 4 };
    board[1] = { owner: 'MACHINE', mark: 'O', turnPlaced: 5 };
    board[2] = { owner: 'MACHINE', mark: 'O', turnPlaced: 6 };

    useGameStore.setState({
      turn: 'PLAYER',
      board,
      playerHand: [{ uid: 'ttb', cardId: 'CHAOS_ROULETTE' }],
    });

    // ROUND_OVER agenda `scheduleRoundTransition` (setTimeout real) — segura
    // com fake timers, mesmo padrão dos testes de `forcedVanish`.
    vi.useFakeTimers();
    expect(useGameStore.getState().playCard('ttb')).toBe(true);

    const state = useGameStore.getState();
    expect(state.status).toBe('ROUND_OVER');
    // Com a identidade, X (3 peças) cai em [0,1,2] e O (3 peças) em [3,4,5]
    // — as duas linhas fecham juntas. findWinner pega a PRIMEIRA de
    // WIN_LINES, o desempate oficial (docs/NOTAS_TECNICAS.md).
    expect(state.roundWinner).toBe('PLAYER');
    expect(state.winningLine).toEqual([0, 1, 2]);

    // Regressão direta do efeito visual (Fase 8): o giro precisa disparar
    // mesmo neste caso — se `lastChaosRoulette` fosse montado DEPOIS do
    // `return` do ramo de vitória (como `triggersChaosGlitch`), nunca
    // rodaria aqui.
    expect(state.lastChaosRoulette).not.toBeNull();
    expect(state.chaosRouletteSpinning).toBe(true);
  });
});

describe('TIC TAC BOOM! (CHAOS_ROULETTE) — evento de giro (efeito visual, Fase 8)', () => {
  it('popula lastChaosRoulette com o caster e um id novo, e trava chaosRouletteSpinning até o último stop do cronograma', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerHand: [{ uid: 'ttb', cardId: 'CHAOS_ROULETTE' }],
    });

    // `applyCardEffectResult` agenda `scheduleChaosRouletteUnlock` (setTimeout
    // real) — segura com fake timers, mesmo padrão dos testes de `forcedVanish`
    // e do "fechamento duplo" acima.
    vi.useFakeTimers();
    expect(useGameStore.getState().playCard('ttb')).toBe(true);

    expect(useGameStore.getState().lastChaosRoulette).toEqual({ caster: 'PLAYER', id: 0 });
    expect(useGameStore.getState().chaosRouletteSpinning).toBe(true);

    vi.advanceTimersByTime(CHAOS_ROULETTE_COLUMN_STOP_MS[2] - 1);
    expect(useGameStore.getState().chaosRouletteSpinning).toBe(true); // ainda não

    vi.advanceTimersByTime(1);
    expect(useGameStore.getState().chaosRouletteSpinning).toBe(false);
  });

  it('incrementa o id numa segunda jogada, mesmo sem passar a vez entre elas (CHAOS_ROULETTE não consome turno)', () => {
    useGameStore.setState({
      turn: 'PLAYER',
      playerHand: [
        { uid: 'a', cardId: 'CHAOS_ROULETTE' },
        { uid: 'b', cardId: 'CHAOS_ROULETTE' },
      ],
    });

    vi.useFakeTimers();
    expect(useGameStore.getState().playCard('a')).toBe(true);
    expect(useGameStore.getState().lastChaosRoulette?.id).toBe(0);
    // Mesmo caster continua com a vez: CHAOS_ROULETTE não define `consumesTurn`.
    expect(useGameStore.getState().turn).toBe('PLAYER');

    expect(useGameStore.getState().playCard('b')).toBe(true);
    expect(useGameStore.getState().lastChaosRoulette?.id).toBe(1);
  });
});

describe('TIC TAC BOOM! (CHAOS_ROULETTE) — MACHINE joga, PLAYER vence (bug relatado, patch pós-Fase 7a)', () => {
  it('a MACHINE joga a carta, o reshuffle fecha linha do PLAYER, e o dano cai no perdedor certo (MACHINE) mesmo sem ser quem jogou', () => {
    // Cenário exato do bug relatado: "a CPU jogou TIC TAC BOOM!, eu ganhei,
    // mas o efeito do dano não foi aplicado". Nenhum teste existente cobria
    // `caster: 'MACHINE'` — todos os de cima usam `playCard`/`caster:
    // 'PLAYER'`. `playMachineCard` sempre anuncia (`announcesCardPlay`
    // retorna `true` incondicionalmente pra `caster === 'MACHINE'`), então o
    // efeito só aplica de verdade depois de `acknowledgePending()` — é esse
    // segundo passo que o teste também teria pulado por engano se o bug
    // fosse real.
    vi.spyOn(getChannel('CARDS'), 'shuffle').mockImplementation((items) => [...items]);

    const board = createEmptyBoard();
    board[6] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };
    board[7] = { owner: 'PLAYER', mark: 'X', turnPlaced: 2 };
    board[8] = { owner: 'PLAYER', mark: 'X', turnPlaced: 3 };
    board[3] = { owner: 'MACHINE', mark: 'O', turnPlaced: 4 };
    board[4] = { owner: 'MACHINE', mark: 'O', turnPlaced: 5 };

    useGameStore.setState({
      turn: 'MACHINE',
      board,
      machineHand: [{ uid: 'ttb', cardId: 'CHAOS_ROULETTE' }],
      playerHp: 5,
      machineHp: 5,
    });

    vi.useFakeTimers();

    expect(useGameStore.getState().playMachineCard('ttb')).toBe(true);
    // Efeito ainda NÃO aplicou — só o anúncio foi enfileirado.
    expect(useGameStore.getState().pendingAcknowledgement).toMatchObject({
      code: 'CARD_PLAYED',
      subject: 'MACHINE',
    });
    expect(useGameStore.getState().board).toEqual(board);
    expect(useGameStore.getState().status).toBe('PLAYING');

    useGameStore.getState().acknowledgePending();

    // Com a identidade (sem embaralhar de verdade), X (3 peças, índices
    // 6/7/8) cai nas 3 primeiras posições do sorteio ([0,1,2]) e fecha a
    // linha do PLAYER; O (2 peças) cai em [3,4] — não fecha nada.
    const state = useGameStore.getState();
    expect(state.status).toBe('ROUND_OVER');
    expect(state.roundWinner).toBe('PLAYER');
    expect(state.winningLine).toEqual([0, 1, 2]);
    // O perdedor (MACHINE) sofre o dano, mesmo tendo sido ela a lançar a
    // carta — `applyCardEffectResult` não faz distinção de caster aqui.
    expect(state.machineHp).toBe(4);
    expect(state.playerHp).toBe(5);
    expect(state.lastChaosRoulette).toMatchObject({ caster: 'MACHINE' });
  });
});

describe('resumeMatch — retomada de partida local/CPU após remount/relançamento (rotação)', () => {
  it('sanitiza campos que dependiam de maquinário da sessão anterior, independente do que o snapshot trouxer', () => {
    const board = createEmptyBoard();
    board[0] = { owner: 'PLAYER', mark: 'X', turnPlaced: 1 };

    const snapshot = {
      ...useGameStore.getState(),
      board,
      turnCount: 7,
      status: 'PLAYING' as const,
      pendingInteraction: null,
      chaosRouletteSpinning: true,
      isPaused: true,
      pendingAcknowledgement: {
        code: 'CARD_PLAYED' as const,
        kind: 'INFO' as const,
        subject: 'MACHINE' as const,
        revealedCards: [],
        id: 3,
      },
      lastDamageEvent: { target: 'PLAYER' as const, amount: 1, id: 1 },
      lastExtraTurn: { target: 'PLAYER' as const, id: 1 },
      lastChaosRoulette: { caster: 'PLAYER' as const, id: 1 },
      lastNotice: {
        code: 'CARD_ALTAR_INVOKED' as const,
        subject: 'PLAYER' as const,
        value: 'STUDY' as const,
        tone: 'NEUTRAL' as const,
        id: 1,
      },
      lastVanishedIndex: { index: 4, owner: 'PLAYER' as const, id: 1 },
      lastShieldAbsorbed: { target: 'PLAYER' as const, id: 1 },
      lastTimeCapsuleSave: { target: 'PLAYER' as const, id: 1 },
      lastEnergyDrain: { target: 'PLAYER' as const, amount: 2, id: 1 },
      lastParadoxMirror: { subject: 'PLAYER' as const, id: 1 },
    };

    useGameStore.getState().resumeMatch(snapshot);

    const state = useGameStore.getState();
    // Dados puros: restaurados tal como estavam.
    expect(state.board).toEqual(board);
    expect(state.turnCount).toBe(7);
    // Maquinário desta sessão que morreu junto com o processo anterior:
    // forçado a um estado seguro, nunca rehidratado como se ainda existisse.
    expect(state.chaosRouletteSpinning).toBe(false);
    expect(state.isPaused).toBe(false);
    expect(state.pendingAcknowledgement).toBeNull();
    expect(state.lastDamageEvent).toBeNull();
    expect(state.lastExtraTurn).toBeNull();
    expect(state.lastChaosRoulette).toBeNull();
    expect(state.lastNotice).toBeNull();
    expect(state.lastVanishedIndex).toBeNull();
    expect(state.lastShieldAbsorbed).toBeNull();
    expect(state.lastTimeCapsuleSave).toBeNull();
    expect(state.lastEnergyDrain).toBeNull();
    expect(state.lastParadoxMirror).toBeNull();
  });

  it('reembolsa uma interação pendente em vez de tentar retomá-la', () => {
    const pending: PendingInteraction = {
      kind: 'BOARD_TARGET',
      caster: 'PLAYER',
      cardId: 'LOCK_CELL',
      cardUid: 'lock#1',
      handIndex: 1,
      priorSelections: [],
    };

    const snapshot = {
      ...useGameStore.getState(),
      // 'lock#1' já foi retirada da mão quando a interação abriu — mesmo
      // estado que um `BOARD_TARGET` de verdade deixaria no meio do caminho.
      playerHand: [{ uid: 'a', cardId: 'STUDY' as CardId }, { uid: 'b', cardId: 'STUDY' as CardId }],
      playerEnergy: 1,
      pendingInteraction: pending,
    };

    useGameStore.getState().resumeMatch(snapshot);

    const state = useGameStore.getState();
    expect(state.pendingInteraction).toBeNull();
    // Devolvida no handIndex ORIGINAL (1), não no fim da mão.
    expect(state.playerHand[1]).toEqual({ uid: 'lock#1', cardId: 'LOCK_CELL' });
    expect(state.playerEnergy).toBe(1 + registry.getCard('LOCK_CELL').cost);
  });

  it('rearma a transição de rodada quando o snapshot está em ROUND_OVER (o timer original morreu com a sessão anterior)', () => {
    const snapshot = {
      ...useGameStore.getState(),
      status: 'ROUND_OVER' as const,
      roundWinner: 'PLAYER' as const,
      winningLine: [0, 1, 2] as [number, number, number],
    };

    vi.useFakeTimers();
    useGameStore.getState().resumeMatch(snapshot);
    expect(useGameStore.getState().status).toBe('ROUND_OVER');

    // Não precisa do valor exato de `ROUND_TRANSITION_DELAY_MS` (privado ao
    // módulo) — só confirmar que ALGUM timer foi rearmado e eventualmente
    // dispara, em vez do tabuleiro ficar preso na rodada que já acabou.
    vi.advanceTimersByTime(10_000);
    expect(useGameStore.getState().status).toBe('PLAYING');
  });
});

/* -------------------------------------------------------------------------- */
/*                5 CARTAS NOVAS — DEFESA (patch pós-Fase 7a)                  */
/* -------------------------------------------------------------------------- */

describe('BATERIA RESERVA / CÁPSULA DO TEMPO — takeDamage intercepta antes do clamp de HP', () => {
  it('escudo ativo absorve o dano por completo e se consome — HP não se mexe', () => {
    useGameStore.setState({ playerHp: 5, playerShield: true, nextShieldAbsorbedId: 7 });
    useGameStore.getState().takeDamage('PLAYER', 3);

    const state = useGameStore.getState();
    expect(state.playerHp).toBe(5);
    expect(state.playerShield).toBe(false);
    // Efêmero com `id` monotônico — alimenta o pulso de absorção no HUD.
    expect(state.lastShieldAbsorbed).toEqual({ target: 'PLAYER', id: 7 });
    expect(state.nextShieldAbsorbedId).toBe(8);
  });

  it('um 2º dano, sem escudo, reduz o HP normalmente', () => {
    useGameStore.setState({ playerHp: 5, playerShield: true });
    useGameStore.getState().takeDamage('PLAYER', 3); // absorvido
    useGameStore.getState().takeDamage('PLAYER', 2); // desta vez reduz

    expect(useGameStore.getState().playerHp).toBe(3);
  });

  it('CÁPSULA DO TEMPO armada: o golpe que zeraria o HP sobrevive em 1, compra 2 cartas e consome a armadilha', () => {
    useGameStore.setState({
      playerHp: 1,
      playerTraps: [{ uid: 'cap', cardId: 'TIME_CAPSULE' }],
      playerHand: [],
      nextTimeCapsuleSaveId: 4,
    });
    useGameStore.getState().takeDamage('PLAYER', 5);

    const state = useGameStore.getState();
    expect(state.playerHp).toBe(1);
    expect(state.status).toBe('PLAYING'); // NÃO acabou a partida
    expect(state.playerTraps).toEqual([]); // consumida
    expect(state.playerHand).toHaveLength(2); // comprou 2
    // Efêmero PRÓPRIO, além do flash de dano — alimenta `<TimeCapsuleBanner />`.
    expect(state.lastTimeCapsuleSave).toEqual({ target: 'PLAYER', id: 4 });
    expect(state.nextTimeCapsuleSaveId).toBe(5);
  });

  it('sem CÁPSULA DO TEMPO armada, o golpe letal continua encerrando a partida normalmente', () => {
    useGameStore.setState({ playerHp: 1, playerTraps: [] });
    useGameStore.getState().takeDamage('PLAYER', 5);

    const state = useGameStore.getState();
    expect(state.playerHp).toBe(0);
    expect(state.status).toBe('MATCH_OVER');
    expect(state.matchWinner).toBe('MACHINE');
  });

  it('escudo tem prioridade sobre a Cápsula: golpe letal absorvido não chega a interceptar nada — a armadilha continua armada', () => {
    useGameStore.setState({
      playerHp: 1,
      playerShield: true,
      playerTraps: [{ uid: 'cap', cardId: 'TIME_CAPSULE' }],
    });
    useGameStore.getState().takeDamage('PLAYER', 5);

    const state = useGameStore.getState();
    expect(state.playerHp).toBe(1);
    expect(state.playerShield).toBe(false); // escudo consumido
    expect(state.playerTraps).toEqual([{ uid: 'cap', cardId: 'TIME_CAPSULE' }]); // Cápsula intacta
  });

  it('drainEnergy: clampa em 0, nunca fica negativa, e registra o efêmero com a quantidade REAL drenada', () => {
    useGameStore.setState({ machineEnergy: 1, nextEnergyDrainId: 2 });
    useGameStore.getState().drainEnergy('MACHINE', 5); // pede 5, só existe 1
    const state = useGameStore.getState();
    expect(state.machineEnergy).toBe(0);
    // `amount` é o que foi REALMENTE drenado (1), não o pedido (5) — o burst
    // no HUD (`<EnergyPip />`) precisa saber quantos pips de fato esvaziaram.
    expect(state.lastEnergyDrain).toEqual({ target: 'MACHINE', amount: 1, id: 2 });
    expect(state.nextEnergyDrainId).toBe(3);
  });

  it('drainEnergy: amount<=0 não faz nada, nem seta o efêmero', () => {
    useGameStore.setState({ machineEnergy: 0, nextEnergyDrainId: 9 });
    useGameStore.getState().drainEnergy('MACHINE', 3); // não há o que drenar
    const state = useGameStore.getState();
    expect(state.lastEnergyDrain).toBeNull();
    expect(state.nextEnergyDrainId).toBe(9);
  });
});

describe('PARADOXO (PARADOX) — e2e pela store: MACHINE joga carta de custo 3⚡, o PARADOXO do PLAYER copia', () => {
  it('MACHINE joga CURA (custo 3): a cura de MACHINE aplica no 1º "Entendi", a cópia do PARADOXO cura o PLAYER só no 2º', () => {
    useGameStore.setState({
      turn: 'MACHINE',
      machineEnergy: 3,
      machineHp: 3,
      playerHp: 3,
      machineHand: [{ uid: 'heal', cardId: 'HEAL_SELF' }],
      playerTraps: [{ uid: 'px', cardId: 'PARADOX' }],
    });

    expect(useGameStore.getState().playMachineCard('heal')).toBe(true);

    // 1º "Entendi": revela a jogada de MACHINE e aplica o efeito ORIGINAL —
    // CURA cura quem jogou. O PARADOXO já disparou (a cópia é síncrona, via
    // dispatchEvent, dentro do MESMO apply), mas fica atrás de um 2º
    // TRAP_TRIGGERED — a armadilha já some da mesa aqui.
    useGameStore.getState().acknowledgePending();
    let state = useGameStore.getState();
    expect(state.machineHp).toBe(4); // curou de verdade
    expect(state.playerHp).toBe(3); // cópia ainda não aplicou
    expect(state.playerTraps).toEqual([]); // consumida
    expect(state.lastParadoxMirror).toBeNull(); // eco ainda não disparou

    // 2º "Entendi": aplica a cópia do PARADOXO — o dono dela também cura.
    useGameStore.getState().acknowledgePending();
    state = useGameStore.getState();
    expect(state.playerHp).toBe(4);
    // Efêmero com `id` monotônico — alimenta `<ParadoxEchoOverlay />`. Só
    // dispara PARA o dono da armadilha (`subject`), nunca pra quem jogou a
    // carta original.
    expect(state.lastParadoxMirror).toMatchObject({ subject: 'PLAYER' });
  });
});

describe('DESLIZAR (SLIDE_PIECE) — e2e pela store com targetIndex JÁ pronto (bug relatado: CPU travava em loop)', () => {
  it('completa o deslize quando quem joga já chega com targetIndex (caminho da CPU, nunca abre BOARD_TARGET)', () => {
    const board = createEmptyBoard();
    board[4] = { owner: 'MACHINE', mark: 'O', turnPlaced: 7 };

    useGameStore.setState({
      turn: 'MACHINE',
      board,
      machineEnergy: 1,
      machineHand: [{ uid: 'slide', cardId: 'SLIDE_PIECE' }],
    });

    // Mesmo caminho que `playCPUTurn`/`chooseCpuCardPlay` usam de verdade:
    // `targetIndex` (a origem) já vai junto na 1ª chamada — a CPU nunca
    // passa pelo fluxo de mira (`BOARD_TARGET`) de um humano tocando a carta.
    expect(useGameStore.getState().playMachineCard('slide', 4)).toBe(true);

    // Anúncio da jogada ("A CPU JOGOU DESLIZAR") — só depois disso a
    // interação do 2º passo (PICK_BOARD_CELL) abre de verdade.
    useGameStore.getState().acknowledgePending();
    const pending = useGameStore.getState().pendingInteraction;
    expect(pending?.kind).toBe('PICK_BOARD_CELL');

    const resolved = useGameStore
      .getState()
      .resolveInteraction('MACHINE', { kind: 'PICK_BOARD_CELL', index: 1 });
    expect(resolved).toBe(true);

    const state = useGameStore.getState();
    // Antes da correção: `effect()` do 2º passo lia `priorSelections[0]`
    // (sempre `[]` neste caminho), devolvia `null`, e a carta era
    // REEMBOLSADA em vez de mover a peça — a CPU tentava de novo e travava
    // em loop tentando a mesma jogada impossível.
    expect(state.board[4]).toBeNull();
    expect(state.board[1]).toEqual({ owner: 'MACHINE', mark: 'O', turnPlaced: 7 });
    expect(state.machineHand).toEqual([]); // consumida de verdade, não reembolsada
    expect(state.pendingInteraction).toBeNull();
  });
});
