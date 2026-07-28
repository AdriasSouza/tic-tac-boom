import type { CardId } from '@/engine/cards/definitions';
import type { ChaosRule, Combatant } from '@/engine/rules';

/* -------------------------------------------------------------------------- */
/*                                   EVENTOS                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fatos observáveis da partida.
 *
 * O barramento existe para as armadilhas: uma carta `TRAP` fica virada na mesa
 * e reage a algo que o **oponente** fez. Sem eventos, cada gatilho teria de ser
 * enxertado à mão dentro de `placeMark`, `drawCard`, etc. — e cada carta nova
 * exigiria mexer no núcleo do jogo.
 *
 * Todo evento descreve algo que **já aconteceu**. Nunca uma intenção: o estado
 * no momento da entrega já reflete o fato.
 */
export type GameEvent =
  | { type: 'PIECE_PLACED'; player: Combatant; index: number }
  | { type: 'PIECE_VANISHED'; player: Combatant; index: number }
  | { type: 'CARD_DRAWN'; player: Combatant }
  | { type: 'CARD_PLAYED'; player: Combatant; cardId: CardId }
  | { type: 'TRAP_ARMED'; player: Combatant; cardId: CardId }
  | { type: 'DAMAGE_TAKEN'; target: Combatant; amount: number }
  | { type: 'RULE_CHANGED'; rule: ChaosRule };

export type GameEventType = GameEvent['type'];

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                   */
/* -------------------------------------------------------------------------- */

/**
 * Quem **causou** o evento.
 *
 * É o que define de quem são as armadilhas candidatas: elas só reagem a ações
 * do adversário. `null` significa "não foi ninguém" — dano e mudança de regra
 * caótica são consequências, não ações — e nesses casos nenhuma armadilha é
 * consultada.
 *
 * Sem essa distinção, uma armadilha que dispara com `DAMAGE_TAKEN` reagiria ao
 * próprio dano que ela acabou de causar, criando laço.
 */
export function eventActor(event: GameEvent): Combatant | null {
  switch (event.type) {
    case 'PIECE_PLACED':
    case 'PIECE_VANISHED':
    case 'CARD_DRAWN':
    case 'CARD_PLAYED':
    case 'TRAP_ARMED':
      return event.player;

    case 'DAMAGE_TAKEN':
    case 'RULE_CHANGED':
      return null;
  }
}

/** Índice da casa central. Gatilho clássico de armadilha. */
export const CENTER_INDEX = 4;
