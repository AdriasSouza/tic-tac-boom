import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Haptics from 'expo-haptics';

import {
  LOG_LIMIT,
  selectActiveRule,
  selectTerminalLog,
  useGameStore,
  type ChaosRule,
} from '@/store/gameStore';

/* -------------------------------------------------------------------------- */
/*                          PROTOCOLO DA PONTE (typed)                         */
/* -------------------------------------------------------------------------- */
/* Contrato explícito entre nativo e web. Qualquer mensagem fora destes tipos
   é descartada — o `onMessage` do WebView aceita string arbitrária, então
   validar aqui é obrigatório e não paranoia.                                  */

/** React Native ➜ WebView */
type OutboundMessage =
  | { type: 'SET_RULE'; rule: ChaosRule; label: string }
  /** Acrescenta linhas ao log. Em lote para evitar N injeções seguidas. */
  | { type: 'PRINT'; lines: string[] }
  /** Limpa o log — usado ao reimprimir o histórico depois de um reload. */
  | { type: 'CLEAR' }
  /** Agenda o próximo surto. O intervalo vem do RNG semeado, nunca da página. */
  | { type: 'SCHEDULE_GLITCH'; delay: number };

/** WebView ➜ React Native */
type InboundMessage =
  | { type: 'READY' }
  | { type: 'GLITCH'; at: number };

/** Texto exibido no terminal para cada regra caótica. */
const RULE_LABEL: Record<ChaosRule, string> = {
  NORMAL: 'SYSTEM NOMINAL',
  RANDOM_FADE: 'RANDOM FADE',
  BLOCKED_CELL: 'CELL LOCKDOWN',
};

/* -------------------------------------------------------------------------- */
/*                              PÁGINA CRT (local)                             */
/* -------------------------------------------------------------------------- */
/* HTML/CSS/JS 100% offline e estático — nenhuma requisição de rede sai daqui.
   Fase 2: mover para `assets/web/terminal.html` e carregar via expo-asset.    */

