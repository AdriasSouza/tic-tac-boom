# 💥 Tic Tac Boom

Jogo da velha **infinito** com cartas de ação caóticas, em pixel art.

Cada jogador mantém no máximo **3 peças** no tabuleiro — ao colocar a quarta, a mais antiga
desaparece. Em cima disso, cartas de ação, armadilhas e regras caóticas que mudam sozinhas
sabotam o tabuleiro no meio da partida.

Não é melhor-de-uma: cada lado tem **5 vidas**. Fechar uma linha tira 1 de vida do oponente,
e a partida continua até alguém zerar.

---

## Índice

- [Mecânicas](#mecânicas)
- [Stack](#stack)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Configuração obrigatória](#configuração-obrigatória)
- [Rodando](#rodando)
- [Roteiro de teste](#roteiro-de-teste)
- [Estrutura de pastas](#estrutura-de-pastas)
- [Decisões de arquitetura](#decisões-de-arquitetura)
- [Estado atual](#estado-atual)

---

## Mecânicas

### Jogo da velha infinito
Máximo de 3 peças por jogador. A peça mais antiga (`turnPlaced` menor) some quando você
posiciona a quarta. A peça condenada **pulsa** antes de sumir — sem esse aviso o jogador acha
que o jogo bugou.

Empate por tabuleiro cheio é impossível: 3 + 3 = 6 peças em 9 células.

### Regras caóticas
O **Chaos Terminal** (monitor CRT no topo da tela) troca de regra por **turno global**, não por
tempo real: cada regra dura 2–4 jogadas de tabuleiro antes de expirar e ser resorteada. Isso é
proposital — antes o terminal rolava sozinho a cada 5–9 segundos de relógio, o que permitia ao
jogador simplesmente esperar parado até uma regra ruim passar. Agora só jogar faz o tempo do
jogo andar. O terminal mostra a contagem regressiva (`Nt`) ao lado do nome da regra.

| Regra | Efeito |
|---|---|
| `NORMAL` | Jogo da velha infinito padrão |
| `RANDOM_FADE` | A peça que some é **aleatória**, não a mais antiga — todas as suas peças pulsam |
| `BLOCKED_CELL` | Uma célula fica interditada e não aceita jogadas |

### Cartas
Mão de até 5 cartas, mesa de até 3 armadilhas. Cada lado começa a partida com 2 cartas e recebe
mais 1 a cada 3 jogadas globais completas (Player e CPU juntos). Cartas são arrastadas para a
metade superior da tela para serem jogadas.

| Carta | Tipo | Efeito |
|---|---|---|
| **DEMOLIR** (`BREAK_PIECE`) | `ACTION` | Modo mira: destrói uma peça do tabuleiro, inclusive as suas |
| **REBOBINAR** (`EXTRA_TURN`) | `ACTION` | Sua próxima jogada não passa a vez |
| **CURAR** (`HEAL_SELF`) | `ACTION` | Recupera 1 HP |
| **ATAQUE** (`DIRECT_DAMAGE`) | `ACTION` | Causa 1 de dano direto ao oponente |
| **ESTUDAR** (`DRAW_CARD`) | `ACTION` | Compra 1 carta adicional |
| **SAQUE** (`HAND_RAID`) | `ACTION` | 50% de chance de roubar uma carta aleatória do oponente; senão, destrói |
| **PURIFICAR** (`CLEANSE`) | `ACTION` | Remove uma interdição de célula, restaurando a regra normal |
| **TROCA** (`HAND_SWAP`) | `ACTION` | Troca sua mão inteira pela do oponente |
| **VIDENTE** (`REVEAL_OLDEST`) | `ACTION` | Revela qual peça do oponente vai sumir na próxima jogada dele |
| **TRAVAR** (`LOCK_CELL`) | `ACTION` | Modo mira: bloqueia uma célula vazia por 1 turno global |
| **MINA** (`BOMB_TRAP`) | `TRAP` | Vira na mesa. Detona se o oponente ocupar o centro: 2 de dano e ele perde a vez |
| **PROTEÇÃO** (`SHIELD_TRAP`) | `TRAP` | Vira na mesa. Impede que uma carta sua seja roubada pelo SAQUE do oponente |
| **ANTI-MAGIA** (`COUNTER_TRAP`) | `TRAP` | Vira na mesa. Anula a próxima carta de ação jogada pelo oponente |

---

## Stack

| Ferramenta | Papel |
|---|---|
| **Expo (SDK 57) + Expo Router** | Base e roteamento por arquivos |
| **Zustand** | Estado do jogo |
| **React Native Reanimated 4** | Animações na UI thread |
| **React Native Gesture Handler** | Arrastar cartas |
| **Expo Haptics** | Feedback tátil |
| **react-native-webview** | Chaos Terminal (ponte bidirecional nativo ⇄ web) |

---

## Requisitos

- **Node.js 20+** (testado em 24.18)
- **npm 10+**
- Um destes para rodar:
  - App **Expo Go** no celular (mais rápido para começar)
  - Emulador Android (Android Studio) ou iOS (Xcode, só macOS)

---

## Instalação

> ⚠️ **Leia antes de rodar.** Este repositório contém **apenas o código do jogo** —
> `src/` e `app/`. Não há `package.json` ainda. O `create-expo-app` precisa de um diretório
> vazio, então o código-fonte é movido para fora, o projeto é gerado, e o código volta.

### 1. Preservar o código do jogo

```powershell
New-Item -ItemType Directory -Force _keep
Move-Item src, app, README.md _keep
```

### 2. Gerar o projeto Expo

```powershell
npx create-expo-app@latest . --template default
npm run reset-project
```

> O `reset-project` é **interativo**: ele pergunta se você quer mover os arquivos de exemplo
> para `app-example/` em vez de apagar. Responda `y`.

### 3. Restaurar o código do jogo

```powershell
Move-Item _keep\src .\src
Copy-Item _keep\app\* .\app\ -Recurse -Force
Move-Item _keep\README.md .\README.md
Remove-Item _keep, app-example -Recurse -Force
```

### 4. Instalar as dependências

```powershell
# Nativas — SEMPRE via `expo install` (trava a versão compatível com o SDK)
npx expo install react-native-reanimated react-native-gesture-handler expo-haptics react-native-webview

# JS pura
npm install zustand
```

---



## Configuração obrigatória

Três ajustes. **Sem eles o app não roda** — os dois primeiros falham de forma silenciosa.

### 1. `GestureHandlerRootView` na raiz

Sem isto, arrastar cartas **não funciona no Android** e nenhum erro aparece.

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
```

### 2. Alias `@/` apontando para `src/`

O template aponta `@/*` para a raiz; todo o código importa de `src/`.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

### 3. Plugin do Reanimated **por último**

```js
// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'], // sempre o ÚLTIMO da lista
  };
};
```

> ℹ️ A tela de menu (`app/index.tsx`) já faz parte do código do jogo — o
> `reset-project` gera um `index.tsx` de exemplo que o passo 3 sobrescreve.

---

## Rodando

```powershell
npx expo start -c        # -c limpa o cache do bundler
```

Depois: `a` para Android, `i` para iOS, ou escaneie o QR code com o Expo Go.

O app abre na tela de título. Para pular direto ao jogo, abra `/game/cpu` ou
`/game/local`.

---

## Roteiro de teste

Dois modos:

- **`/game/cpu`** — a máquina joga sozinha (heurística vencer → bloquear → posicional),
  com 0,8–1,5s de "tempo de pensar".
- **`/game/local`** — hot-seat: o segundo jogador humano controla o lado `MACHINE` no mesmo
  aparelho. Use este para testar armadilhas passo a passo, já que você controla os dois lados.

### Jogo da velha infinito
1. Faça 3 jogadas com o mesmo jogador.
2. ✅ A peça mais antiga dele deve **pulsar** (opacidade oscilando).
3. Jogue a quarta peça.
4. ✅ A peça que pulsava some, a nova aparece com efeito de mola.

### HP e dano
1. Feche uma linha de 3.
2. ✅ A linha acende em amarelo, um bloco de HP do perdedor pisca branco/vermelho, treme, e o device vibra.
3. ✅ Após ~1,3s o tabuleiro limpa sozinho e quem perdeu começa a rodada seguinte — automático, sem
   depender de nenhuma tela estar de um jeito específico (a transição vive dentro do próprio
   `placeMark`, não num `useEffect` da UI).

### Chaos Terminal (ponte híbrida WebView/iframe)
1. Jogue algumas peças (a regra troca a cada 2–4 turnos globais — **não** por tempo real; ficar
   parado sem jogar não muda mais nada, de propósito).
2. ✅ O monitor no topo glitcha (separação RGB + tremida) e escreve a nova regra.
3. ✅ Ao lado do nome da regra aparece a contagem regressiva (`Nt`), decrescendo a cada jogada.
4. ✅ Se sortear `RANDOM_FADE`, **todas** as peças do jogador da vez passam a pulsar.
5. ✅ Se sortear `BLOCKED_CELL`, uma célula ganha uma barra vermelha e recusa toques.
6. Rode `npx expo start --web` e abra no navegador.
7. ✅ O mesmo terminal aparece rodando dentro de um `<iframe>` — mesmo HTML do WebView nativo,
   sem nenhuma alteração de conteúdo.

Para forçar uma regra sem esperar, no console do Metro:
```js
useGameStore.getState().applyChaosRule('BLOCKED_CELL');
```

### Cartas de ação
1. Arraste **REBOBINAR** para a metade superior da tela.
2. ✅ A carta sai com `FadeOutUp`, o leque se reorganiza.
3. Jogue uma peça.
4. ✅ O turno **não** passa — você joga de novo.
5. Arraste uma carta e solte na **metade inferior**.
6. ✅ Ela volta para a mão com efeito de mola.

### Sistema de mira
1. Jogue 2–3 peças no tabuleiro.
2. Arraste **DEMOLIR** para cima.
3. ✅ A carta volta para a mão com **brilho amarelo**, elevada 26dp.
4. ✅ Faixa "◎ ESCOLHA UM ALVO" aparece, a moldura do tabuleiro fica dourada.
5. ✅ Células ocupadas piscam; células vazias escurecem.
6. Toque numa célula ocupada.
7. ✅ A peça some, a carta sai da mão.
8. **Cancelamento:** repita até o passo 5 e toque na carta selecionada (ou na faixa).
9. ✅ Volta ao normal sem gastar a carta.

### Armadilhas (Event Bus)
1. Compre cartas até sair uma **MINA** (peso 2 no sorteio — pode levar algumas rodadas).
2. Arraste para cima.
3. ✅ Ela vai direto para a **zona de armadilhas**, virada para baixo, sem pedir alvo.
4. Passe a vez e, jogando pelo lado `MACHINE`, coloque uma peça no **centro (índice 4)**.
5. ✅ O verso da carta some com `ZoomOut`.
6. ✅ Anúncio "◆ MINA DETONOU" + vibração de aviso.
7. ✅ O HP da `MACHINE` cai **2** blocos.
8. ✅ Sua próxima jogada não passa a vez.

### IA da CPU
Abra `/game/cpu`.
1. Jogue uma peça.
2. ✅ Após 0,8–1,5s a máquina responde sozinha, e o terminal loga `> cpu :: avança em 2x2`.
3. Monte duas peças suas em linha e deixe a terceira célula livre.
4. ✅ A máquina joga exatamente nela e loga `> cpu :: bloqueia em RxC`.
5. Deixe a máquina montar duas em linha.
6. ✅ Ela fecha a linha e loga `> cpu :: fecha linha em RxC`.
7. Com a máquina já tendo 3 peças, verifique um caso em que fechar a linha exigiria sacrificar
   a peça mais antiga que faz parte dessa mesma linha.
8. ✅ Ela **não** joga ali — a simulação aplica a regra do infinito antes de decidir.
9. Jogue até a máquina acumular cartas (a cada 3 turnos globais ela recebe 1, como você).
10. ✅ Ela usa as cartas sozinha — cura quando o HP dela cai a 2, ataca quando o seu HP cai a 2,
    arma armadilhas quando tem espaço, e o log mostra a `message` de cada carta jogada por ela.

### Log de combate
1. ✅ O terminal mostra a regra ativa no topo e as linhas de log rolando abaixo.
2. Jogue uma carta.
3. ✅ A mensagem aparece (`> demolir :: célula 4`) e o log rola sozinho para o fim.
4. ✅ O cursor pisca sempre na última linha.

### Menu e onboarding
1. Abra o app.
2. ✅ Título "TIC TAC **BOOM**" flutuando, com peças X/O à deriva no fundo.
3. Toque em **COMO JOGAR**.
4. ✅ Modal com moldura pixelada e os 3 passos do onboarding.
5. ✅ Os números do tutorial (3 peças, 5 vidas) vêm das constantes de domínio —
   mudar `MAX_PIECES_PER_PLAYER` atualiza o texto sozinho.
6. Toque em **CRÉDITOS**.
7. ✅ Modal com a bio do desenvolvedor, na mesma moldura pixelada.

### Header e menu de pause
1. Dentro de uma partida, observe o cabeçalho: logo "TIC TAC **BOOM**" + botão de pause.
2. Toque no botão de pause.
3. ✅ Modal com **RETOMAR**, **REINICIAR PARTIDA** e **SAIR PARA O MENU**.
4. ✅ Com o modal aberto, toques no tabuleiro não fazem nada — `isPaused` bloqueia `canPlaceAt`.
5. No modo `/game/cpu`, pause bem no meio do "pensamento" da máquina (0,8–1,5s após sua jogada).
6. ✅ Ela não joga enquanto pausado. Toque em **RETOMAR**.
7. ✅ A CPU recomeça a decisão do zero e joga normalmente.
8. Toque em **REINICIAR PARTIDA**.
9. ✅ Nova partida, HP restaurado, log limpo — sem duplicar a mão inicial.

### Fim de partida
1. Jogue até um lado zerar as 5 vidas.
2. ✅ Overlay cobre a tela, sacode uma vez e o título pulsa.
3. ✅ Placar final com os blocos de HP dos dois lados.
4. ✅ A **seed** aparece no rodapé, junto de `startMatch(<seed>) reproduz esta partida`.
5. Toque em **JOGAR NOVAMENTE**.
6. ✅ Partida nova, HP restaurado, e o log do terminal é limpo.

### RNG determinístico
1. Anote a `SEED` exibida no fim da partida (ou no rodapé da tela de jogo).
2. No console do Metro:
   ```js
   useGameStore.getState().startMatch(123456);
   ```
3. ✅ Reinicie com a mesma seed e faça as mesmas jogadas: as regras caóticas, as cartas
   compradas e os alvos aleatórios saem **idênticos**.

---

## Estrutura de pastas

```
tic-tac-boom/
├── app/                              # ROTAS (Expo Router) — só layout e ciclo de vida
│   ├── _layout.tsx                   # GestureHandlerRootView + Stack
│   ├── index.tsx                     # Menu
│   └── game/[mode].tsx               # Tela de partida (local | cpu)
│
├── src/
│   ├── engine/                       # ⭐ TypeScript puro, ZERO React
│   │   ├── rules.ts                  # Modelo de domínio: tipos, GameState,
│   │   │                             #   constantes e funções puras
│   │   ├── rng.ts                    # Mulberry32 + canais independentes
│   │   ├── events.ts                 # Tipos do barramento + eventActor()
│   │   ├── ai/cpu.ts                 # Heurística da máquina + simulação
│   │   └── cards/
│   │       ├── definitions.ts        # Contrato das cartas (só tipos)
│   │       └── registry.ts           # As 3 cartas + sorteio ponderado
│   │
│   ├── store/gameStore.ts            # Zustand: actions + seletores
│   ├── hooks/useCpuOpponent.ts       # Gatilho do turno da máquina
│   │
│   ├── components/game/
│   │   ├── ChaosTerminal.tsx         # WebView CRT + log de combate
│   │   ├── HUD.tsx                   # HP em blocos + indicador de turno
│   │   ├── Board.tsx                 # Grid 3x3, aritmética inteira
│   │   ├── Cell.tsx                  # Célula: peça, pulso, mira, haptics
│   │   ├── TrapZone.tsx              # Armadilhas viradas para baixo
│   │   ├── CardHand.tsx              # Leque + geometria + modo mira
│   │   └── CardItem.tsx              # Carta arrastável (gesto na UI thread)
│   │
│   ├── components/ui/
│   │   ├── PixelButton.tsx           # Botão com profundidade chapada
│   │   ├── PixelPanel.tsx            # Moldura estilo nine-slice
│   │   ├── HowToPlayModal.tsx        # Onboarding em 3 passos
│   │   └── GameOverOverlay.tsx       # Fim de partida + seed
│   │
│   └── theme/colors.ts               # Paleta pixel art
```

### Direção das dependências

```
app/  ──►  components/  ──►  store/  ──►  engine/
                    └──────────────────────►
```

**Nada em `src/engine/` importa de `src/store/`.** O modelo de domínio
(`GameState`, regras, validações) vive em `engine/rules.ts`; o store é só o
recipiente reativo que o hospeda. Verificação rápida:

```powershell
Select-String -Path src\engine\*.ts, src\engine\**\*.ts -Pattern "store/gameStore"
# não deve retornar nada
```

O `gameStore` reexporta os tipos e constantes do domínio por conveniência, para
que os componentes precisem de um import só.

---

## Decisões de arquitetura

**Engine separada do React.** `src/engine/` é TypeScript puro. Efeitos de carta são funções
puras que devolvem um *patch* (`(ctx) => { patch, damage, message } | null`), nunca chamam o
store. Dá para testar 200 combinações de carta em milissegundos sem renderizar nada.

**RNG semeado, canais independentes.** `Math.random()` existe em **um único lugar**:
`generateSeed()`. Todo o resto deriva da seed. Canais separados (`RULES`, `BOARD`, `CARDS`,
`AI`, `TERMINAL`) impedem que o timing do terminal — dependente de frame rate — desloque a
sequência de sorteio das cartas e quebre o replay.

**Seletores primitivos.** Cada `<Cell />` assina 5 valores (1 objeto de referência estável + 4
booleanos). Uma jogada re-renderiza no máximo 2 células. Seletores **devem ser puros** — retorno
não-determinístico dentro do `useSyncExternalStore` causa loop infinito de render.

**Validação compartilhada UI ⇄ store.** `canPlaceAt()` e `isPendingTarget()` são as mesmas
funções usadas pelas guardas do store e pela UI para decidir o haptic. Se a regra mudar, muda
num lugar só.

**Gestos 100% na UI thread.** Os callbacks do `Gesture.Pan()` são worklets — nenhum frame do
arrasto passa pela thread JS. `runOnJS` aparece só em momentos discretos (pegar, soltar,
aplicar efeito).

**Duas camadas de `Animated.View` no `CardItem`.** Layout animations (`entering`/`exiting`) e
`useAnimatedStyle` disputam a prop `transform` se ficarem na mesma view. A externa recebe as
layout animations, a interna recebe o transform do gesto.

**Event Bus com fila, não recursão.** `dispatchEvent` enfileira e drena com uma flag
`isDraining`. Se o efeito de uma armadilha publicar outro evento, ele entra no fim da fila em
vez de recursar — dois gatilhos que se disparam mutuamente viram sequência finita.

**Pixel art sem borrão.** Aritmética inteira no grid (`Math.floor`, nunca `33.333%`), sombras
como barras chapadas de 2–3px (nunca `elevation`/`shadowRadius`, que borram a aresta), peças
desenhadas com `View` (`borderRadius: 0`).

---

## Estado atual

### ✅ Implementado
- Jogo da velha infinito com fila de 3 peças
- Sistema de HP (5 vidas), rodadas e fim de partida, com **transição automática de rodada** —
  vive dentro do próprio `placeMark`, não depende de nenhum `useEffect` de tela
- 3 regras caóticas com **duração por turno global** (2–4 jogadas, não tempo real) + Chaos
  Terminal híbrido: `<WebView>` nativo e `<iframe>` na web, mesmo HTML sem alteração
- Distribuição automática de cartas: 2 na mão inicial de cada lado, +1/+1 a cada 3 jogadas globais
- RNG determinístico por seed, com canais independentes e snapshot/restore
- HUD com animação de dano (flash + shake + haptics)
- **13 cartas**: 10 de ação, 1 armadilha ofensiva (MINA) e 2 armadilhas de defesa (PROTEÇÃO,
  ANTI-MAGIA) que vetam a carta do oponente antes do efeito resolver
- Mão arrastável em leque, com layout animations
- Sistema de mira com destaque de alvos válidos e cancelamento
- Event Bus para armadilhas reativas (MINA), reentrante por fila; veto síncrono para as
  armadilhas de defesa (não podem esperar a fila, têm que agir antes do patch)
- **IA da CPU** — heurística vencer → bloquear → posicional para o tabuleiro, e uma heurística
  de prioridade fixa para usar as cartas que compra (cura, ataque, armar armadilha, etc.)
- **Header + menu de pause** (retomar / reiniciar / sair), com `isPaused` bloqueando o
  tabuleiro e interrompendo o "pensamento" da CPU de verdade
- **Log de combate** no ChaosTerminal, com auto-scroll e replay após reload
- **Tela de título** com animação, onboarding e créditos em modal, componentes de UI retrô
- **Tela de fim de partida** com placar, reinício e exibição da seed
- **Engine desacoplada** — `src/engine/` não importa nada de `src/store/`

### ⛔ Ainda não existe
- **Sprites de pixel art** — peças, cartas e UI são desenhadas com `View`
- **Fonte pixelada** — usando monospace do sistema
- **Áudio** — nenhum som ou trilha
- **Testes automatizados** — a engine é pura e testável, mas nenhum teste foi escrito
- **Persistência** — nada é salvo entre sessões

### 🐛 Limitações conhecidas
- **Armadilha com mira não é suportada.** O desvio das `TRAP` acontece antes da checagem de
  `requiresTarget`, então uma armadilha que precise escolher célula ao ser armada não guarda o
  alvo. Nenhuma das 3 traps atuais precisa disso, mas uma futura precisaria de `targetIndex`
  dentro do `HandCard` armado.
- **Fechar uma linha te faz escapar das armadilhas e do veto de contra-ataque.** `placeMark` não
  publica evento no caminho de vitória, de propósito — senão a mina aplicaria dano em cima do
  dano da derrota. É decisão de design, não bug.
- **A CPU pode abrir uma ameaça ao sacrificar a própria peça.** Ela simula a regra do infinito
  para *vencer* e *bloquear*, mas o critério posicional não verifica se remover a peça mais
  antiga libera uma linha para o humano. Corrigir é uma busca de 2 plies (~81 simulações,
  barato) — está fora do escopo de "heurística básica".
- **A CPU joga no máximo 1 carta por turno**, sempre antes do movimento de tabuleiro — nunca
  encadeia duas cartas na mesma jogada, mesmo quando nenhuma delas consome o turno.
- **A fonte no terminal é independente do resto do app.** `expo-font` não alcança o documento do
  WebView/iframe; usar a Press Start 2P lá dentro exige embutir o `.ttf` como base64 num
  `@font-face` dentro do próprio HTML.

---

## Licença

Projeto acadêmico.
