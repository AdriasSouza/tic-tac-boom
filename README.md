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
metade superior da tela para serem jogadas. Tabela regenerada a partir de
`src/engine/cards/registry.ts` (19 cartas — ver "Estado atual" para o total); a especificação
completa das ~30 cartas planejadas para a Parte B, incluindo o que muda em cada uma destas, está
em [`docs/CARTAS.md`](docs/CARTAS.md).

| Carta | Raridade | Custo | Tipo | Efeito |
|---|---|---|---|---|
| **LIMPAR** (`CLEAR_BLOCK`) | Comum | 1⚡ | `ACTION` | Modo mira: libera a célula interditada pelo caos |
| **PURIFICAR** (`CLEANSE`) | Comum | 1⚡ | `ACTION` | Modo mira: libera uma célula de qualquer efeito persistente — bloqueio do caos ou lacre da TRAVAR |
| **TRAVAR** (`LOCK_CELL`) | Comum | 1⚡ | `ACTION` | Modo mira: lacra uma célula vazia por 2 turnos globais |
| **DEMOLIR** (`BREAK_PIECE`) | Comum | 1⚡ | `ACTION` | Modo mira: destrói uma peça do tabuleiro, inclusive as suas |
| **ESPIADA** (`PEEK_RANDOM`) | Rara | 1⚡ | `ACTION` | Revela uma carta aleatória da mão do oponente |
| **PROTEÇÃO** (`SHIELD_TRAP`) | Rara | 1⚡ | `TRAP` | Vira na mesa. Anula o SAQUE ou a ESPIONAGEM do oponente contra você, destruindo a armadilha |
| **PROCRASTINAR** (`DRAW_CARD`) | Rara | 2⚡ | `ACTION` | Compra 2 cartas novas |
| **SAQUE** (`HAND_RAID`) | Rara | 2⚡ | `ACTION` | 50% de chance de roubar uma carta aleatória do oponente; se falhar, nada acontece |
| **TROCAR** (`CARD_TRADE`) | Rara | 2⚡ | `ACTION` | Troca uma carta aleatória da sua mão por uma carta aleatória da mão do oponente |
| **VIDENTE** (`REVEAL_OLDEST`) | Rara | 2⚡ | `ACTION` | Modo mira: marca uma peça do oponente — destruída no início do próximo turno dele |
| **PROCRASTINAR II** (`DRAW_CARD_BIG`) | Épica | 2⚡ | `ACTION` | Compra 3 cartas novas |
| **ESPIONAGEM** (`SPY_CARD`) | Épica | 2⚡ | `ACTION` | Revela e descarta uma carta aleatória da mão do oponente |
| **ATAQUE** (`DIRECT_DAMAGE`) | Épica | 3⚡ | `ACTION` | Causa 1 de dano direto ao oponente |
| **CURA** (`HEAL_SELF`) | Épica | 3⚡ | `ACTION` | Recupera 1 HP (limite de 5) |
| **PULAR** (`EXTRA_TURN`) | Épica | 3⚡ | `ACTION` | O oponente perde a fase de colocar peça no próximo turno dele |
| **VISÃO ABSOLUTA** (`FULL_INTEL`) | Lendária | 3⚡ | `ACTION` | Mostra quantas cartas o oponente tem na mão (revelação completa por carta ainda não implementada) |
| **MINA** (`BOMB_TRAP`) | Lendária | 3⚡ | `TRAP` | Vira na mesa. Detona se o oponente ocupar o centro: 2 de dano e ele perde a vez |
| **TIC TAC BOOM!** (`CHAOS_ROULETTE`) | Boom! | 0⚡ | `ACTION` | Dispara um surto de caos imediato — a mesma roleta do relógio global |
| **ALTAR DE SACRIFÍCIO** (`ALTAR_OF_SACRIFICE`) | Boom! | 0⚡ | `ACTION` | Abre modal para sacrificar 2 cartas (fusão de raridade ainda incompleta) |

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
1. Arraste **PULAR** para a metade superior da tela.
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
│   │   ├── HUD.tsx                   # Linha 1: HP + mãos + turno
│   │   ├── MiniHand.tsx              # Miniatura de mão (face / verso)
│   │   ├── Board.tsx                 # Grid 3x3, aritmética inteira
│   │   ├── Cell.tsx                  # Célula: peça, pulso, mira, haptics
│   │   ├── TrapZone.tsx              # Coluna lateral de armadilhas
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

