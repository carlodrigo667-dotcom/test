const fs = require('fs');
const path = require('path');
const https = require('https');

// Вытягиваем конфигурацию
const configPath = path.join(__dirname, '..', 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error("❌ Не удалось прочитать config.json", e);
  process.exit(1);
}

// Узнаем наш NODE_ID (По умолчанию 1, если не передали через ENV)
const NODE_ID = String(process.env.NODE_ID || '').trim();

if (!/^\d+$/.test(NODE_ID)) {
  console.error("NODE_ID is missing or invalid. Start via 'bash launcher.sh <node_id>'.");
  process.exit(1);
}

// Optional legacy sniper notifications. The read-only control-center bot is the primary Telegram interface.
const BOT_TOKEN = String(process.env.SNIPER_TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = String(process.env.SNIPER_TELEGRAM_CHAT_ID || '').trim();
const TELEGRAM_ENABLED = Boolean(BOT_TOKEN && CHAT_ID);

if (!TELEGRAM_ENABLED) {
  console.warn('[TELEGRAM] sniper Telegram notifications disabled; use the read-only control bot on the coordinator.');
}

const CP1251_EXTRA_ENCODE = new Map([
  ['Ђ', 0x80], ['Ѓ', 0x81], ['‚', 0x82], ['ѓ', 0x83], ['„', 0x84], ['…', 0x85], ['†', 0x86], ['‡', 0x87],
  ['€', 0x88], ['‰', 0x89], ['Љ', 0x8A], ['‹', 0x8B], ['Њ', 0x8C], ['Ќ', 0x8D], ['Ћ', 0x8E], ['Џ', 0x8F],
  ['ђ', 0x90], ['‘', 0x91], ['’', 0x92], ['“', 0x93], ['”', 0x94], ['•', 0x95], ['–', 0x96], ['—', 0x97],
  ['™', 0x99], ['љ', 0x9A], ['›', 0x9B], ['њ', 0x9C], ['ќ', 0x9D], ['ћ', 0x9E], ['џ', 0x9F],
  [' ', 0xA0], ['Ў', 0xA1], ['ў', 0xA2], ['Ј', 0xA3], ['¤', 0xA4], ['Ґ', 0xA5], ['¦', 0xA6], ['§', 0xA7],
  ['Ё', 0xA8], ['©', 0xA9], ['Є', 0xAA], ['«', 0xAB], ['¬', 0xAC], ['­', 0xAD], ['®', 0xAE], ['Ї', 0xAF],
  ['°', 0xB0], ['±', 0xB1], ['І', 0xB2], ['і', 0xB3], ['ґ', 0xB4], ['µ', 0xB5], ['¶', 0xB6], ['·', 0xB7],
  ['ё', 0xB8], ['№', 0xB9], ['є', 0xBA], ['»', 0xBB], ['ј', 0xBC], ['Ѕ', 0xBD], ['ѕ', 0xBE], ['ї', 0xBF]
]);

function encodeCp1251Byte(ch) {
  const code = ch.codePointAt(0);
  if (code <= 0xFF) return code;
  if (code >= 0x0410 && code <= 0x044F) return code - 0x350;
  if (CP1251_EXTRA_ENCODE.has(ch)) return CP1251_EXTRA_ENCODE.get(ch);
  return null;
}

function suspiciousScore(text) {
  if (!text) return 0;
  const source = String(text);
  const odd = source.match(/[ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—™љ›њќћџЎўЈҐ¦§©Є«¬®Ї°±Ііґµ¶·ё№є»јЅѕї]/gu) || [];
  const mojibakePairs = source.match(/[РСвр][ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—™љ›њќћџЎўЈҐ¦§©Є«¬®Ї°±Ііґµ¶·ё№є»јЅѕї]/gu) || [];
  return odd.length * 3 + mojibakePairs.length;
}

function readableScore(text) {
  if (!text) return 0;
  const source = String(text);
  const cyrillic = source.match(/[А-Яа-яЁё]/gu) || [];
  const emoji = source.match(/[\u{1F300}-\u{1FAFF}]/gu) || [];
  const punctuation = source.match(/[№«»—–]/gu) || [];
  return cyrillic.length + emoji.length * 2 + punctuation.length;
}

function qualityScore(text) {
  if (!text) return Number.NEGATIVE_INFINITY;
  const source = String(text);
  const replacement = source.match(/�/gu) || [];
  return readableScore(source) * 4 - suspiciousScore(source) * 6 - replacement.length * 20;
}

function decodeCp1251Mojibake(text) {
  const bytes = [];
  let mappedCount = 0;

  for (const ch of String(text)) {
    const byte = encodeCp1251Byte(ch);
    if (byte === null) return null;
    bytes.push(byte);
    if (byte > 0x7F) mappedCount += 1;
  }

  if (!mappedCount) return null;

  try {
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return null;
  }
}

function normalizeText(text) {
  if (typeof text !== 'string' || !text) return text;

  const candidates = [text];
  let current = text;
  for (let i = 0; i < 2; i += 1) {
    const decoded = decodeCp1251Mojibake(current);
    if (!decoded || decoded === current) break;
    candidates.push(decoded);
    current = decoded;
  }

  return candidates.reduce((best, candidate) => (
    qualityScore(candidate) > qualityScore(best) ? candidate : best
  ), text);
}

function normalizeArgs(args) {
  return args.map((arg) => (typeof arg === 'string' ? normalizeText(arg) : arg));
}

const rawConsoleLog = console.log.bind(console);
const rawConsoleError = console.error.bind(console);
console.log = (...args) => rawConsoleLog(...normalizeArgs(args));
console.error = (...args) => rawConsoleError(...normalizeArgs(args));

/**
 * Отправка сообщения в Telegram через родной Node.js https (без axios чтобы не тащить зависимости)
 */
function notifyTelegram(message) {
  if (!TELEGRAM_ENABLED) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'telegram_disabled' });
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const normalizedMessage = normalizeText(message);
  const payload = JSON.stringify({
    chat_id: CHAT_ID,
    text: `[Сервер ${NODE_ID}] ${normalizedMessage}`,
    parse_mode: 'HTML'
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          finish(parsed);
        } catch (e) {
          finish(data);
        }
      });
    });

    req.setTimeout(5000, () => {
      req.destroy(new Error('telegram_notify_timeout'));
    });
    req.on('error', (e) => {
      finish({ ok: false, error: e.message || String(e), skipped: true });
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Редактирование существующего сообщения в Telegram по message_id.
 * Возвращает parsed response (или null при ошибке).
 */
function editTelegram(messageId, newText) {
  if (!TELEGRAM_ENABLED) {
    return Promise.resolve(null);
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
  const normalizedText = normalizeText(newText);
  const payload = JSON.stringify({
    chat_id: CHAT_ID,
    message_id: messageId,
    text: `[Сервер ${NODE_ID}] ${normalizedText}`,
    parse_mode: 'HTML'
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

module.exports = {
  notifyTelegram,
  editTelegram,
  normalizeText,
  config,
  NODE_ID
};