const CRT_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  html, body {
    height: 100%;
    background: #000;
    overflow: hidden;
    font-family: ui-monospace, "Courier New", monospace;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* Moldura do monitor -------------------------------------------------- */
  .crt {
    position: relative;
    height: 100%;
    width: 100%;
    background: radial-gradient(ellipse at center, #06170b 0%, #010402 100%);
    overflow: hidden;
    animation: flicker 4s infinite steps(1);
  }

  .screen {
    position: relative;
    z-index: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 8px 14px;
    color: #39ff7a;
    text-shadow: 0 0 4px rgba(57, 255, 122, 0.85), 0 0 12px rgba(57, 255, 122, 0.35);
  }

  .label {
    font-size: 9px;
    letter-spacing: 3px;
    opacity: 0.55;
    text-transform: uppercase;
  }

  /* Cabeçalho: rótulo + regra ativa -------------------------------------- */
  .header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex: 0 0 auto;
    padding-bottom: 3px;
    border-bottom: 1px solid rgba(57, 255, 122, 0.22);
  }

  .rule {
    position: relative;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  /* Log de combate -------------------------------------------------------- */
  .log {
    flex: 1 1 auto;
    min-height: 0;              /* deixa o flex encolher e o scroll valer */
    overflow-y: auto;
    padding-top: 4px;
    font-size: 9px;
    line-height: 12px;
    letter-spacing: 0.5px;
    scrollbar-width: none;
  }

  .log::-webkit-scrollbar { display: none; }

  .log .entry {
    opacity: 0.8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Cursor piscando só na última linha ----------------------------------- */
  .log .entry:last-child {
    opacity: 1;
  }

  .log .entry:last-child::after {
    content: "";
    display: inline-block;
    width: 5px;
    height: 8px;
    margin-left: 3px;
    background: #39ff7a;
    vertical-align: -1px;
    animation: blink 1s steps(2) infinite;
  }

  /* Scanlines + máscara de fósforo --------------------------------------- */
  .scanlines {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0) 0px,
      rgba(0, 0, 0, 0) 2px,
      rgba(0, 0, 0, 0.38) 3px,
      rgba(0, 0, 0, 0.38) 4px
    );
  }

  /* Varredura horizontal descendo lentamente ----------------------------- */
  .sweep {
    position: absolute;
    left: 0;
    right: 0;
    height: 40px;
    z-index: 3;
    pointer-events: none;
    background: linear-gradient(to bottom, rgba(57, 255, 122, 0) 0%, rgba(57, 255, 122, 0.07) 50%, rgba(57, 255, 122, 0) 100%);
    animation: sweep 7s linear infinite;
  }

  /* Vinheta / curvatura do tubo ------------------------------------------ */
  .vignette {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    box-shadow: inset 0 0 22px 6px rgba(0, 0, 0, 0.9);
    border-radius: 10px;
  }

  /* Glitch: separação RGB + recorte horizontal --------------------------- */
  .rule.glitch { animation: jitter 0.18s steps(2) infinite; }

  .rule.glitch::before,
  .rule.glitch::after {
    content: attr(data-text);
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    overflow: hidden;
  }

  .rule.glitch::before {
    color: #ff2e63;
    text-shadow: 2px 0 rgba(255, 46, 99, 0.9);
    animation: slice-a 0.35s steps(3) infinite;
  }

  .rule.glitch::after {
    color: #21e6ff;
    text-shadow: -2px 0 rgba(33, 230, 255, 0.9);
    animation: slice-b 0.29s steps(3) infinite;
  }

  body.shake .crt { animation: shake 0.12s steps(2) infinite; }

  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  @keyframes flicker {
    0%, 92%, 100% { opacity: 1; }
    93% { opacity: 0.82; }
    95% { opacity: 1; }
    97% { opacity: 0.9; }
  }

  @keyframes sweep {
    0%   { transform: translateY(-40px); }
    100% { transform: translateY(160px); }
  }

  @keyframes jitter {
    0%   { transform: translate(0, 0); }
    50%  { transform: translate(-1px, 1px); }
    100% { transform: translate(1px, -1px); }
  }

  @keyframes shake {
    0%   { transform: translate(0, 0); }
    50%  { transform: translate(2px, -1px); }
    100% { transform: translate(-2px, 1px); }
  }

  @keyframes slice-a {
    0%   { clip-path: inset(10% 0 72% 0); transform: translateX(-4px); }
    50%  { clip-path: inset(48% 0 28% 0); transform: translateX(5px); }
    100% { clip-path: inset(80% 0 4% 0);  transform: translateX(-3px); }
  }

  @keyframes slice-b {
    0%   { clip-path: inset(62% 0 18% 0); transform: translateX(4px); }
    50%  { clip-path: inset(22% 0 60% 0); transform: translateX(-5px); }
    100% { clip-path: inset(4% 0 86% 0);  transform: translateX(3px); }
  }
</style>
</head>
<body>
  <div class="crt">
    <div class="screen">
      <div class="header">
        <span class="label">// chaos</span>
        <span class="rule" id="rule" data-text="BOOTING">BOOTING</span>
      </div>
      <div class="log" id="log"></div>
    </div>
    <div class="sweep"></div>
    <div class="scanlines"></div>
    <div class="vignette"></div>
  </div>

<script>
(function () {
  'use strict';

  var RN = window.ReactNativeWebView;
  var ruleEl = document.getElementById('rule');
  var logEl = document.getElementById('log');
  var glitchTimeout = null;
  var instabilityTimeout = null;

  /** Teto de nós no DOM. O buffer real vive no store; aqui é só o visível. */
  var MAX_NODES = 80;

  /** WebView ➜ React Native */
  function send(payload) {
    if (RN && RN.postMessage) RN.postMessage(JSON.stringify(payload));
  }

  function glitch(duration) {
    ruleEl.classList.add('glitch');
    document.body.classList.add('shake');
    clearTimeout(glitchTimeout);
    glitchTimeout = setTimeout(function () {
      ruleEl.classList.remove('glitch');
      document.body.classList.remove('shake');
    }, duration);
  }

  function setRule(rule, label) {
    ruleEl.textContent = label;
    ruleEl.setAttribute('data-text', label);
    glitch(900);
    // A linha de log da troca de regra vem do store (pushLog), não daqui —
    // uma única fonte de verdade para o histórico.
  }

  function print(lines) {
    if (!lines || lines.length === 0) return;

    for (var i = 0; i < lines.length; i++) {
      var entry = document.createElement('div');
      entry.className = 'entry';
      entry.textContent = '> ' + lines[i];
      logEl.appendChild(entry);
    }

    while (logEl.childNodes.length > MAX_NODES) {
      logEl.removeChild(logEl.firstChild);
    }

    // Auto-scroll para o fim. scrollHeight já reflete os nós recém-inseridos
    // porque appendChild força reflow síncrono.
    logEl.scrollTop = logEl.scrollHeight;
  }

  /**
   * API global chamada pelo React Native via injectJavaScript.
   * Mantida em window para sobreviver a qualquer escopo de injeção.
   */
  window.__CHAOS__ = {
    handle: function (raw) {
      var msg;
      try {
        msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      if (msg.type === 'SET_RULE') {
        setRule(msg.rule, msg.label);
      } else if (msg.type === 'PRINT') {
        print(msg.lines);
      } else if (msg.type === 'CLEAR') {
        logEl.innerHTML = '';
      } else if (msg.type === 'SCHEDULE_GLITCH') {
        // O intervalo é DITADO pelo nativo (RNG semeado). A página não sorteia
        // nada — é só um monitor burro que obedece.
        clearTimeout(instabilityTimeout);
        instabilityTimeout = setTimeout(function () {
          glitch(450);
          send({ type: 'GLITCH', at: Date.now() });
        }, msg.delay);
      }
    }
  };

  // Compatibilidade com ref.postMessage() do react-native-webview.
  function onNativeMessage(event) { window.__CHAOS__.handle(event.data); }
  document.addEventListener('message', onNativeMessage);
  window.addEventListener('message', onNativeMessage);

  print(['uplink estabelecido']);

  // Handshake: o nativo responde com SET_RULE, o histórico do log e o
  // primeiro SCHEDULE_GLITCH.
  send({ type: 'READY' });
})();
</script>
</body>
</html>`;

/**
 * Constante de módulo, NÃO objeto inline.
 * Um `source={{ html }}` criado a cada render muda de identidade e faz o
 * WebView recarregar a página inteira no Android — matando o handshake.
 */
const CRT_SOURCE = { html: CRT_HTML, baseUrl: '' } as const;

/* -------------------------------------------------------------------------- */
/*                                 COMPONENTE                                  */
/* -------------------------------------------------------------------------- */

export interface ChaosTerminalProps {
  /** Altura fixa do monitor em dp. */
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Vibra o device quando o terminal surta sozinho. */
  hapticsEnabled?: boolean;
}

/**
 * Monitor CRT retro renderizado dentro de um WebView, com ponte bidirecional:
 *
 * - **Nativo ➜ Web:** toda mudança de `activeRule` no Zustand é injetada na
 *   página, que exibe a nova regra com efeito de glitch.
 * - **Web ➜ Nativo:** a página tem um temporizador próprio e, a cada 5–9s,
 *   dispara `triggerTerminalGlitch()` na store.
 *
 * Decorativo: não captura toques, para não roubar gestos do tabuleiro.
 */
export function ChaosTerminal({ height = 120, style, hapticsEnabled = true }: ChaosTerminalProps) {
  const webViewRef = useRef<WebView>(null);

  const activeRule = useGameStore(selectActiveRule);
  const terminalLog = useGameStore(selectTerminalLog);
  const triggerTerminalGlitch = useGameStore((s) => s.triggerTerminalGlitch);
  const rollTerminalDelay = useGameStore((s) => s.rollTerminalDelay);

  /** Maior `id` já impresso. `-1` = nada impresso ainda (ou página recarregou). */
  const lastPrintedIdRef = useRef(-1);

  /**
   * A página só existe depois do `READY`. Injetar antes é no-op silencioso,
   * então enfileiramos as mensagens e damos flush no handshake.
   */
  const isReadyRef = useRef(false);
  const pendingRef = useRef<OutboundMessage[]>([]);

  const post = useCallback((message: OutboundMessage) => {
    if (!isReadyRef.current) {
      pendingRef.current.push(message);
      return;
    }
    // JSON.stringify duplo: o interno vira o payload, o externo escapa o
    // payload como literal de string JS válido dentro do script injetado.
    const literal = JSON.stringify(JSON.stringify(message));
    webViewRef.current?.injectJavaScript(
      `window.__CHAOS__ && window.__CHAOS__.handle(${literal}); true;`,
    );
  }, []);

  // Nativo ➜ Web: espelha a regra caótica atual no monitor.
  useEffect(() => {
    post({ type: 'SET_RULE', rule: activeRule, label: RULE_LABEL[activeRule] });
  }, [activeRule, post]);

  /* --- Nativo ➜ Web: log de combate ---------------------------------------
     Sincronização incremental por `id`. Imprimir o array inteiro a cada
     mudança duplicaria tudo; comparar por conteúdo falharia com mensagens
     repetidas legítimas ("demolir :: célula 4" duas vezes).

     Um `startMatch` zera o log e reinicia os ids em 0. Detectamos isso pelo
     id da primeira linha ser menor do que o último impresso e mandamos CLEAR
     antes de reimprimir.                                                     */
  useEffect(() => {
    if (terminalLog.length === 0) {
      if (lastPrintedIdRef.current !== -1) {
        lastPrintedIdRef.current = -1;
        post({ type: 'CLEAR' });
      }
      return;
    }

    if (terminalLog[0].id < lastPrintedIdRef.current - LOG_LIMIT) {
      lastPrintedIdRef.current = -1;
      post({ type: 'CLEAR' });
    }

    const fresh = terminalLog.filter((line) => line.id > lastPrintedIdRef.current);
    if (fresh.length === 0) return;

    lastPrintedIdRef.current = fresh[fresh.length - 1].id;
    post({ type: 'PRINT', lines: fresh.map((line) => line.text) });
  }, [terminalLog, post]);

  // Web ➜ Nativo.
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: InboundMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as InboundMessage;
      } catch {
        return; // payload malformado — descarta
      }

      switch (message?.type) {
        case 'READY': {
          isReadyRef.current = true;
          const queued = pendingRef.current;
          pendingRef.current = [];
          queued.forEach(post);

          // A página nasceu vazia (primeiro load ou crash do renderer):
          // reimprime o histórico que o store guardou.
          lastPrintedIdRef.current = -1;
          const history = useGameStore.getState().terminalLog;
          if (history.length > 0) {
            lastPrintedIdRef.current = history[history.length - 1].id;
            post({ type: 'PRINT', lines: history.map((line) => line.text) });
          }

          // Dá a partida no ciclo de instabilidade.
          post({ type: 'SCHEDULE_GLITCH', delay: rollTerminalDelay() });
          break;
        }

        case 'GLITCH': {
          if (hapticsEnabled) {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
          }
          triggerTerminalGlitch();
          // Reagenda daqui: o loop vive no nativo, onde a seed manda.
          post({ type: 'SCHEDULE_GLITCH', delay: rollTerminalDelay() });
          break;
        }
      }
    },
    [post, triggerTerminalGlitch, rollTerminalDelay, hapticsEnabled],
  );

  /** Se a página recarregar (crash do renderer), o handshake precisa refazer. */
  const handleLoadStart = useCallback(() => {
    isReadyRef.current = false;
  }, []);

  return (
    <View style={[styles.container, { height }, style]} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={CRT_SOURCE}
        originWhitelist={['*']}
        onMessage={handleMessage}
        onLoadStart={handleLoadStart}
        // Conteúdo é estático e local: nenhuma navegação externa é permitida.
        onShouldStartLoadWithRequest={(request) =>
          request.url === 'about:blank' || request.url.startsWith('data:')
        }
        style={styles.webview}
        containerStyle={styles.webviewContainer}
        // --- Performance / aparência ---
        androidLayerType="hardware"
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        // --- Superfície mínima: nada aqui precisa de rede, storage ou popups ---
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowsInlineMediaPlayback={false}
        setSupportMultipleWindows={false}
        cacheEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#000', // evita flash branco antes do primeiro paint
    borderWidth: 2,
    borderColor: '#1c3a24',
    overflow: 'hidden',
  },
  webviewContainer: {
    backgroundColor: '#000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});

export default ChaosTerminal;