**Só o `<Board />` decide a geometria do tabuleiro.** Nenhum ancestral da área de jogo aplica
`aspectRatio`, `maxWidth` ou `maxHeight` — eles entregam espaço bruto (`flex:1` +
`alignSelf:'stretch'`); o board mede as duas dimensões via `onLayout` e resolve o quadrado
sozinho. Essa classe de bug — um ancestral decidindo geometria do board por baixo do pano —
já apareceu de três formas diferentes: um `maxWidth`/`maxHeight` externo cravado em 420dp
(capava o board em QUALQUER tela, desktop incluso); depois um `aspectRatio` num container
`row`, que pré-quadrava a caixa antes do board medir e chegou a reportar metade da largura
real da linha; e, antes das duas, a própria `<TrapZone />` empilhada como irmã de flex do
board no eixo vertical, competindo por altura diretamente (ver próximo item). Nas três, o
sintoma era o mesmo: o board não estava de fato livre para decidir o próprio tamanho, mesmo
sem nenhuma prop dizendo isso explicitamente.

**Zonas de armadilha são sempre sidebars, nunca irmãs de flex do tabuleiro no eixo vertical.**
Em retrato — a orientação mais comum — a altura é o recurso escasso; empilhar as armadilhas
acima/abaixo do board competia exatamente por esse recurso. Como sidebars de largura fixa
(por `LayoutMode`), elas competem só pela largura, que sobra até em celular. Onde sobra
largura de verdade, um segundo mecanismo (`insetPerSide`, calculado em `[mode].tsx`) aproxima
as sidebars do tabuleiro — mas só quando `boardSize` já está acima do piso jogável (ver
"Limitações conhecidas"); abaixo dele, apertar a largura de um layout que já falhou na
altura não ajuda em nada, só desloca a quebra para outro eixo.

**O tamanho do board fica imune a safe area quando a largura é o eixo limitante.** Em telas
onde `min(availableW, availableH)` já é `availableW`, os insets de topo/rodapé (que só afetam
altura) podem crescer sem mudar `boardSize` nem um pixel — o navegador (inset zero) e o device
real medem o mesmo board. Isso deixa de valer só quando a ALTURA vira o eixo limitante.
Comprovado empiricamente, não só por conta: em 390×844 a estimativa de `availableH` errou por
75dp (333 estimado vs. 408 medido no device real) e `boardSize` saiu idêntico dos dois lados
(270) — a largura já governava, então o erro na altura simplesmente não tinha como chegar
ao resultado. Confirmado de novo na A3: mover o `<HandTracker />` para fora da coluna do HUD em
retrato liberou `availableH` de 408 para 442 (34dp), e `boardSize` continuou 270/80 — a mesma
imunidade, agora com uma segunda medição real de antes/depois no mesmo dispositivo.

**O eixo limitante troca por volta de ~434dp de largura de área de jogo.** Medido numa largura
onde `availableW` (434) e `availableH` (442) já estão quase empatados, a largura ainda um fio
abaixo. Abaixo desse cruzamento a largura governa (e o board é imune a mudanças de altura do
HUD, item acima); acima dele, é a altura que governa (e o board volta a reagir a
HUD/terminal/mão crescendo ou encolhendo). Não é um número redondo escolhido de propósito — é
onde essas duas dimensões, nesta tela, aconteceram de se cruzar.

**Alturas de fileira dentro do HUD são explícitas, nunca emergentes.** O mesmo motivo do item
acima (ancestral não decide geometria) se aplica DENTRO do HUD: `handTrackerRowHeight` (a
fileira do rótulo VOCÊ/CPU + `<HandTracker />`) é uma fórmula própria, independente de
`miniCardWidth`/`miniCardHeight` — não "o que o conteúdo pedir". Se o slot crescer além do que
essa fórmula previu no futuro, o sintoma é um slot cortado, visível na hora; sem isso, o board
perderia altura em silêncio a cada ajuste de tamanho de carta — a mesma raiz que já causou três
bugs distintos no board (item acima), desta vez prevenida ANTES de virar um quarto.

**Medições, antes e depois da A1/A2/A2.1/A3** (retrato/paisagem, `boardSize`/`cellSize`):

| Dispositivo | Antes | Depois |
|---|---|---|
| 320×568 | não renderizava (`outer≤0`) | 200 / 57 |
| 390×844 | 154 / 42 | 270 / 80 |
| 1440×900 | 420 / 130 (teto fixo, qualquer tela) | 476 / 149 |

