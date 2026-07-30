import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

/**
 * Inicialização do Firebase e acesso ao Realtime Database.
 *
 * Único ponto do app que conhece credenciais ou monta o SDK — o
 * `multiplayerService` importa `getDb()` daqui e mais nada toca no Firebase
 * diretamente. Trocar de backend (Supabase, socket próprio) passa a ser
 * reescrever o serviço, não caçar `initializeApp` espalhado pela árvore.
 */

/* -------------------------------------------------------------------------- */
/*                                CREDENCIAIS                                  */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ Cada `process.env.EXPO_PUBLIC_*` precisa aparecer como expressão
 * **estática e completa** no código-fonte.
 *
 * O Expo não lê variáveis em runtime: um plugin do Babel faz substituição
 * textual em tempo de build. `process.env[chave]` ou desestruturar
 * `const { EXPO_PUBLIC_X } = process.env` não são substituídos e chegam como
 * `undefined` no bundle — daí a repetição verbosa abaixo ser obrigatória, e
 * não preferência de estilo.
 *
 * O prefixo `EXPO_PUBLIC_` também é um lembrete: estes valores VÃO para o
 * bundle do cliente e são visíveis a quem baixar o app. Isso é esperado para
 * a config web do Firebase (ela identifica o projeto, não autoriza nada) — a
 * segurança de verdade mora nas Security Rules do RTDB, no console. Nunca
 * coloque um segredo real atrás deste prefixo.
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
} as const;

/**
 * Chaves sem as quais o RTDB não sobe. `databaseURL` entra aqui porque é a
 * única específica do Realtime Database — sem ela o SDK aceita a config e só
 * falha na primeira leitura, com um erro que não aponta para a causa.
 */
const REQUIRED_KEYS = ['apiKey', 'databaseURL', 'projectId', 'appId'] as const;

/** Config validada — o mesmo objeto acima, mas com os campos obrigatórios garantidos. */
type ValidatedConfig = typeof firebaseConfig & {
  [K in (typeof REQUIRED_KEYS)[number]]: string;
};

/**
 * Falha cedo e com nome, em vez de deixar o SDK subir meio configurado.
 *
 * O erro nativo do Firebase para config incompleta ("Can't determine Firebase
 * Database URL") não diz QUAL variável falta nem onde defini-la, e como
 * `.env` não é versionado, quem clona o repo bate exatamente nisso.
 */
function assertConfigured(config: typeof firebaseConfig): asserts config is ValidatedConfig {
  const missing = REQUIRED_KEYS.filter((key) => !config[key]);
  if (missing.length === 0) return;

  throw new Error(
    `[firebase] Configuração incompleta. Faltando no .env: ` +
      missing.map((key) => `EXPO_PUBLIC_FIREBASE_${toEnvSuffix(key)}`).join(', ') +
      `. Reinicie o servidor do Expo depois de editar o .env — as variáveis são ` +
      `inlinadas em tempo de build e não recarregam sozinhas.`,
  );
}

/** `databaseURL` ➜ `DATABASE_URL`. Só para a mensagem de erro citar o nome real da variável. */
function toEnvSuffix(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toUpperCase();
}

/* -------------------------------------------------------------------------- */
/*                             INSTÂNCIAS (lazy)                               */
/* -------------------------------------------------------------------------- */

/**
 * `getApps().length` em vez de chamar `initializeApp` direto: o Fast Refresh
 * reexecuta este módulo, e uma segunda inicialização com o mesmo nome lança
 * `Firebase App named '[DEFAULT]' already exists`. Reaproveitar a instância
 * existente deixa o hot reload funcionar sem derrubar a conexão aberta.
 */
export function getFirebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();

  assertConfigured(firebaseConfig);
  return initializeApp(firebaseConfig);
}

/**
 * Instância do Realtime Database.
 *
 * Função, e não constante exportada, de propósito: uma constante executaria
 * `initializeApp` no momento em que QUALQUER arquivo importasse este módulo —
 * inclusive quem só quisesse um tipo. Assim o app só falha por config ausente
 * se alguém de fato tentar usar a rede, e o modo local/CPU continua rodando
 * num clone sem `.env`.
 */
export function getDb(): Database {
  return getDatabase(getFirebaseApp());
}

/**
 * A rede está configurada? Usado pela UI para esconder/desabilitar o modo
 * online em vez de deixar o jogador clicar e receber um erro.
 */
export function isFirebaseConfigured(): boolean {
  return REQUIRED_KEYS.every((key) => Boolean(firebaseConfig[key]));
}