O número de 1440×900 subiu de 466/146 (fim da A2.1) para 476/149 na A3: mover o
`<HandTracker />` para a `sideRow` em paisagem (em vez de empilhar como a antiga
`<MiniHand />`) devolveu altura ao HUD, e como 1440×900 é limitado pela ALTURA, essa folga
vira board maior — troca boa, não regressão (o board não estava errado antes, só tinha
menos espaço disponível).

Em 390×844, `boardSize`/`cellSize` não mudam entre A2.1 e A3 (largura continua o eixo
limitante ali), mas `availableH` medido subiu de 408 para 442 pela mesma liberação de
altura do HUD — outra confirmação da imunidade a mudanças de altura quando a largura
governa (ver "Decisões de arquitetura").

926×428 fica de fora desta tabela de propósito — nunca teve um "antes" medido de verdade
para comparar, só estimativas ao longo do desenvolvimento. O número atual (136 / 32) está
documentado como limitação conhecida, abaixo.

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
- **19 cartas**: 17 de ação, 1 armadilha ofensiva (MINA) e 1 armadilha defensiva (PROTEÇÃO) que
  veta a carta do oponente antes do efeito resolver — tabela completa em "### Cartas", acima.
  Especificação das ~30 cartas planejadas para a Parte B (com o que muda em cada uma) em
  [`docs/CARTAS.md`](docs/CARTAS.md)
- Mão arrastável em leque, com layout animations
- **Rastreamento de posição na mão do oponente** (`<HandTracker />`) — identidade por
  `instanceId` (`uid`), nunca por índice de array; revelação (ESPIADA) persiste enquanto a
  carta durar na mão, sem prazo; inserção de carta nova sempre pelo mesmo extremo fixo (fim
  da mão), nunca no meio, é o que torna a posição rastreável entre turnos; o próprio lado do
  jogador destaca quando o oponente já viu uma das suas cartas; posicionamento muda por
  orientação (embutido na linha do rótulo VOCÊ/CPU em retrato, ao lado do HP em paisagem) sem
  custo de altura extra em nenhum dos dois — ver "Decisões de arquitetura"
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
- **VISÃO ABSOLUTA (`FULL_INTEL`) com prazo.** O texto da carta ("vire quantas cartas quiser")
  ainda não tem seleção por carta — hoje só loga a contagem da mão. É uma mecânica diferente do
  rastreamento por posição do `<HandTracker />`: revela a mão inteira e tem prazo explícito (o
  PDF de design indica expiração no fim do turno), enquanto a revelação por `uid` do
  `<HandTracker />` não expira sozinha — dura enquanto a carta durar na mão. Implementar exige um
  temporizador próprio, deliberadamente fora do modelo de dados da Parte A3.

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
- **A CPU reage a ser bloqueada por REBOBINAR (chama `endTurn` em vez de travar), mas não
  ganhou heurística para JOGAR a carta.** `chooseCpuCardPlay` não considera REBOBINAR entre
  as prioridades — fica para uma fase futura de IA mais avançada (Fase 7). Pelo mesmo motivo,
  `chooseCpuMove` não deixa de "bloquear" uma ameaça do humano quando o humano também está
  impedido de colocar peça (`playerPlacementBlocked`) — jogar defensivo demais nesse caso é
  sub-ótimo, não incorreto.
- **A fonte no terminal é independente do resto do app.** `expo-font` não alcança o documento do
  WebView/iframe; usar a Press Start 2P lá dentro exige embutir o `.ttf` como base64 num
  `@font-face` dentro do próprio HTML.
- **Celular deitado bem baixo (ex: 926×428) fica abaixo do piso jogável — de propósito, não por
  bug.** `boardSize=136`/`cellSize≈32`, abaixo do piso de 180 que o próprio `<Board />` denuncia
  via `console.warn`. O hug de sidebar (ver "Decisões de arquitetura") está DESLIGADO ali de
  propósito: apertar a largura de um layout que já falhou na altura não ajuda em nada, só desloca
  a quebra para outro eixo. A alavanca real para resolver este caso é a altura do HUD (~55dp) e
  da mão (~104dp) nesse dispositivo — não as armadilhas, que já são o mínimo possível.

---

## Licença

Projeto acadêmico.
