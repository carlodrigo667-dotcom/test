const USER_AGENT_ROTATION = [
  // Chrome 131 - Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome 130 - Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  // Chrome 129 - Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  // Chrome 131 - macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  // Chrome 130 - macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

const SEC_CH_UA_PLATFORMS = [
  '"Windows"',
  '"macOS"',
];

function getRandomUserAgent() {
  return USER_AGENT_ROTATION[Math.floor(Math.random() * USER_AGENT_ROTATION.length)];
}

function getSecChUaFromUserAgent(ua) {
  const chromeVersionMatch = ua.match(/Chrome\/(\d+)/);
  const chromeVersion = chromeVersionMatch ? chromeVersionMatch[1] : '131';
  const fullVersion = `${chromeVersion}.0.${Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 100)}`;
  return `"Chromium";v="${chromeVersion}", "Not=A?Brand";v="24", "Google Chrome";v="${chromeVersion}"`;
}

function getSecChUaPlatform(ua) {
  if (ua.includes('Win')) return '"Windows"';
  if (ua.includes('Mac')) return '"macOS"';
  return '"Windows"';
}

const STANDARD_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
};
require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Custom advanced anti-detection script to inject BEFORE any page load
const ANTI_DETECT_SCRIPT = `
(function() {
  // Override navigator.webdriver - CRITICAL
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true,
    enumerable: true
  });
  
  // Override navigator.plugins to show real plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { description: 'Portable Document Format', filename: 'internal-pdf-viewer.plugin', name: 'Chrome PDF Plugin' },
      { description: '', filename: 'internal-nacl-plugin', name: 'Native Client' }
    ],
    configurable: true,
    enumerable: true
  });
  
  // Override navigator.languages (Italian priority)
  Object.defineProperty(navigator, 'languages', {
    get: () => ['it-IT', 'it', 'en-US', 'en'],
    configurable: true,
    enumerable: true
  });
  
  Object.defineProperty(navigator, 'language', {
    get: () => 'it-IT',
    configurable: true,
    enumerable: true
  });
  
  // Override navigator.platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32',
    configurable: true,
    enumerable: true
  });
  
  // Mock navigator.connection
  if (!navigator.connection) {
    Object.defineProperty(navigator, 'connection', {
      get: () => ({ 
        effectiveType: '4g', 
        rtt: 45, 
        downlink: 10.5,
        saveData: false
      }),
      configurable: true
    });
  }
  
  // Override WebGL vendor and renderer (Intel GPU)
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris Graphics 650';
      return getParameter.call(this, parameter);
    };
    
    if (window.WebGL2RenderingContext) {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris Graphics 650';
        return getParameter2.call(this, parameter);
      };
    }
  } catch(e) {}
  
  // Fix Permissions API
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = function(parameters) {
    return originalQuery.call(window.navigator, parameters).then((result) => {
      if (parameters.name === 'notifications') {
        Object.defineProperty(result, 'state', { value: 'default', configurable: true });
      }
      return result;
    });
  };
  
  // Fix iframe contentWindow - remove automation traces
  try {
    const iframeProto = HTMLIFrameElement.prototype;
    const originalContentWindow = Object.getOwnPropertyDescriptor(iframeProto, 'contentWindow');
    if (originalContentWindow && originalContentWindow.get) {
      Object.defineProperty(iframeProto, 'contentWindow', {
        get: function() {
          const win = originalContentWindow.get.call(this);
          if (win) {
            try {
              Object.defineProperty(win.navigator, 'webdriver', { get: () => false, configurable: true });
            } catch(e) {}
          }
          return win;
        },
        configurable: true
      });
    }
  } catch(e) {}
  
  // Mock chrome.runtime properly (DO NOT delete window.chrome)
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      connect: () => ({ onMessage: { addListener: () => {}, removeListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
      sendMessage: () => {},
      getManifest: () => ({ name: 'Chrome', version: '131.0.6778.86' }),
      getURL: (path) => 'chrome-extension://' + path,
      id: ''
    };
  }
  
  // Remove puppeteer-specific properties that might leak
  try {
    delete window.__proto__['chrome'];
    delete window['chrome'];
    // Re-add proper chrome after deletion
    window.chrome = {
      runtime: {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
        sendMessage: () => {},
        getManifest: () => ({ name: 'Chrome', version: '131.0.6778.86' })
      }
    };
  } catch(e) {}
  
  // Fix toString methods to appear native
  const nativeToString = Function.prototype.toString;
  const hasOwnProperty = Object.prototype.hasOwnProperty;
  
  Function.prototype.toString = new Proxy(Function.prototype.toString, {
    apply: function(target, that, args) {
      const result = target.apply(that, args);
      if (that === Function.prototype.toString) return 'function toString() { [native code] }';
      if (hasOwnProperty.call(that, 'webdriver') || hasOwnProperty.call(that, 'plugins') || hasOwnProperty.call(that, 'languages')) {
        return 'function get () { [native code] }';
      }
      return result;
    }
  });
  
  // Canvas fingerprinting protection (subtle noise)
  try {
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
      const imageData = origGetImageData.apply(this, arguments);
      if (w > 10 && h > 10) {
        for (let i = 0; i < 4; i++) {
          const idx = i * 4;
          imageData.data[idx] = (imageData.data[idx] + Math.floor(Math.random() * 2)) % 256;
        }
      }
      return imageData;
    };
  } catch(e) {}
  
  console.log('[ANTI-DETECT] Scripts injected successfully');
})();
`;
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { exec, execSync, spawn } = require('child_process');
const { notifyTelegram, editTelegram, config, NODE_ID } = require('./logger');
const proxyRelayState = {};         // { proxyIndex: { localPort, signature, startedAt, childPid } }
let activeBrowserProxyContext = null;
const PAY_REQUEST_PATH = '/tmp/pay_request.json';
let pressureBackoffUntilMs = 0;     // Node-level backoff after WAF/rate/connect pressure.
let globalWafPauseUntilMs = 0;       // Circuit breaker: pause polling when WAF blocks many different proxies.
const globalWafEvents = [];          // Recent WAF pressure observations: { at, reason, proxyIdx }.

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  STATE (mirrors Under V2 AtomicBoolean/AtomicLong)
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
let hadRateLimit429 = false;       // Р вЂРЎвЂ№Р В» Р В»Р С‘ 429 Р Р† РЎРЊРЎвЂљР С•Р в„– РЎРѓР ВµРЎРѓРЎРѓР С‘Р С‘
let consecutive403Count = 0;       // Р СџР С•Р Т‘РЎР‚РЎРЏР Т‘ 403 Р В±Р ВµР В· 429
let pausedUntilMs = 0;             // Р вЂќР С• Р С”Р В°Р С”Р С•Р С–Р С• Р Р†РЎР‚Р ВµР СР ВµР Р…Р С‘ (ms) Р С—Р В°РЎС“Р В·Р В° Р С—Р С•РЎРѓР В»Р Вµ РЎС“РЎРѓР С—Р ВµРЎвЂ¦Р В°
let calendarRequestCount = 0;      // Р РЋРЎвЂЎРЎвЂРЎвЂљРЎвЂЎР С‘Р С” Р В·Р В°Р С—РЎР‚Р С•РЎРѓР С•Р Р† getCalendarsMonth
let calendar429Count = 0;          // Р РЋРЎвЂЎРЎвЂРЎвЂљРЎвЂЎР С‘Р С” 429 Р С•РЎвЂљР Р†Р ВµРЎвЂљР С•Р Р† Р С•РЎвЂљ Р С”Р В°Р В»Р ВµР Р…Р Т‘Р В°РЎР‚РЎРЏ (Р Р…Р ВµР В·Р В°Р Р†Р С‘РЎРѓР С‘Р СРЎвЂ№Р в„–)
let isTestProbe = false;           // Р В¤Р В»Р В°Р С–: РЎвЂљР ВµР С”РЎС“РЎвЂ°Р С‘Р в„– РЎвЂ Р С‘Р С”Р В» РІР‚вЂќ РЎвЂљР ВµРЎРѓРЎвЂљР С•Р Р†РЎвЂ№Р в„– Р С—РЎР‚Р С•РЎРѓРЎвЂљРЎР‚Р ВµР В» Р Р†Р С• Р Р†РЎР‚Р ВµР СРЎРЏ Р В±Р В°Р Р…Р В° (РЎвЂљР С•Р В»РЎРЉР С”Р С• calendar, Р СњР вЂў cart)

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  HOLD MODE: catch-and-release РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘Р Вµ
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
let holdModeActive = false;         // Р С’Р С”РЎвЂљР С‘Р Р†Р ВµР Р… Р В»Р С‘ hold mode Р С—РЎР‚РЎРЏР СР С• РЎРѓР ВµР в„–РЎвЂЎР В°РЎРѓ (Р В±Р С‘Р В»Р ВµРЎвЂљРЎвЂ№ Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ)
let holdModeSlotInfo = null;        // Р ВР Р…РЎвЂћР С•РЎР‚Р СР В°РЎвЂ Р С‘РЎРЏ Р С• Р В·Р В°РЎвЂ¦Р Р†Р В°РЎвЂЎР ВµР Р…Р Р…Р С•Р С РЎРѓР В»Р С•РЎвЂљР Вµ {slot, target, ticketInfo}
let payCommandReceived = false;     // Р В¤Р В»Р В°Р С–: Р С—Р С•Р В»РЎС“РЎвЂЎР ВµР Р…Р В° Р С”Р С•Р СР В°Р Р…Р Т‘Р В° /pay РІР‚вЂќ Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р С•Р Т‘ Р С” Р С•Р С—Р В»Р В°РЎвЂљР Вµ
let telegramBotInstance = null;     // Р В­Р С”Р В·Р ВµР СР С—Р В»РЎРЏРЎР‚ TelegramBot Р Т‘Р В»РЎРЏ Р С—РЎР‚Р С‘РЎвЂР СР В° Р С”Р С•Р СР В°Р Р…Р Т‘
let holdCycleCount = 0;             // Р РЋРЎвЂЎРЎвЂРЎвЂљРЎвЂЎР С‘Р С” РЎвЂ Р С‘Р С”Р В»Р С•Р Р† hold-and-recatch
let holdTelegramMsgId = null;       // ID РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘РЎРЏ Р Р† Telegram Р Т‘Р В»РЎРЏ РЎР‚Р ВµР Т‘Р В°Р С”РЎвЂљР С‘РЎР‚Р С•Р Р†Р В°Р Р…Р С‘РЎРЏ

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  CART ITEM TRACKING: Р Т‘Р В»РЎРЏ editcart + addtocart Р С—РЎР‚Р С‘ /pay
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
let cartItemsInfo = null;           // { interoDetailGuid, interoObjectGuid, interoQty, guideDetailGuid }
let payDialogActive = false;        // Р С›Р В¶Р С‘Р Т‘Р В°Р ВµР С Р В»Р С‘ Р С•РЎвЂљР Р†Р ВµРЎвЂљ Р С—Р С•Р В»РЎРЉР В·Р С•Р Р†Р В°РЎвЂљР ВµР В»РЎРЏ Р Р…Р В° Р Р†Р С•Р С—РЎР‚Р С•РЎРѓ "Р РЋР С”Р С•Р В»РЎРЉР С”Р С• Р Р…РЎС“Р В¶Р Р…Р С•?"
let payDialogOwnerId = null;         // Telegram user id that started the current /pay dialog.
let payDialogStartedAtMs = 0;        // Dialog TTL guard to avoid consuming unrelated numbers from group chat.
let payDesiredAdults = 0;           // Р вЂ“Р ВµР В»Р В°Р ВµР СР С•Р Вµ Р С”Р С•Р В»-Р Р†Р С• Р Р†Р В·РЎР‚Р С•РЎРѓР В»РЎвЂ№РЎвЂ¦
let payDesiredChildren = 0;         // Р вЂ“Р ВµР В»Р В°Р ВµР СР С•Р Вµ Р С”Р С•Р В»-Р Р†Р С• Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦
let payCheckoutOnly = false;        // Web concrete-search payment: open checkout without editcart.
let payPassengerDetails = null;     // Web payment participants/guide payload for set_extradata.
let paymentModifyInFlight = false;  // Prevent overlapping editcart attempts on the same held cart.
let paymentModifyRetryAtMs = 0;     // Cooldown after transient WAF/429 in modify flow.
let paymentModifyRetryReason = '';
let manualCheckoutParked = false;   // Once checkout is handed to the operator, stop polling on this profile.

/**
 * Р В¤Р С•РЎР‚Р СР С‘РЎР‚РЎС“Р ВµРЎвЂљ РЎвЂљР ВµР С”РЎРѓРЎвЂљ hold-РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘РЎРЏ Р Т‘Р В»РЎРЏ Telegram.
 * Р С›Р Т‘Р Р…Р С• РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ, Р С”Р С•РЎвЂљР С•РЎР‚Р С•Р Вµ РЎР‚Р ВµР Т‘Р В°Р С”РЎвЂљР С‘РЎР‚РЎС“Р ВµРЎвЂљРЎРѓРЎРЏ Р С—РЎР‚Р С‘ Р С”Р В°Р В¶Р Т‘Р С•Р С Р С‘Р В·Р СР ВµР Р…Р ВµР Р…Р С‘Р С‘ РЎРѓРЎвЂљР В°РЎвЂљРЎС“РЎРѓР В°.
 */
function buildHoldMessage(slotTime, ticketInfo, cycleNum, proxyIdx, status) {
  const statusEmoji = status === 'active' ? 'СЂСџСџСћ Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р в„–'
    : status === 'checkout' ? 'СЂСџвЂ™С– Р С›Р С—Р В»Р В°РЎвЂљР В°'
      : status === 'recatch' ? 'СЂСџвЂќвЂћ Re-catch...'
        : 'СЂСџвЂќТ‘ Р СњР ВµР В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р в„–';

  return `СЂСџР‹В« Р вЂР С‘Р В»Р ВµРЎвЂљРЎвЂ№\n` +
    `РІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓ\n` +
    `РІРЏВ° ${slotTime}\n` +
    `СЂСџР‹Сџ ${ticketInfo}\n` +
    `СЂСџРЉС’ Р СџРЎР‚Р С•Р С”РЎРѓР С‘: #${proxyIdx}\n` +
    `СЂСџвЂќвЂћ Р В¦Р С‘Р С”Р В»: #${cycleNum}\n` +
    `РІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓРІвЂќРѓ\n` +
    `СЂСџвЂњР‰ Р РЋРЎвЂљР В°РЎвЂљРЎС“РЎРѓ: ${statusEmoji}\n` +
    (status === 'active' ? `СЂСџвЂ™С– /pay РІР‚вЂќ Р С•Р С—Р В»Р В°РЎвЂљР С‘РЎвЂљРЎРЉ` : '');
}

const MIN_DYNAMIC_ADULTS = 8;
const MIN_PAYMENT_ADULTS = 0;
const MIN_PAYMENT_PARTICIPANTS = 8; // adults + children; guide is fixed +1, so total minimum is 9.
const GUIDE_PAYMENT_QTY = 1;
const CHILD_TICKET_OBJECT_GUID = 'aca413ae-b56d-490e-91f6-5474f17add63';
const CHILD_TICKET_OBJECT_TABLENAME = 'packetTypes';
const CHILD_TICKET_LABEL = 'Gratuito - Under 18';
const GUIDE_TICKET_LABEL = 'Guide turistiche con tesserino';
const PAYMENT_PASSENGER_AUTOFILL_ENABLED = false;
const CHECKOUT_LOGIN_PROXY_BYPASS_ENABLED = process.env.CHECKOUT_LOGIN_PROXY_BYPASS === '1'
  || config.proxyPool?.checkoutLoginProxyBypass === true;
const CHECKOUT_CLEAR_LOGIN_STATE_ENABLED = process.env.CHECKOUT_CLEAR_LOGIN_STATE !== '0'
  && config.proxyPool?.checkoutClearLoginState !== false;
const CHECKOUT_CLEAN_PROFILE_ENABLED = process.env.CHECKOUT_CLEAN_PROFILE !== '0'
  && config.proxyPool?.checkoutCleanProfile !== false;
const CHECKOUT_RELOAD_AFTER_LOGIN_ENABLED = process.env.CHECKOUT_RELOAD_AFTER_LOGIN !== '0'
  && config.proxyPool?.checkoutReloadAfterLogin !== false;
const MANUAL_CHECKOUT_MAX_MINUTES = Math.max(0, Number(process.env.MANUAL_CHECKOUT_MAX_MINUTES || config.proxyPool?.manualCheckoutMaxMinutes || 25));
const MANUAL_CHECKOUT_MAX_MS = MANUAL_CHECKOUT_MAX_MINUTES * 60 * 1000;
const SUPPLY_SIGNAL_REPEAT_MS = 120000;
const HOLD_CART_HEALTH_MIN_MS = 20000;
const HOLD_CART_HEALTH_MAX_MS = 30000;
const PAYMENT_MODIFY_RETRY_MIN_MS = 45000;
const PAYMENT_MODIFY_RETRY_MAX_MS = 75000;
const PROXY_BAN_RECHECK_BASE_MS = Math.max(60000, Number(process.env.PROXY_BAN_RECHECK_BASE_MS || config.proxyPool?.proxyBanRecheckBaseMs || 10 * 60 * 1000));
const PROXY_BAN_RECHECK_JITTER_MS = Math.max(0, Number(process.env.PROXY_BAN_RECHECK_JITTER_MS || config.proxyPool?.proxyBanRecheckJitterMs || 0));
const ALL_PROXIES_BANNED_SLEEP_MS = Math.max(60000, Number(process.env.ALL_PROXIES_BANNED_SLEEP_MS || config.proxyPool?.allProxiesBannedSleepMs || 10 * 60 * 1000));
const PROXY_BAN_FAST_PROBE_MIN_DELAY_MS = Math.max(0, Number(process.env.PROXY_BAN_FAST_PROBE_MIN_DELAY_MS || config.proxyPool?.proxyBanFastProbeMinDelayMs || 150));
const PROXY_BAN_FAST_PROBE_MAX_DELAY_MS = Math.max(PROXY_BAN_FAST_PROBE_MIN_DELAY_MS, Number(process.env.PROXY_BAN_FAST_PROBE_MAX_DELAY_MS || config.proxyPool?.proxyBanFastProbeMaxDelayMs || 350));
const ALL_PROXIES_BANNED_FAST_PROBE_ENABLED = process.env.ALL_PROXIES_BANNED_FAST_PROBE_ENABLED === '1'
  ? true
  : process.env.ALL_PROXIES_BANNED_FAST_PROBE_ENABLED === '0'
    ? false
    : config.proxyPool?.allProxiesBannedFastProbeEnabled !== false;
const ALL_PROXIES_BANNED_FAST_PROBE_ALL = process.env.ALL_PROXIES_BANNED_FAST_PROBE_ALL === '0'
  ? false
  : config.proxyPool?.allProxiesBannedFastProbeAll !== false;
const IN_BOT_PROXY_BAN_PROBES = process.env.IN_BOT_PROXY_BAN_PROBES === '1';
const WAF_PRESSURE_STATUS = 'waf_pressure';
const WAF_PRESSURE_COOLDOWN_MS = Math.max(0, Number(process.env.WAF_PRESSURE_COOLDOWN_MS || config.proxyPool?.wafPressureCooldownMs || 0));
const GLOBAL_WAF_CIRCUIT_ENABLED = process.env.GLOBAL_WAF_CIRCUIT_ENABLED === '0'
  ? false
  : config.proxyPool?.globalWafCircuitEnabled !== false;
const GLOBAL_WAF_WINDOW_MS = Math.max(60000, Number(process.env.GLOBAL_WAF_WINDOW_MS || config.proxyPool?.globalWafWindowMs || 10 * 60 * 1000));
const GLOBAL_WAF_DISTINCT_PROXY_LIMIT = Math.max(2, Number(process.env.GLOBAL_WAF_DISTINCT_PROXY_LIMIT || config.proxyPool?.globalWafDistinctProxyLimit || 4));
const GLOBAL_WAF_PAUSE_MS = Math.max(60000, Number(process.env.GLOBAL_WAF_PAUSE_MS || config.proxyPool?.globalWafPauseMs || 30 * 60 * 1000));
const PAGE_WAF_FAIL_CLOSED_ENABLED = process.env.PAGE_WAF_FAIL_CLOSED === '1'
  ? true
  : process.env.PAGE_WAF_FAIL_CLOSED === '0'
    ? false
    : config.proxyPool?.pageWafFailClosed === true;
const PAGE_WAF_FAIL_CLOSED_BACKOFF_MS = Math.max(60000, Number(process.env.PAGE_WAF_FAIL_CLOSED_BACKOFF_MS || config.proxyPool?.pageWafFailClosedBackoffMs || 30 * 60 * 1000));
const STATIC_CALENDAR_PAYLOAD_ENABLED = process.env.STATIC_CALENDAR_PAYLOAD === '1' || config.proxyPool?.staticCalendarPayloadEnabled === true;
const STATIC_CALENDAR_PAYLOAD_AFTER_WAF_ENABLED = process.env.STATIC_CALENDAR_PAYLOAD_AFTER_WAF === '1' || config.proxyPool?.staticCalendarPayloadAfterWaf === true;
const STATIC_CALENDAR_PAYLOAD_AFTER_PAGE_BLOCK_ENABLED = process.env.STATIC_CALENDAR_PAYLOAD_AFTER_PAGE_BLOCK === '1' || config.proxyPool?.staticCalendarPayloadAfterPageBlock === true;
const NEUTRALIZE_VISIBLE_WAF_PAGE = process.env.NEUTRALIZE_VISIBLE_WAF_PAGE === '0'
  ? false
  : config.proxyPool?.neutralizeVisibleWafPage !== false;
const RELAY_PORT_BASE = Math.max(1024, Number(process.env.RELAY_PORT_BASE || config.proxyPool?.relayPortBase || 20000));
const RELAY_PORT_STRIDE = Math.max(100, Number(process.env.RELAY_PORT_STRIDE || config.proxyPool?.relayPortStride || 1000));
const CALENDAR_429_COOLDOWN_MS = Math.max(0, Number(process.env.CALENDAR_429_COOLDOWN_MS || config.proxyPool?.calendar429CooldownMs || 0));
const CALENDAR_WAF_403_COOLDOWN_MS = Math.max(0, Number(process.env.CALENDAR_WAF_403_COOLDOWN_MS || config.proxyPool?.calendarWaf403CooldownMs || 30 * 60 * 1000));
const CALENDAR_BLACKLIST_ENABLED = process.env.CALENDAR_BLACKLIST_ENABLED === '0'
  ? false
  : config.proxyPool?.calendarBlacklistEnabled !== false;
const CALENDAR_BLACKLIST_BLOCK_MS = Math.max(CALENDAR_WAF_403_COOLDOWN_MS, Number(process.env.CALENDAR_BLACKLIST_BLOCK_MS || config.proxyPool?.calendarBlacklistBlockMs || CALENDAR_WAF_403_COOLDOWN_MS));
const CALENDAR_BLACKLIST_OCTO_NEGATIVE_MS = Math.max(CALENDAR_BLACKLIST_BLOCK_MS, Number(process.env.CALENDAR_BLACKLIST_OCTO_NEGATIVE_MS || config.proxyPool?.calendarBlacklistOctoNegativeMs || CALENDAR_BLACKLIST_BLOCK_MS));
const CALENDAR_BLACKLIST_GROUP_WINDOW_MS = Math.max(60000, Number(process.env.CALENDAR_BLACKLIST_GROUP_WINDOW_MS || config.proxyPool?.calendarBlacklistGroupWindowMs || 24 * 60 * 60 * 1000));
const CALENDAR_BLACKLIST_GROUP_BLOCK_MS = Math.max(CALENDAR_BLACKLIST_BLOCK_MS, Number(process.env.CALENDAR_BLACKLIST_GROUP_BLOCK_MS || config.proxyPool?.calendarBlacklistGroupBlockMs || CALENDAR_BLACKLIST_BLOCK_MS));
const CALENDAR_BLACKLIST_SUBNET_THRESHOLD = Math.max(0, Number(process.env.CALENDAR_BLACKLIST_SUBNET_THRESHOLD || config.proxyPool?.calendarBlacklistSubnetThreshold || 2));
const CALENDAR_BLACKLIST_ASN_THRESHOLD = Math.max(0, Number(process.env.CALENDAR_BLACKLIST_ASN_THRESHOLD || config.proxyPool?.calendarBlacklistAsnThreshold || 2));
const CALENDAR_BLACKLIST_STATE_FILE = String(process.env.CALENDAR_BLACKLIST_STATE_FILE || config.proxyPool?.calendarBlacklistStateFile || `/tmp/sniper-calendar-blacklist-node${NODE_ID}.json`).replace(/\$\{NODE_ID\}|%NODE_ID%/g, String(NODE_ID));
const CALENDAR_BLACKLIST_LOG_FILE = String(process.env.CALENDAR_BLACKLIST_LOG_FILE || config.proxyPool?.calendarBlacklistLogFile || 'calendar_blacklist.log').replace(/\$\{NODE_ID\}|%NODE_ID%/g, String(NODE_ID));
const CONNECT_FAIL_COOLDOWN_MS = Math.max(0, Number(process.env.CONNECT_FAIL_COOLDOWN_MS || config.proxyPool?.connectFailCooldownMs || 15 * 60 * 1000));
const PRESSURE_BACKOFF_MS = Math.max(0, Number(process.env.PRESSURE_BACKOFF_MS || config.proxyPool?.pressureBackoffMs || 0));
const LEGACY_CALENDAR_429_ROTATE_AFTER = Math.max(1, Number(process.env.LEGACY_CALENDAR_429_ROTATE_AFTER || config.proxyPool?.calendar429RotateAfter || 3));

const PROXY_PROFILE_ROOT = process.env.PROXY_PROFILE_ROOT || config.proxyPool?.proxyProfileRoot || '/root/chrome-user-data';
const SHARED_PROXY_POOL_ENABLED = String(config.proxyPool?.mode || '').toLowerCase() === 'shared_proxy_pool';
const SHARED_PROXY_SOURCE_FILE = config.proxyPool?.sourceFile || 'Webshare 2500 proxies.txt';
const SHARED_PROXY_SOURCE_PATH = path.isAbsolute(SHARED_PROXY_SOURCE_FILE)
  ? SHARED_PROXY_SOURCE_FILE
  : path.join(__dirname, '..', SHARED_PROXY_SOURCE_FILE);
const PROXY_LEASE_TIMEOUT_MS = Math.max(250, Number(process.env.PROXY_LEASE_TIMEOUT_MS || config.proxyPool?.leaseTimeoutMs || 1200));
const PROXY_LEASE_FAILURE_BACKOFF_MS = Math.max(1000, Number(process.env.PROXY_LEASE_FAILURE_BACKOFF_MS || 10000));
const PROXY_LEASE_WAIT_MIN_MS = Math.max(1000, Number(process.env.PROXY_LEASE_WAIT_MIN_MS || config.proxyPool?.leaseWaitMinMs || 2000));
const PROXY_LEASE_WAIT_MAX_MS = Math.max(PROXY_LEASE_WAIT_MIN_MS, Number(process.env.PROXY_LEASE_WAIT_MAX_MS || config.proxyPool?.leaseWaitMaxMs || 5000));
const PROXY_LEASE_REFRESH_INTERVAL_MS = Math.max(10000, Number(process.env.PROXY_LEASE_REFRESH_INTERVAL_MS || config.proxyPool?.leaseRefreshIntervalMs || 30000));
const PROXY_LEASE_ALLOW_LOCAL_FALLBACK = config.proxyPool?.allowLocalFallback === true || process.env.PROXY_LEASE_ALLOW_LOCAL_FALLBACK === '1';
const PREWARM_BEFORE_STRICT_SLOT_ENABLED = config.proxyPool?.prewarmBeforeStrictSlot !== false && process.env.PREWARM_BEFORE_STRICT_SLOT !== '0';
const PREWARM_BEFORE_STRICT_SLOT_MAX_ATTEMPTS = Math.max(0, Number(process.env.PREWARM_BEFORE_STRICT_SLOT_MAX_ATTEMPTS || config.proxyPool?.prewarmBeforeStrictSlotMaxAttempts || 1));
const PREWARM_BEFORE_STRICT_SLOT_MIN_MS = Math.max(3000, Number(process.env.PREWARM_BEFORE_STRICT_SLOT_MIN_MS || config.proxyPool?.prewarmBeforeStrictSlotMinMs || 7000));
const PREWARM_PAYLOAD_WAIT_MS = Math.max(3000, Number(process.env.PREWARM_PAYLOAD_WAIT_MS || config.proxyPool?.prewarmPayloadWaitMs || 12000));
let sharedProxyPoolCache = null;
let currentProxyLease = null;
let pendingProxyLeaseReleases = [];
let proxyLeaseUnavailableUntilMs = 0;
let proxyLeaseRefreshTimer = null;
let nextProxyBanProbeAtMs = 0;
let allProxiesBannedSleepUntilMs = 0;
let allProxiesBannedProbePending = false;
let lastBanStateDiskMtimeMs = 0;
let supplySignalBaselineReady = false;
const supplySignalState = new Map();

function isWafLikeText(value) {
  return /hosting provider ip address|you have received a 403|you have been blocked|octofence|cloudflare|cf-ray|block_style|http error 403|access denied|was denied/i.test(String(value || ''));
}

function isProxyConnectFailureText(currentUrl = '', title = '', snippet = '') {
  const value = `${currentUrl || ''} ${title || ''} ${snippet || ''}`.toLowerCase();
  return /chrome-error:\/\/chromewebdata|this site can.?t be reached|err_(proxy|tunnel|connection|timed_out|socks|name_not_resolved|address_unreachable)|proxy server|tunnel connection failed|connection timed out|net::err|socket hang up|econnreset|econnrefused|etimedout/.test(value);
}

function isCyclePressureStatus(status) {
  return status === 'hard_blocked'
    || status === 'rate_limited'
    || status === 'soft_blocked'
    || status === WAF_PRESSURE_STATUS;
}

function isConnectFailurePressureReason(reason) {
  return /connect_fail/i.test(String(reason || ''));
}

function isGuideTicketLabel(label) {
  const value = String(label || '');
  if (/pass\s+guide/i.test(value)) return false;
  return /guide turistiche con tesserino|accompagnatore|visita guidata/i.test(value);
}

function normalizeTariffLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isGuideTesserinoTicketLabel(label) {
  const normalized = normalizeTariffLabel(label);
  return normalized === normalizeTariffLabel(GUIDE_TICKET_LABEL)
    || /guide turistiche con tesserino/i.test(String(label || ''));
}

function normalizeTariffGuid(value) {
  return String(value || '').trim().toLowerCase();
}

function getTariffLabel(tariff) {
  return String(tariff?.label || tariff?.Label || tariff?.printLabel || tariff?.shortLabel || '');
}

function getTariffGuid(tariff) {
  return normalizeTariffGuid(tariff?.object_guid || tariff?.guid || '');
}

function isChildTicketLabel(label) {
  const normalized = normalizeTariffLabel(label);
  return /under\s*18|under18|u18|child|children|kid|ragazz|bambin|minorenni|minori/.test(normalized);
}

function isAdultTicketLabel(label) {
  const normalized = normalizeTariffLabel(label);
  return /intero|adult|full|standard|ordinario/.test(normalized) && !isChildTicketLabel(normalized) && !isGuideTicketLabel(normalized);
}

function isCurrentChildTariff(tariff) {
  const guid = getTariffGuid(tariff);
  if (guid && guid === CHILD_TICKET_OBJECT_GUID) return true;
  const label = normalizeTariffLabel(getTariffLabel(tariff));
  return label === normalizeTariffLabel(CHILD_TICKET_LABEL) || isChildTicketLabel(label);
}

function getTariffObjectTablename(tariff) {
  return tariff?.object_tablename || tariff?.tablename || (isCurrentChildTariff(tariff) ? CHILD_TICKET_OBJECT_TABLENAME : 'packetTypes');
}

function tariffLabelMatchesRequested(tariffLabel, requestedLabel) {
  const tariff = normalizeTariffLabel(tariffLabel);
  const requested = normalizeTariffLabel(requestedLabel);
  if (!tariff || !requested) return false;
  if (tariff.includes(requested) || requested.includes(tariff)) return true;
  if (isGuideTesserinoTicketLabel(requested)) return isGuideTesserinoTicketLabel(tariff);
  if (isGuideTicketLabel(requested)) return isGuideTicketLabel(tariff);
  if (isChildTicketLabel(requested)) return isChildTicketLabel(tariff);
  if (isAdultTicketLabel(requested)) return isAdultTicketLabel(tariff);
  return false;
}

function findTariffForTicket(allTariffs, requestedLabel) {
  if (!Array.isArray(allTariffs)) return null;
  if (isChildTicketLabel(requestedLabel)) {
    return allTariffs.find(t => getTariffGuid(t) === CHILD_TICKET_OBJECT_GUID)
      || allTariffs.find(t => normalizeTariffLabel(getTariffLabel(t)) === normalizeTariffLabel(CHILD_TICKET_LABEL))
      || allTariffs.find(t => isChildTicketLabel(getTariffLabel(t)));
  }
  if (isGuideTesserinoTicketLabel(requestedLabel)) {
    return allTariffs.find(t => isGuideTesserinoTicketLabel(getTariffLabel(t))) || null;
  }
  return allTariffs.find(t => tariffLabelMatchesRequested(getTariffLabel(t), requestedLabel));
}

function toOptionalInt(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSlotCapacityValue(slot, fallback = '999') {
  const parsed = toOptionalInt(slot?.capacity ?? slot?.available ?? slot?.free ?? slot?.places ?? slot?.seats);
  if (parsed !== null) return parsed;
  return toOptionalInt(fallback) ?? 0;
}

function getSlotOriginalCapacityValue(slot, fallback = null) {
  const parsed = toOptionalInt(slot?.originalCapacity ?? slot?.original_capacity ?? slot?.initialCapacity ?? slot?.totalCapacity);
  if (parsed !== null) return parsed;
  return fallback === null ? null : (toOptionalInt(fallback) ?? 0);
}

function formatSlotCapacityMeta(slot) {
  const capacity = getSlotCapacityValue(slot, '0');
  const originalCapacity = getSlotOriginalCapacityValue(slot, null);
  return originalCapacity === null
    ? `capacity=${capacity}`
    : `capacity=${capacity}, originalCapacity=${originalCapacity}`;
}

function hasPendingPaymentModification() {
  return payDesiredAdults > 0 || payDesiredChildren > 0 || (PAYMENT_PASSENGER_AUTOFILL_ENABLED && !!payPassengerDetails);
}

function getPaymentModifyRetryRemainingMs() {
  return Math.max(0, paymentModifyRetryAtMs - Date.now());
}

function clearPaymentModifyRetryWindow() {
  paymentModifyRetryAtMs = 0;
  paymentModifyRetryReason = '';
}

function schedulePaymentModifyRetry(reason, delayMs = null) {
  const nextDelayMs = Number.isFinite(delayMs) && delayMs > 0
    ? delayMs
    : randomInt(PAYMENT_MODIFY_RETRY_MIN_MS, PAYMENT_MODIFY_RETRY_MAX_MS);
  const nextAt = Date.now() + nextDelayMs;
  if (nextAt > paymentModifyRetryAtMs) {
    paymentModifyRetryAtMs = nextAt;
    paymentModifyRetryReason = reason || 'unknown';
  }
  return getPaymentModifyRetryRemainingMs();
}

function isRetryableCartMutation(status, text = '') {
  const httpStatus = Number(status) || 0;
  const body = String(text || '');
  return [0, 403, 429, 500, 502, 503, 504].includes(httpStatus)
    || /octofence|rate limit|block_style|too many requests/i.test(body);
}

function isWafOrRateLimitedCartMutation(status, text = '') {
  const httpStatus = Number(status) || 0;
  const body = String(text || '');
  return [403, 429].includes(httpStatus)
    || /octofence|rate limit|block_style|too many requests|waf|blocked/i.test(body);
}

function shouldDeferPaymentModification() {
  return paymentModifyInFlight || getPaymentModifyRetryRemainingMs() > 0;
}

function logPaymentModifyDeferred(reason, adults, children, extra = '') {
  const retryInMs = getPaymentModifyRetryRemainingMs();
  const extraSuffix = extra ? ` ${extra}` : '';
  log('PAYMENT', `[PAYMENT] cart_modify_deferred adults=${adults || 0} children=${children || 0} guide=${getCartItemsGuideQty(cartItemsInfo)} reason=${reason || 'cooldown'} retry_in_ms=${retryInMs}${extraSuffix}`);
  return retryInMs;
}

function getSupplySignalKey(slot) {
  return String(slot?.startDateTime || slot?.period_id || '').trim();
}

function shouldLogSupplySignal(slot, reason) {
  const key = getSupplySignalKey(slot);
  if (!key) return false;

  const now = Date.now();
  const capacity = getSlotCapacityValue(slot, '0');
  const originalCapacity = getSlotOriginalCapacityValue(slot, null);
  const previous = supplySignalState.get(key) || null;
  const lastLoggedAt = previous?.lastLoggedAt || 0;
  const next = {
    capacity,
    originalCapacity,
    lastSeenAt: now,
    lastLoggedAt
  };

  let changed = false;
  if (reason === 'capacity') {
    const previousCapacity = Number(previous?.capacity || 0) || 0;
    changed = capacity > 0 && (!previous || previousCapacity <= 0 || capacity > previousCapacity);
  } else {
    const previousOriginal = previous?.originalCapacity;
    changed = originalCapacity !== null
      && originalCapacity > 0
      && (!previous || previousOriginal === null || previousOriginal === undefined || Number(previousOriginal) <= 0 || Number(previousOriginal) !== originalCapacity);
  }

  const shouldLog = supplySignalBaselineReady && changed && (now - lastLoggedAt >= SUPPLY_SIGNAL_REPEAT_MS);
  if (shouldLog) next.lastLoggedAt = now;
  supplySignalState.set(key, next);
  return shouldLog;
}

function armSupplySignalBaseline() {
  if (supplySignalBaselineReady) return;
  supplySignalBaselineReady = true;
  log('SUPPLY', '[CAPACITY] supply_signal_baseline_ready log_only=true');
}

function formatTicketInfo(tickets = []) {
  return tickets
    .filter(ticket => (Number(ticket.quantity) || 0) > 0)
    .map(ticket => `${ticket.quantity}x ${ticket.label}`)
    .join(', ');
}

function getTicketSearchMode(target) {
  const mode = String(target?.ticketSearchMode || target?.ticket_search_mode || '').trim().toLowerCase();
  return mode === 'concrete' ? 'concrete' : 'dynamic';
}

function sumTicketQty(tickets = [], predicate = () => true) {
  return (Array.isArray(tickets) ? tickets : []).reduce((sum, ticket) => {
    const qty = Number(ticket?.quantity) || 0;
    return predicate(ticket) ? sum + Math.max(0, qty) : sum;
  }, 0);
}

function getTicketCompositionFromTickets(tickets = []) {
  const sourceTickets = Array.isArray(tickets) ? tickets : [];
  const adults = sumTicketQty(sourceTickets, ticket => isAdultTicketLabel(ticket?.label));
  const children = sumTicketQty(sourceTickets, ticket => isChildTicketLabel(ticket?.label) && !isGuideTicketLabel(ticket?.label));
  const guide = sumTicketQty(sourceTickets, ticket => isGuideTicketLabel(ticket?.label));
  const nonGuide = sumTicketQty(sourceTickets, ticket => !isGuideTicketLabel(ticket?.label));
  return {
    adults,
    children,
    guide,
    nonGuide,
    total: nonGuide + guide
  };
}

function getCartItemsAdultQty(info) {
  return Math.max(0, Number(info?.adultQty ?? info?.interoQty ?? 0) || 0);
}

function getCartItemsChildQty(info) {
  return Math.max(0, Number(info?.childQty ?? 0) || 0);
}

function getCartItemsGuideQty(info) {
  return Math.max(0, Number(info?.guideQty ?? 0) || 0);
}

function getCartItemsNonGuideQty(info) {
  return getCartItemsAdultQty(info) + getCartItemsChildQty(info);
}

function cartMatchesRequestedComposition(info, adults, children, expectedGuideQty = getCartItemsGuideQty(info)) {
  return getCartItemsAdultQty(info) === adults
    && getCartItemsChildQty(info) === children
    && getCartItemsGuideQty(info) === Math.max(0, Number(expectedGuideQty) || 0);
}

function getTicketStrategy(target) {
  const sourceTickets = Array.isArray(target?.tickets)
    ? target.tickets.map(ticket => ({ ...ticket, quantity: Number(ticket.quantity) || 0 }))
    : [];
  const guideTickets = sourceTickets.filter(ticket => isGuideTicketLabel(ticket.label));
  const paidTickets = sourceTickets.filter(ticket => !isGuideTicketLabel(ticket.label));
  const guideQty = guideTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
  const maxPaidQty = paidTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
  const maxTotalQty = sourceTickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
  const ticketSearchMode = getTicketSearchMode(target);
  const dynamicGroupEnabled = ticketSearchMode !== 'concrete'
    && target?.type === 'group'
    && guideQty > 0
    && maxPaidQty >= MIN_DYNAMIC_ADULTS
    && paidTickets.length > 0;
  const dynamicIndividualEnabled = ticketSearchMode !== 'concrete'
    && target?.type === 'individual'
    && guideQty === 0
    && maxPaidQty > 0
    && paidTickets.length > 0;
  const dynamicAdultsEnabled = dynamicGroupEnabled || dynamicIndividualEnabled;
  const minPaidQty = dynamicGroupEnabled ? MIN_DYNAMIC_ADULTS : (dynamicIndividualEnabled ? 1 : maxPaidQty);
  const minTotalQty = dynamicAdultsEnabled ? minPaidQty + guideQty : maxTotalQty;

  return {
    sourceTickets,
    paidTickets,
    guideQty,
    ticketSearchMode,
    concreteTicketSearch: ticketSearchMode === 'concrete',
    minPaidQty,
    maxPaidQty,
    minTotalQty,
    maxTotalQty,
    dynamicAdultsEnabled
  };
}

function buildTicketPlan(target, capacityInput) {
  const strategy = getTicketStrategy(target);
  const capacity = Number.isFinite(Number(capacityInput)) ? Number(capacityInput) : strategy.maxTotalQty;

  if (!strategy.sourceTickets.length) {
    return { ok: false, capacity, ...strategy };
  }

  if (!strategy.dynamicAdultsEnabled) {
    if (capacity < strategy.maxTotalQty) {
      return {
        ok: false,
        capacity,
        plannedPaidQty: strategy.maxPaidQty,
        plannedTotalQty: strategy.maxTotalQty,
        ...strategy
      };
    }

    const tickets = strategy.sourceTickets
      .filter(ticket => ticket.quantity > 0)
      .map(ticket => ({ ...ticket }));
    const composition = getTicketCompositionFromTickets(tickets);

    return {
      ok: true,
      capacity,
      tickets,
      adultsRequested: composition.adults,
      childrenRequested: composition.children,
      nonGuideRequested: composition.nonGuide,
      guidesRequested: strategy.guideQty,
      totalRequested: strategy.maxTotalQty,
      ticketInfo: formatTicketInfo(tickets),
      ...strategy
    };
  }

  const plannedPaidQty = Math.min(strategy.maxPaidQty, Math.max(0, capacity - strategy.guideQty));
  if (plannedPaidQty < strategy.minPaidQty) {
    return {
      ok: false,
      capacity,
      plannedPaidQty,
      plannedTotalQty: plannedPaidQty + strategy.guideQty,
      ...strategy
    };
  }

  let remainingPaid = plannedPaidQty;
  const tickets = [];
  for (const ticket of strategy.sourceTickets) {
    if (ticket.quantity <= 0) continue;

    if (isGuideTicketLabel(ticket.label)) {
      tickets.push({ ...ticket });
      continue;
    }

    if (remainingPaid <= 0) continue;
    const actualQty = Math.min(ticket.quantity, remainingPaid);
    if (actualQty > 0) {
      tickets.push({ ...ticket, quantity: actualQty });
      remainingPaid -= actualQty;
    }
  }

  const composition = getTicketCompositionFromTickets(tickets);
  const adultsRequested = composition.nonGuide;
  const totalRequested = adultsRequested + strategy.guideQty;

  return {
    ok: adultsRequested >= strategy.minPaidQty && totalRequested <= capacity,
    capacity,
    tickets,
    adultsRequested: composition.adults || adultsRequested,
    childrenRequested: composition.children,
    nonGuideRequested: composition.nonGuide,
    guidesRequested: strategy.guideQty,
    totalRequested,
    ticketInfo: formatTicketInfo(tickets),
    ...strategy
  };
}

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  HOLD RE-CATCH: Р С”Р С•Р Р…РЎРѓРЎвЂљР В°Р Р…РЎвЂљРЎвЂ№ Р СР С–Р Р…Р С•Р Р†Р ВµР Р…Р Р…Р С•Р С–Р С• Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р Р†Р В°РЎвЂљР В°
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
const PRE_LOAD_AHEAD_MS = 60000;     // Р вЂ”Р В° 60 РЎРѓР ВµР С” Р Т‘Р С• Р С”Р С•Р Р…РЎвЂ Р В° hold РІР‚вЂќ Р Р…Р В°РЎвЂЎР С‘Р Р…Р В°Р ВµР С Р С—РЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“
const RECATCH_MAX_ATTEMPTS = 60;     // Max re-catch attempts; each retry waits for this node's scheduler slot.
const RECATCH_MAX_DURATION_MS = 300000;

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  Р СџР В Р С›Р С™Р РЋР В-Р РЋР СћР вЂўР в„ўР Сћ: РЎР‚Р С•РЎвЂљР В°РЎвЂ Р С‘РЎРЏ РЎРѓ Р С‘Р В·Р С•Р В»РЎРЏРЎвЂ Р С‘Р ВµР в„– Р С—РЎР‚Р С•РЎвЂћР С‘Р В»Р ВµР в„–
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
let currentProxyIndex = 0;          // Р ВР Р…Р Т‘Р ВµР С”РЎРѓ РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР С–Р С• Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р Р† РЎРѓР С—Р С‘РЎРѓР С”Р Вµ Р Р…Р С•Р Т‘РЎвЂ№ (0-4)
let currentProxy = null;            // Р СћР ВµР С”РЎС“РЎвЂ°Р С‘Р в„– Р С•Р В±РЎР‰Р ВµР С”РЎвЂљ Р С—РЎР‚Р С•Р С”РЎРѓР С‘ {host, port, username, password}
let proxyBans = {};                 // { proxyIndex: bannedUntilMs } РІР‚вЂќ Р В±Р В°Р Р… Р С”Р В°Р В¶Р Т‘Р С•Р С–Р С• Р С—РЎР‚Р С•Р С”РЎРѓР С‘
let internal403Count = 0;           // Р РЋРЎвЂЎРЎвЂРЎвЂљРЎвЂЎР С‘Р С” Р С—Р С•Р Т‘РЎР‚РЎРЏР Т‘ Р Р†Р Р…РЎС“РЎвЂљРЎР‚Р ВµР Р…Р Р…Р С‘РЎвЂ¦ 403 Р Р…Р В° РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР С Р С—РЎР‚Р С•Р С”РЎРѓР С‘
let payloadMissCounts = {};         // { proxyIndex: count } РІР‚вЂќ Р С—Р С•Р Т‘РЎР‚РЎРЏР Т‘ Р Р…Р ВµРЎС“Р Т‘Р В°РЎвЂЎР Р…РЎвЂ№РЎвЂ¦ Р В·Р В°РЎвЂ¦Р Р†Р В°РЎвЂљР С•Р Р† calendar payload
let calendar429Streaks = {};        // { proxyIndex: count } consecutive calendar 429s on the same proxy
let calendarBlacklist = { version: 1, proxies: {}, ipBlocks: {}, subnetBlocks: {}, asnBlocks: {}, events: [] };
let lastCalendarBlacklistDiskMtimeMs = 0;

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  Р вЂР С’Р Сњ-Р РЋР СћР вЂўР в„ўР Сћ: РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎРЏР ВµРЎвЂљРЎРѓРЎРЏ Р Р…Р В° Р Т‘Р С‘РЎРѓР С” Р СР ВµР В¶Р Т‘РЎС“ Р С—Р ВµРЎР‚Р ВµР В·Р В°Р С—РЎС“РЎРѓР С”Р В°Р СР С‘
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
const BAN_STATE_FILE = `/tmp/sniper-proxy-bans-node${NODE_ID}.json`;

function normalizeCalendarBlacklistState(state) {
  const base = state && typeof state === 'object' ? state : {};
  return {
    version: 1,
    proxies: base.proxies && typeof base.proxies === 'object' ? base.proxies : {},
    ipBlocks: base.ipBlocks && typeof base.ipBlocks === 'object' ? base.ipBlocks : {},
    subnetBlocks: base.subnetBlocks && typeof base.subnetBlocks === 'object' ? base.subnetBlocks : {},
    asnBlocks: base.asnBlocks && typeof base.asnBlocks === 'object' ? base.asnBlocks : {},
    events: Array.isArray(base.events) ? base.events.slice(-1000) : [],
    processedLineHashes: Array.isArray(base.processedLineHashes) ? base.processedLineHashes.slice(-5000) : []
  };
}

function getProxyServer(proxy) {
  if (!proxy) return '';
  if (proxy.host && proxy.port) return `${proxy.host}:${proxy.port}`;
  if (proxy.server) return String(proxy.server);
  return '';
}

function getProxyHost(proxy) {
  if (!proxy) return '';
  if (proxy.host) return String(proxy.host);
  const server = getProxyServer(proxy);
  return server ? server.split(':')[0] : '';
}

function getIpv4Subnet24(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return '';
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return '';
  return `${nums[0]}.${nums[1]}.${nums[2]}.0/24`;
}

function normalizeAsnLabel(asn) {
  const value = String(asn || '').replace(/\s+/g, ' ').trim();
  return /^n\/?a$/i.test(value) ? '' : value;
}

function getCalendarBlacklistLogPath() {
  return path.isAbsolute(CALENDAR_BLACKLIST_LOG_FILE)
    ? CALENDAR_BLACKLIST_LOG_FILE
    : path.join(process.cwd(), CALENDAR_BLACKLIST_LOG_FILE);
}

function loadCalendarBlacklistState() {
  if (!CALENDAR_BLACKLIST_ENABLED) return false;
  try {
    if (!fs.existsSync(CALENDAR_BLACKLIST_STATE_FILE)) {
      calendarBlacklist = normalizeCalendarBlacklistState(calendarBlacklist);
      return false;
    }
    const stat = fs.statSync(CALENDAR_BLACKLIST_STATE_FILE);
    const parsed = JSON.parse(fs.readFileSync(CALENDAR_BLACKLIST_STATE_FILE, 'utf8'));
    calendarBlacklist = normalizeCalendarBlacklistState(parsed);
    lastCalendarBlacklistDiskMtimeMs = stat.mtimeMs;
    return true;
  } catch (error) {
    log('WARN', `[CALENDAR BLACKLIST] load failed: ${error.message}`);
    calendarBlacklist = normalizeCalendarBlacklistState(calendarBlacklist);
    return false;
  }
}

function saveCalendarBlacklistState() {
  if (!CALENDAR_BLACKLIST_ENABLED) return false;
  try {
    calendarBlacklist = normalizeCalendarBlacklistState(calendarBlacklist);
    const dir = path.dirname(CALENDAR_BLACKLIST_STATE_FILE);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    const tmpFile = `${CALENDAR_BLACKLIST_STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify({ ...calendarBlacklist, savedAt: Date.now() }), 'utf8');
    fs.renameSync(tmpFile, CALENDAR_BLACKLIST_STATE_FILE);
    try {
      lastCalendarBlacklistDiskMtimeMs = fs.statSync(CALENDAR_BLACKLIST_STATE_FILE).mtimeMs;
    } catch {}
    return true;
  } catch (error) {
    log('WARN', `[CALENDAR BLACKLIST] save failed: ${error.message}`);
    return false;
  }
}

function syncCalendarBlacklistStateFromDisk() {
  if (!CALENDAR_BLACKLIST_ENABLED) return false;
  try {
    if (!fs.existsSync(CALENDAR_BLACKLIST_STATE_FILE)) return false;
    const stat = fs.statSync(CALENDAR_BLACKLIST_STATE_FILE);
    if (stat.mtimeMs <= lastCalendarBlacklistDiskMtimeMs) return false;
    const parsed = JSON.parse(fs.readFileSync(CALENDAR_BLACKLIST_STATE_FILE, 'utf8'));
    calendarBlacklist = normalizeCalendarBlacklistState(parsed);
    lastCalendarBlacklistDiskMtimeMs = stat.mtimeMs;
    cleanupExpiredCalendarBlacklist(Date.now(), { save: false, log: true });
    return true;
  } catch (error) {
    log('WARN', `[CALENDAR BLACKLIST] sync failed: ${error.message}`);
    return false;
  }
}

function cleanupExpiredCalendarBlacklist(now = Date.now(), options = {}) {
  if (!CALENDAR_BLACKLIST_ENABLED) return false;
  calendarBlacklist = normalizeCalendarBlacklistState(calendarBlacklist);
  let changed = false;
  for (const groupName of ['proxies', 'ipBlocks', 'subnetBlocks', 'asnBlocks']) {
    const group = calendarBlacklist[groupName] || {};
    for (const [key, entry] of Object.entries(group)) {
      if (!entry || Number(entry.blockedUntil || 0) <= now) {
        delete group[key];
        changed = true;
      }
    }
  }
  const cutoff = now - CALENDAR_BLACKLIST_GROUP_WINDOW_MS;
  const oldLen = calendarBlacklist.events.length;
  calendarBlacklist.events = calendarBlacklist.events.filter((event) => Number(event.at || 0) >= cutoff).slice(-1000);
  if (calendarBlacklist.events.length !== oldLen) changed = true;
  if (changed && options.save !== false) saveCalendarBlacklistState();
  if (changed && options.log) log('PROXY', '[CALENDAR BLACKLIST] expired entries cleaned');
  return changed;
}

function getCalendarBlacklistEntryUntil(entry, now = Date.now()) {
  const until = Number(entry && entry.blockedUntil || 0);
  return until > now ? until : 0;
}

function getProxyCalendarBlacklistUntil(idx, proxy = null, now = Date.now()) {
  if (!CALENDAR_BLACKLIST_ENABLED) return 0;
  const resolvedProxy = proxy || getNodeProxies()[idx] || null;
  const proxyEntry = calendarBlacklist.proxies?.[String(idx)] || null;
  const ip = getProxyHost(resolvedProxy) || proxyEntry?.ip || '';
  const subnet = getIpv4Subnet24(ip);
  const asn = normalizeAsnLabel(resolvedProxy?.asn || proxyEntry?.asn || '');
  return Math.max(
    getCalendarBlacklistEntryUntil(proxyEntry, now),
    getCalendarBlacklistEntryUntil(ip ? calendarBlacklist.ipBlocks?.[ip] : null, now),
    getCalendarBlacklistEntryUntil(subnet ? calendarBlacklist.subnetBlocks?.[subnet] : null, now),
    getCalendarBlacklistEntryUntil(asn ? calendarBlacklist.asnBlocks?.[asn] : null, now)
  );
}

function appendCalendarBlacklistAudit(record) {
  try {
    const logPath = getCalendarBlacklistLogPath();
    const dir = path.dirname(logPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
  } catch (error) {
    log('WARN', `[CALENDAR BLACKLIST] audit write failed: ${error.message}`);
  }
}

function countRecentDistinctProxyEvents(field, value, now = Date.now()) {
  if (!field || !value) return 0;
  const cutoff = now - CALENDAR_BLACKLIST_GROUP_WINDOW_MS;
  const indexes = new Set();
  for (const event of calendarBlacklist.events || []) {
    if (Number(event.at || 0) < cutoff) continue;
    if (event[field] === value) indexes.add(String(event.proxyIndex));
  }
  return indexes.size;
}

function applyCalendarBlacklistGroupBlocks(event, now, blockedUntil) {
  let groupBlocked = false;
  if (CALENDAR_BLACKLIST_SUBNET_THRESHOLD > 0 && event.subnet) {
    const subnetCount = countRecentDistinctProxyEvents('subnet', event.subnet, now);
    if (subnetCount >= CALENDAR_BLACKLIST_SUBNET_THRESHOLD) {
      const until = Math.max(blockedUntil, now + CALENDAR_BLACKLIST_GROUP_BLOCK_MS);
      calendarBlacklist.subnetBlocks[event.subnet] = {
        blockedUntil: until,
        reason: 'calendar_waf_subnet_threshold',
        count: subnetCount,
        lastAt: now
      };
      for (const [idx, proxy] of getNodeProxies().entries()) {
        if (getIpv4Subnet24(getProxyHost(proxy)) === event.subnet) {
          proxyBans[idx] = Math.max(Number(proxyBans[idx] || 0), until);
        }
      }
      groupBlocked = true;
      log('WARN', `[CALENDAR BLACKLIST] subnet ${event.subnet} blocked count=${subnetCount} duration_min=${Math.ceil((until - now) / 60000)}`);
    }
  }

  if (CALENDAR_BLACKLIST_ASN_THRESHOLD > 0 && event.asn) {
    const asnCount = countRecentDistinctProxyEvents('asn', event.asn, now);
    if (asnCount >= CALENDAR_BLACKLIST_ASN_THRESHOLD) {
      const until = Math.max(blockedUntil, now + CALENDAR_BLACKLIST_GROUP_BLOCK_MS);
      calendarBlacklist.asnBlocks[event.asn] = {
        blockedUntil: until,
        reason: 'calendar_waf_asn_threshold',
        count: asnCount,
        lastAt: now
      };
      for (const [idx, entry] of Object.entries(calendarBlacklist.proxies || {})) {
        if (normalizeAsnLabel(entry.asn) === event.asn) {
          proxyBans[idx] = Math.max(Number(proxyBans[idx] || 0), until);
        }
      }
      groupBlocked = true;
      log('WARN', `[CALENDAR BLACKLIST] asn "${event.asn}" blocked count=${asnCount} duration_min=${Math.ceil((until - now) / 60000)}`);
    }
  }
  return groupBlocked;
}

function recordCalendarProxyBlacklist(reason, extra = {}) {
  if (!CALENDAR_BLACKLIST_ENABLED) return false;
  const outcome = String(reason || 'calendar_waf_403');
  if (!/calendar_waf_403|calendar_fetch_failed_after_page_waf/i.test(outcome)) return false;
  if (isSharedProxyPoolActiveForNode()) {
    // Shared pools should receive this through lease reports; local index bans would be misleading.
    return false;
  }

  const now = Date.now();
  cleanupExpiredCalendarBlacklist(now, { save: false });
  const proxies = getNodeProxies();
  const idx = currentProxyIndex;
  const proxy = proxies[idx] || currentProxy || null;
  const ip = getProxyHost(proxy);
  const proxyServer = getProxyServer(proxy);
  const subnet = getIpv4Subnet24(ip);
  const asn = normalizeAsnLabel(extra.asn || proxy?.asn || '');
  const ctx = extra.requestContext && typeof extra.requestContext === 'object' ? extra.requestContext : {};
  const octo = ctx.hasOctofenceCookie ? 'yes' : 'no';
  const php = ctx.hasPhpSession ? 'yes' : 'no';
  let durationMs = CALENDAR_BLACKLIST_BLOCK_MS;
  if (ctx.hasOctofenceCookie) durationMs = Math.max(durationMs, CALENDAR_BLACKLIST_OCTO_NEGATIVE_MS);
  if (/fetch_failed_after_page_waf/i.test(outcome)) durationMs = Math.max(durationMs, CALENDAR_BLACKLIST_OCTO_NEGATIVE_MS);

  const blockedUntil = now + durationMs;
  const proxyKey = String(idx);
  const event = {
    at: now,
    isoTime: new Date(now).toISOString(),
    nodeId: Number(NODE_ID),
    outcome,
    reason: outcome,
    proxyIndex: idx,
    proxyServer,
    ip,
    subnet,
    asn,
    mslc: extra.mslc || '',
    cache: extra.cache || '',
    octo,
    php,
    ref: ctx.referrer || '',
    origin: ctx.origin || '',
    pageUrl: ctx.pageUrl || '',
    readyState: ctx.readyState || '',
    blockedUntil,
    blockedUntilIso: new Date(blockedUntil).toISOString(),
    durationMs
  };

  calendarBlacklist.proxies[proxyKey] = {
    proxyIndex: idx,
    proxyServer,
    ip,
    subnet,
    asn,
    lastOutcome: outcome,
    lastAt: now,
    blockedUntil: Math.max(Number(calendarBlacklist.proxies[proxyKey]?.blockedUntil || 0), blockedUntil),
    octo,
    php,
    ref: event.ref,
    count: Number(calendarBlacklist.proxies[proxyKey]?.count || 0) + 1
  };
  if (ip) {
    calendarBlacklist.ipBlocks[ip] = {
      blockedUntil: Math.max(Number(calendarBlacklist.ipBlocks[ip]?.blockedUntil || 0), blockedUntil),
      reason: outcome,
      proxyIndex: idx,
      asn,
      lastAt: now
    };
  }
  calendarBlacklist.events.push(event);
  calendarBlacklist.events = calendarBlacklist.events.slice(-1000);

  proxyBans[idx] = Math.max(Number(proxyBans[idx] || 0), blockedUntil);
  applyCalendarBlacklistGroupBlocks(event, now, blockedUntil);
  saveCalendarBlacklistState();
  appendCalendarBlacklistAudit(event);
  log('WARN', `[CALENDAR BLACKLIST] proxy #${idx} ip=${ip || 'n/a'} outcome=${outcome} octo=${octo} php=${php} asn="${asn || 'n/a'}" duration_min=${Math.ceil(durationMs / 60000)}`);
  return true;
}

function loadBanState() {
  try {
    loadCalendarBlacklistState();
    cleanupExpiredCalendarBlacklist(Date.now(), { save: true });
    if (fs.existsSync(BAN_STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(BAN_STATE_FILE, 'utf8'));
      try {
        lastBanStateDiskMtimeMs = fs.statSync(BAN_STATE_FILE).mtimeMs;
      } catch {}
      // Р вЂ”Р В°Р С–РЎР‚РЎС“Р В¶Р В°Р ВµР С per-proxy Р В±Р В°Р Р…РЎвЂ№
      if (isSharedProxyPoolActiveForNode()) {
        proxyBans = {};
        if (saved.currentProxyIndex !== undefined) {
          currentProxyIndex = saved.currentProxyIndex;
          console.log(`[STARTUP] shared_proxy_pool last proxy index: #${currentProxyIndex}`);
        }
        return;
      }
      if (saved.proxyBans) {
        const now = Date.now();
        for (const [idx, banMs] of Object.entries(saved.proxyBans)) {
          if (banMs > now) {
            proxyBans[idx] = banMs;
            const remainingMin = Math.ceil((banMs - now) / 60000);
            console.log(`[STARTUP] РІС™В РїС‘РЏ  Р СџРЎР‚Р С•Р С”РЎРѓР С‘ #${idx} Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…! Р С›РЎРѓРЎвЂљР В°Р В»Р С•РЎРѓРЎРЉ ~${remainingMin} Р СР С‘Р Р….`);
          }
        }
      }
      if (saved.currentProxyIndex !== undefined) {
        currentProxyIndex = saved.currentProxyIndex;
        console.log(`[STARTUP] СЂСџРЉС’ Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…Р С‘Р в„– Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘: #${currentProxyIndex}`);
      }
      if (saved.calendarRequestCount && saved.calendarRequestCount > 0) {
        calendarRequestCount = saved.calendarRequestCount;
        console.log(`[STARTUP] СЂСџвЂњР‰ Р РЋРЎвЂЎРЎвЂРЎвЂљРЎвЂЎР С‘Р С” Р В·Р В°Р С—РЎР‚Р С•РЎРѓР С•Р Р† Р С”Р В°Р В»Р ВµР Р…Р Т‘Р В°РЎР‚РЎРЏ: ${calendarRequestCount}/48 (Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р ВµР Р… РЎРѓ Р Т‘Р С‘РЎРѓР С”Р В°)`);
      }
    }
  } catch (e) { /* Р С‘Р С–Р Р…Р С•РЎР‚Р С‘РЎР‚РЎС“Р ВµР С Р С•РЎв‚¬Р С‘Р В±Р С”Р С‘ РЎвЂЎРЎвЂљР ВµР Р…Р С‘РЎРЏ */ }
}

function saveBanState() {
  try {
    const sharedProxyPool = isSharedProxyPoolActiveForNode();
    if (sharedProxyPool) {
      proxyBans = {};
    }
    try {
      if (!sharedProxyPool && fs.existsSync(BAN_STATE_FILE)) {
        const stat = fs.statSync(BAN_STATE_FILE);
        if (stat.mtimeMs > lastBanStateDiskMtimeMs) {
          const diskState = JSON.parse(fs.readFileSync(BAN_STATE_FILE, 'utf8'));
          const diskBans = diskState && diskState.proxyBans && typeof diskState.proxyBans === 'object' ? diskState.proxyBans : {};
          const clearedBans = diskState && diskState.clearedBans && typeof diskState.clearedBans === 'object' ? diskState.clearedBans : {};
          const now = Date.now();

          for (const [idx, banUntil] of Object.entries(diskBans)) {
            if (Number(banUntil) > now) proxyBans[idx] = banUntil;
          }

          for (const idx of Object.keys(proxyBans)) {
            const memoryBanUntil = Number(proxyBans[idx] || 0);
            const cleared = clearedBans[idx];
            if (memoryBanUntil <= now || (cleared && Number(cleared.banUntil || 0) === memoryBanUntil)) {
              delete proxyBans[idx];
              delete payloadMissCounts[idx];
              delete calendar429Streaks[idx];
            }
          }
          lastBanStateDiskMtimeMs = stat.mtimeMs;
        }
      }
    } catch {}

    const nextBanState = JSON.stringify({
      proxyBans, currentProxyIndex, calendarRequestCount, savedAt: Date.now()
    });
    const tmpBanStateFile = `${BAN_STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpBanStateFile, nextBanState, 'utf8');
    fs.renameSync(tmpBanStateFile, BAN_STATE_FILE);
    try {
      lastBanStateDiskMtimeMs = fs.statSync(BAN_STATE_FILE).mtimeMs;
    } catch {}
  } catch (e) { /* Р С‘Р С–Р Р…Р С•РЎР‚Р С‘РЎР‚РЎС“Р ВµР С Р С•РЎв‚¬Р С‘Р В±Р С”Р С‘ Р В·Р В°Р С—Р С‘РЎРѓР С‘ */ }
}

function syncProxyBanStateFromDisk() {
  try {
    syncCalendarBlacklistStateFromDisk();
    cleanupExpiredCalendarBlacklist(Date.now(), { save: true });
    if (isSharedProxyPoolActiveForNode()) {
      proxyBans = {};
      return false;
    }
    if (!fs.existsSync(BAN_STATE_FILE)) return false;
    const stat = fs.statSync(BAN_STATE_FILE);
    if (stat.mtimeMs <= lastBanStateDiskMtimeMs) return false;

    const saved = JSON.parse(fs.readFileSync(BAN_STATE_FILE, 'utf8'));
    const diskBans = saved && saved.proxyBans && typeof saved.proxyBans === 'object' ? saved.proxyBans : {};
    const clearedBans = saved && saved.clearedBans && typeof saved.clearedBans === 'object' ? saved.clearedBans : {};
    const now = Date.now();
    let changed = false;

    for (const [idx, banUntil] of Object.entries(diskBans)) {
      if (Number(banUntil) > now && proxyBans[idx] !== banUntil) {
        proxyBans[idx] = banUntil;
        changed = true;
      }
    }

    for (const idx of Object.keys(proxyBans)) {
      const memoryBanUntil = Number(proxyBans[idx] || 0);
      const diskBanUntil = Number(diskBans[idx] || 0);
      const cleared = clearedBans[idx];
      const clearedSameBan = cleared && Number(cleared.banUntil || 0) === memoryBanUntil;
      if (memoryBanUntil <= now || clearedSameBan || (diskBanUntil > 0 && diskBanUntil <= now)) {
        delete proxyBans[idx];
        delete payloadMissCounts[idx];
        delete calendar429Streaks[idx];
        changed = true;
        log('OK', `[PROXY BAN] proxy #${idx} unbanned by ${clearedSameBan ? 'external checker' : 'expiry'}`);
      }
    }

    lastBanStateDiskMtimeMs = stat.mtimeMs;
    return changed;
  } catch (error) {
    log('WARN', `[PROXY BAN] state sync failed: ${error.message}`);
    return false;
  }
}

function clearProxyBan(proxyIdx) {
  delete proxyBans[proxyIdx];
  if (calendarBlacklist.proxies) delete calendarBlacklist.proxies[String(proxyIdx)];
  delete calendar429Streaks[proxyIdx];
  saveCalendarBlacklistState();
  saveBanState();
}

function clearAllProxyBans() {
  proxyBans = {};
  calendarBlacklist = normalizeCalendarBlacklistState({});
  calendar429Streaks = {};
  saveCalendarBlacklistState();
  saveBanState();
}

function quarantineCurrentProxy(reason, durationMs) {
  if (isSharedProxyPoolActiveForNode()) return false;
  const proxies = getNodeProxies();
  if (!proxies.length || !Number.isFinite(durationMs) || durationMs <= 0) return false;

  const idx = currentProxyIndex;
  const until = Date.now() + durationMs;
  proxyBans[idx] = Math.max(Number(proxyBans[idx] || 0), until);
  delete payloadMissCounts[idx];
  delete calendar429Streaks[idx];
  if (!nextProxyBanProbeAtMs || nextProxyBanProbeAtMs <= Date.now()) {
    scheduleNextProxyBanProbe(Date.now(), false);
  }
  log('WARN', `[PROXY BAN] cooldown proxy #${idx} reason=${reason || 'pressure'} duration_min=${Math.ceil(durationMs / 60000)}`);
  return true;
}

function schedulePressureBackoff(reason, durationMs = PRESSURE_BACKOFF_MS) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
  const until = Date.now() + durationMs;
  if (until > pressureBackoffUntilMs) {
    pressureBackoffUntilMs = until;
  }
  log('WARN', `[PRESSURE] node backoff reason=${reason || 'pressure'} duration_sec=${Math.ceil(durationMs / 1000)}`);
  return true;
}

function recordGlobalWafPressure(reason, proxyIdx) {
  const now = Date.now();
  const normalizedReason = String(reason || 'waf_pressure');
  const normalizedProxyIdx = Number.isFinite(Number(proxyIdx)) ? Number(proxyIdx) : -1;
  globalWafEvents.push({ at: now, reason: normalizedReason, proxyIdx: normalizedProxyIdx });
  while (globalWafEvents.length && now - globalWafEvents[0].at > GLOBAL_WAF_WINDOW_MS) {
    globalWafEvents.shift();
  }
  const distinctProxies = new Set(globalWafEvents.map(event => event.proxyIdx)).size;
  if (GLOBAL_WAF_CIRCUIT_ENABLED && distinctProxies >= GLOBAL_WAF_DISTINCT_PROXY_LIMIT) {
    const until = now + GLOBAL_WAF_PAUSE_MS;
    if (until > globalWafPauseUntilMs) {
      globalWafPauseUntilMs = until;
      log('WARN', `[WAF] global circuit breaker activated reason=${normalizedReason} distinct_proxies=${distinctProxies}/${GLOBAL_WAF_DISTINCT_PROXY_LIMIT} pause_sec=${Math.ceil(GLOBAL_WAF_PAUSE_MS / 1000)}`);
    }
  }
  return { distinctProxies, pauseUntilMs: globalWafPauseUntilMs };
}

function isGlobalWafPauseActive(now = Date.now()) {
  return GLOBAL_WAF_CIRCUIT_ENABLED && globalWafPauseUntilMs > now;
}

function getGlobalWafPauseRemainingMs(now = Date.now()) {
  return Math.max(0, globalWafPauseUntilMs - now);
}

function scheduleNextProxyBanProbe(now = Date.now(), immediate = false) {
  const jitter = Math.floor(Math.random() * PROXY_BAN_RECHECK_JITTER_MS);
  nextProxyBanProbeAtMs = now + (immediate ? jitter : PROXY_BAN_RECHECK_BASE_MS + jitter);
  return nextProxyBanProbeAtMs;
}

function cleanupExpiredProxyBans(now = Date.now(), options = {}) {
  if (isSharedProxyPoolActiveForNode()) {
    const hadLocalBans = Object.keys(proxyBans || {}).length > 0;
    if (hadLocalBans) {
      proxyBans = {};
      calendar429Streaks = {};
      saveBanState();
      if (options.log !== false) log('PROXY', '[PROXY BAN] shared_proxy_pool ignores and clears local proxy bans');
    }
    return hadLocalBans;
  }
  const proxies = getNodeProxies();
  let changed = false;
  cleanupExpiredCalendarBlacklist(now, { save: true, log: options.log !== false });

  for (let idx = 0; idx < proxies.length; idx++) {
    const banUntil = proxyBans[idx] || 0;
    if (banUntil && banUntil <= now) {
      delete proxyBans[idx];
      delete payloadMissCounts[idx];
      delete calendar429Streaks[idx];
      changed = true;
      if (options.log !== false) {
        log('OK', `[PROXY BAN] expired proxy #${idx}, cleared`);
      }
    }
  }

  for (const key of Object.keys(proxyBans)) {
    const idx = parseInt(key, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= proxies.length) {
      delete proxyBans[key];
      changed = true;
    }
  }

  if (changed) saveBanState();
  return changed;
}

function getActiveProxyBanIndexes(now = Date.now()) {
  if (isSharedProxyPoolActiveForNode()) return [];
  const proxies = getNodeProxies();
  const banned = [];
  cleanupExpiredCalendarBlacklist(now, { save: true });

  for (let idx = 0; idx < proxies.length; idx++) {
    if (getProxyUnavailableUntil(idx, proxies[idx], now) > now) banned.push(idx);
  }

  return banned;
}

function getAllProxyIndexes() {
  return getNodeProxies().map((_, idx) => idx);
}

function areAllProxiesBanned(now = Date.now()) {
  if (isSharedProxyPoolActiveForNode()) return false;
  const proxies = getNodeProxies();
  return proxies.length > 0 && getActiveProxyBanIndexes(now).length >= proxies.length;
}

function scheduleAllProxiesBannedSleep(now = Date.now(), reason = 'all_proxies_banned') {
  const until = now + ALL_PROXIES_BANNED_SLEEP_MS;
  if (allProxiesBannedSleepUntilMs > now) return allProxiesBannedSleepUntilMs;
  allProxiesBannedSleepUntilMs = until;
  allProxiesBannedProbePending = true;
  nextProxyBanProbeAtMs = until;
  log('WARN', `[PROXY BAN] all proxies banned; sleep_sec=${Math.ceil(ALL_PROXIES_BANNED_SLEEP_MS / 1000)} fast_probe=${ALL_PROXIES_BANNED_FAST_PROBE_ENABLED ? 'enabled' : 'disabled'} reason=${reason}`);
  return until;
}

function clearAllProxiesBannedSleep(reason = 'cleared') {
  if (allProxiesBannedSleepUntilMs > 0 || allProxiesBannedProbePending) {
    log('OK', `[PROXY BAN] all-proxies sleep cleared reason=${reason}`);
  }
  allProxiesBannedSleepUntilMs = 0;
  allProxiesBannedProbePending = false;
}

function getProxyBanProbeState(now = Date.now()) {
  cleanupExpiredProxyBans(now);
  const banned = getActiveProxyBanIndexes(now);

  if (banned.length === 0) {
    nextProxyBanProbeAtMs = 0;
    return { due: false, banned, waitMs: 0 };
  }

  if (!nextProxyBanProbeAtMs || nextProxyBanProbeAtMs <= 0) {
    scheduleNextProxyBanProbe(now, true);
  }

  return {
    due: now >= nextProxyBanProbeAtMs,
    banned,
    waitMs: Math.max(0, nextProxyBanProbeAtMs - now),
  };
}

function selectCurrentProxy(idx) {
  const proxies = getNodeProxies();
  if (!proxies.length) return null;
  currentProxyIndex = Math.max(0, Math.min(idx, proxies.length - 1));
  currentProxy = proxies[currentProxyIndex] || null;
  return currentProxy;
}

function clearProxyBanAfterProbe(proxyIdx, reason) {
  if (!proxyBans[proxyIdx]) return false;
  delete proxyBans[proxyIdx];
  delete payloadMissCounts[proxyIdx];
  delete calendar429Streaks[proxyIdx];
  saveBanState();
  log('OK', `[PROXY BAN] proxy #${proxyIdx} unbanned by probe (${reason})`);
  return true;
}

function getRelayPort(proxyIdx) {
  const nodeId = parseInt(NODE_ID, 10) || 0;
  const idx = Number(proxyIdx || 0);
  return RELAY_PORT_BASE + (nodeId * RELAY_PORT_STRIDE) + idx;
}

function waitForLocalPort(port, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const tryConnect = () => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      let settled = false;

      const finalize = (err) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (!err) return resolve();
        if (Date.now() >= deadline) return reject(err);
        setTimeout(tryConnect, 100);
      };

      socket.once('connect', () => finalize(null));
      socket.once('error', finalize);
      socket.setTimeout(400, () => finalize(new Error(`timeout waiting for relay port ${port}`)));
    };

    tryConnect();
  });
}

function listProcessCommands() {
  const procRoot = '/proc';
  const rows = [];
  try {
    for (const entry of fs.readdirSync(procRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number(entry.name);
      if (!Number.isInteger(pid) || pid === process.pid) continue;
      try {
        const cmdline = fs.readFileSync(path.join(procRoot, entry.name, 'cmdline'), 'utf8')
          .replace(/\0/g, ' ')
          .trim();
        if (cmdline) rows.push({ pid, cmdline });
      } catch (e) {
        // Process disappeared while scanning /proc.
      }
    }
  } catch (e) {
    return rows;
  }
  return rows;
}

function killProcessCommands(predicate, signal = 'TERM') {
  const signalName = String(signal || 'TERM').startsWith('SIG') ? String(signal) : `SIG${signal}`;
  let killed = 0;
  for (const row of listProcessCommands()) {
    try {
      if (!predicate(row.cmdline, row.pid)) continue;
      process.kill(row.pid, signalName);
      killed++;
    } catch (e) {
      // Already exited or permission denied; cleanup is best effort.
    }
  }
  return killed;
}

function pkillProxyRelayByPort(localPort, signal = 'TERM') {
  const port = Number(localPort);
  if (!Number.isInteger(port) || port <= 0) return false;
  try {
    return killProcessCommands((cmdline) => {
      return cmdline.includes('proxy-relay.js') && new RegExp(`\\s${port}$`).test(cmdline);
    }, signal) > 0;
  } catch (e) {
    return false;
  }
}

function stopProxyRelayForIndex(proxyIdx, reason = 'relay_stop') {
  const idx = Number(proxyIdx);
  if (!Number.isInteger(idx) || idx < 0) return false;

  const existing = proxyRelayState[idx];
  const localPort = existing?.localPort || getRelayPort(idx);
  const oldPid = existing?.childPid || null;
  if (oldPid) {
    try { process.kill(oldPid, 'TERM'); } catch (e) { /* already stopped */ }
  }
  pkillProxyRelayByPort(localPort, 'TERM');
  delete proxyRelayState[idx];

  // Kill only the specific old PID after grace period, NOT by port pattern.
  // Using pkill-by-port here would kill a NEW relay spawned on the same port.
  if (oldPid) {
    setTimeout(() => {
      try { process.kill(oldPid, 'KILL'); } catch (e) { /* already dead */ }
      pkillProxyRelayByPort(localPort, 'KILL');
    }, 500).unref?.();
  } else {
    setTimeout(() => {
      pkillProxyRelayByPort(localPort, 'KILL');
    }, 500).unref?.();
  }

  try {
    log('PROXY', `[PROXY RELAY] stopped proxy=${idx} port=${localPort} pid=${oldPid || 'unknown'} reason=${reason}`);
  } catch (e) { /* logger may not be ready during shutdown */ }
  return true;
}

function cleanupAllProxyRelays(reason = 'startup') {
  try {
    killProcessCommands((cmdline) => cmdline.includes('proxy-relay.js'), 'TERM');
    execSync('sleep 0.5', { stdio: 'ignore' });
    killProcessCommands((cmdline) => cmdline.includes('proxy-relay.js'), 'KILL');
  } catch (e) { /* no-op */ }

  for (const key of Object.keys(proxyRelayState)) {
    delete proxyRelayState[key];
  }

  try {
    log('PROXY', `[PROXY RELAY] stale cleanup completed reason=${reason}`);
  } catch (e) { /* logger may not be ready during startup */ }
}

function registerProxyRelayCleanupHandlers() {
  if (global.__proxyRelayCleanupHandlersRegistered) return;
  global.__proxyRelayCleanupHandlersRegistered = true;

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      cleanupAllProxyRelays(`signal_${signal}`);
      process.exit(0);
    });
  }
}

async function ensureProxyRelay(proxy, proxyIdx, logPrefix = '[PROXY RELAY]') {
  if (!proxy || !proxy.username || !proxy.password) {
    return { localPort: null, viaRelay: false };
  }

  const localPort = getRelayPort(proxyIdx);
  const signature = `${proxy.host}:${proxy.port}:${proxy.username}:${proxy.password}`;
  const existing = proxyRelayState[proxyIdx];

  if (existing && existing.signature === signature) {
    try {
      await waitForLocalPort(existing.localPort, 350);
      return { localPort: existing.localPort, viaRelay: true };
    } catch (e) {
      delete proxyRelayState[proxyIdx];
    }
  }

  pkillProxyRelayByPort(localPort, 'TERM');
  pkillProxyRelayByPort(localPort, 'KILL');

  const relayPath = '/root/colosseum-sniper/proxy-relay.js';
  const child = spawn('node', [relayPath, proxy.host, String(proxy.port), proxy.username, proxy.password, String(localPort)], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  await waitForLocalPort(localPort, 3000);
  proxyRelayState[proxyIdx] = { localPort, signature, startedAt: Date.now(), childPid: child.pid };
  log('СЂСџвЂќРѓ', `${logPrefix} localhost:${localPort} -> ${proxy.host}:${proxy.port} (#${proxyIdx})`);
  return { localPort, viaRelay: true };
}

// Р С™Р С•Р Р…РЎвЂћР С‘Р С–РЎС“РЎР‚Р В°РЎвЂ Р С‘РЎРЏ РЎвЂљР В°Р в„–Р СР С‘Р Р…Р С–Р С•Р Р† (Р С‘Р В· Under V2 application.properties)
const RATE_LIMIT_WAIT_MS = 900000;   // 15 Р СР С‘Р Р…РЎС“РЎвЂљ Р В±Р В°Р Р… Р С—Р С•РЎРѓР В»Р Вµ 429 Р Р…Р В° Р С”Р В°Р В»Р ВµР Р…Р Т‘Р В°РЎР‚Р Вµ
const FORBIDDEN_WAIT_MS = 7200000;  // 2 РЎвЂЎР В°РЎРѓР В° Р В±Р В°Р Р… Р С—Р С•РЎРѓР В»Р Вµ 403
const SUCCESS_WAIT_MS = 900000;   // 15 Р СР С‘Р Р…РЎС“РЎвЂљ Р С—Р В°РЎС“Р В·Р В° Р С—Р С•РЎРѓР В»Р Вµ РЎС“РЎРѓР С—Р ВµРЎв‚¬Р Р…Р С•Р в„– Р С—Р С•Р С”РЎС“Р С—Р С”Р С‘
const PAYLOAD_FAIL_MAX = 3;         // Р СџР С•РЎРѓР В»Р Вµ 3 Р С—Р С•Р Т‘РЎР‚РЎРЏР Т‘ payload-miss Р С—РЎР‚Р С•Р С”РЎРѓР С‘ РЎРѓРЎвЂЎР С‘РЎвЂљР В°Р ВµР С Р С—Р В»Р С•РЎвЂ¦Р С‘Р С
const PAYLOAD_FAIL_BAN_MS = 1800000; // 30 Р СР С‘Р Р…РЎС“РЎвЂљ Р В±Р В°Р Р… Р В·Р В° repeated payload miss

const CALENDAR_EVERY_NTH = 48;       // Р С™Р В°Р В¶Р Т‘РЎвЂ№Р в„– 48-Р в„– Р В·Р В°Р С—РЎР‚Р С•РЎРѓ РІР‚вЂќ Р С—Р В°РЎС“Р В·Р В° (Under V2)
const CALENDAR_429_EVERY_NTH = 10;   // Р С™Р В°Р В¶Р Т‘РЎвЂ№Р в„– 10-Р в„– 429 Р С•РЎвЂљ Р С”Р В°Р В»Р ВµР Р…Р Т‘Р В°РЎР‚РЎРЏ РІР‚вЂќ Р С—Р В°РЎС“Р В·Р В°
const CALENDAR_NTH_DELAY_MIN_MS = 90000;  // 1:30 Р СР С‘Р Р… (Р СР С‘Р Р…Р С‘Р СРЎС“Р С Р С—Р В°РЎС“Р В·РЎвЂ№)
const CALENDAR_NTH_DELAY_MAX_MS = 150000; // 2:30 Р СР С‘Р Р… (Р СР В°Р С”РЎРѓР С‘Р СРЎС“Р С Р С—Р В°РЎС“Р В·РЎвЂ№)
const POLL_INTERVAL_MINUTES = 1;       // Р ВР Р…РЎвЂљР ВµРЎР‚Р Р†Р В°Р В» Р С•Р С—РЎР‚Р С•РЎРѓР В° (Р СР С‘Р Р…РЎС“РЎвЂљРЎвЂ№)
const MAX_ATTEMPTS_PER_SLOT = 2;        // Р СљР В°Р С”РЎРѓ Р С—Р С•Р С—РЎвЂ№РЎвЂљР С•Р С” Р В·Р В°Р В±РЎР‚Р С•Р Р…Р С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉ Р С•Р Т‘Р С‘Р Р… Р С‘ РЎвЂљР С•РЎвЂљ Р В¶Р Вµ РЎРѓР В»Р С•РЎвЂљ
const SLOT_COOLDOWN_MS = 600000;   // 10 Р СР С‘Р Р…РЎС“РЎвЂљ (Р вЂР В°Р Р… РЎРѓР В»Р С•РЎвЂљР В°, Р ВµРЎРѓР В»Р С‘ Р С•Р Р… Р Т‘Р В°Р ВµРЎвЂљ 409)

const slotAttempts = {};
// РІвЂўС’РІвЂўС’РІвЂўС’ Absolute Epoch Grid: Р С”Р С•Р Р…РЎРѓРЎвЂљР В°Р Р…РЎвЂљРЎвЂ№ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ РІвЂўС’РІвЂўС’РІвЂўС’
const EPOCH_CYCLE_MS = 63000;       // 63 РЎРѓР ВµР С”РЎС“Р Р…Р Т‘РЎвЂ№ РІР‚вЂќ Р Т‘Р В»Р С‘Р Р…Р В° Р С•Р Т‘Р Р…Р С•Р в„– РЎРЊР С—Р С•РЎвЂ¦Р С‘ (>60РЎРѓ Р Т‘Р В»РЎРЏ Р В±Р ВµР В·Р С•Р С—Р В°РЎРѓР Р…Р С•РЎРѓРЎвЂљР С‘)
const DEFAULT_SCHEDULER_CYCLE_MS = 63000;
const DEFAULT_SCHEDULER_ACTIVE_NODE_IDS = [
  1, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31
];

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  SLOT COORDINATION: РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚ РЎРѓР В»Р С•РЎвЂљР С•Р Р† Р СР ВµР В¶Р Т‘РЎС“ Р В±Р С•РЎвЂљР В°Р СР С‘
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
const COORD_MASTER_IP = (config.coordination && config.coordination.masterIp) || null;
const COORD_REGISTRY_PATH = (config.coordination && config.coordination.registryPath) || '/root/slot-registry.json';
const COORD_TTL_MS = ((config.coordination && config.coordination.ttlMinutes) || 16) * 60 * 1000;

/**
 * Р В§Р С‘РЎвЂљР В°Р ВµРЎвЂљ РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚ РЎРѓР В»Р С•РЎвЂљР С•Р Р† РЎРѓ Р СР В°РЎРѓРЎвЂљР ВµРЎР‚-РЎРѓР ВµРЎР‚Р Р†Р ВµРЎР‚Р В°.
 * Node 1 РЎвЂЎР С‘РЎвЂљР В°Р ВµРЎвЂљ РЎвЂћР В°Р в„–Р В» Р Р…Р В°Р С—РЎР‚РЎРЏР СРЎС“РЎР‹, Р С•РЎРѓРЎвЂљР В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ РІР‚вЂќ РЎвЂЎР ВµРЎР‚Р ВµР В· SSH.
 * Р СџРЎР‚Р С‘ Р С•РЎв‚¬Р С‘Р В±Р С”Р Вµ Р Р†Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ {} (fallback: Р В±Р ВµР В· Р С”Р С•Р С•РЎР‚Р Т‘Р С‘Р Р…Р В°РЎвЂ Р С‘Р С‘).
 */
function readSlotRegistry() {
  if (!COORD_MASTER_IP) return {};
  try {
    if (NODE_ID === '12') {
      // Р СљРЎвЂ№ РІР‚вЂќ Р СР В°РЎРѓРЎвЂљР ВµРЎР‚ (Р РЋР ВµРЎР‚Р Р†Р ВµРЎР‚ 12), РЎвЂЎР С‘РЎвЂљР В°Р ВµР С РЎвЂћР В°Р в„–Р В» Р Р…Р В°Р С—РЎР‚РЎРЏР СРЎС“РЎР‹
      if (!fs.existsSync(COORD_REGISTRY_PATH)) return {};
      return JSON.parse(fs.readFileSync(COORD_REGISTRY_PATH, 'utf8'));
    } else {
      const output = execSync(
        `ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new root@${COORD_MASTER_IP} "cat ${COORD_REGISTRY_PATH} 2>/dev/null || echo {}"`,
        { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
      );
      return JSON.parse(output.trim());
    }
  } catch (e) {
    log('РІС™В РїС‘РЏ', `[COORD] Р СњР Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ Р С—РЎР‚Р С•РЎвЂЎР С‘РЎвЂљР В°РЎвЂљРЎРЉ РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚: ${e.message.slice(0, 60)}`);
    return {};
  }
}

/**
 * Р вЂ”Р В°Р С—Р С‘РЎРѓРЎвЂ№Р Р†Р В°Р ВµРЎвЂљ Р Р…Р В°РЎв‚¬ РЎРѓР В»Р С•РЎвЂљ Р Р† РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚ Р Р…Р В° Р СР В°РЎРѓРЎвЂљР ВµРЎР‚-РЎРѓР ВµРЎР‚Р Р†Р ВµРЎР‚Р Вµ.
 * Node 1 Р С—Р С‘РЎв‚¬Р ВµРЎвЂљ Р Р…Р В°Р С—РЎР‚РЎРЏР СРЎС“РЎР‹, Р С•РЎРѓРЎвЂљР В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ РІР‚вЂќ РЎвЂЎР ВµРЎР‚Р ВµР В· SSH.
 * Р СџРЎР‚Р С‘ Р С•РЎв‚¬Р С‘Р В±Р С”Р Вµ РІР‚вЂќ silent fail (Р Р…Р Вµ Р С”РЎР‚Р С‘РЎвЂљР С‘РЎвЂЎР Р…Р С•).
 */
function claimSlot(slotTime) {
  if (!COORD_MASTER_IP) return;
  try {
    if (NODE_ID === '12') {
      const reg = fs.existsSync(COORD_REGISTRY_PATH)
        ? JSON.parse(fs.readFileSync(COORD_REGISTRY_PATH, 'utf8'))
        : {};
      reg[NODE_ID] = { slot: slotTime, updated: Date.now() };
      fs.writeFileSync(COORD_REGISTRY_PATH, JSON.stringify(reg, null, 2), 'utf8');
    } else {
      execSync(
        `ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=accept-new root@${COORD_MASTER_IP} "node /root/colosseum-sniper/slot-registry.js claim ${NODE_ID} ${slotTime}"`,
        { timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
      );
    }
    log('СЂСџвЂњРЋ', `[COORD] Р РЋР В»Р С•РЎвЂљ ${slotTime} Р В·Р В°РЎР‚Р ВµР С–Р С‘РЎРѓРЎвЂљРЎР‚Р С‘РЎР‚Р С•Р Р†Р В°Р Р… Р Р† РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚Р Вµ.`);
  } catch (e) {
    log('РІС™В РїС‘РЏ', `[COORD] Р СњР Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ Р В·Р В°Р С—Р С‘РЎРѓР В°РЎвЂљРЎРЉ Р Р† РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚: ${e.message.slice(0, 60)}`);
  }
}

/**
 * Р вЂ™РЎвЂ№Р В±Р С‘РЎР‚Р В°Р ВµРЎвЂљ Р В»РЎС“РЎвЂЎРЎв‚¬Р С‘Р в„– РЎРѓР В»Р С•РЎвЂљ Р С‘Р В· РЎРѓР С—Р С‘РЎРѓР С”Р В°, Р СР С‘Р Р…Р С‘Р СР С‘Р В·Р С‘РЎР‚РЎС“РЎРЏ Р Т‘РЎС“Р В±Р В»Р С‘РЎР‚Р С•Р Р†Р В°Р Р…Р С‘Р Вµ.
 * 1. Р В§Р С‘РЎвЂљР В°Р ВµРЎвЂљ РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚, Р С•РЎвЂљР В±РЎР‚Р В°РЎРѓРЎвЂ№Р Р†Р В°Р ВµРЎвЂљ РЎС“РЎРѓРЎвЂљР В°РЎР‚Р ВµР Р†РЎв‚¬Р С‘Р Вµ Р В·Р В°Р С—Р С‘РЎРѓР С‘ (TTL) Р С‘ РЎРѓР Р†Р С•РЎР‹.
 * 2. Р РЋРЎвЂЎР С‘РЎвЂљР В°Р ВµРЎвЂљ РЎРѓР С”Р С•Р В»РЎРЉР С”Р С• Р В±Р С•РЎвЂљР С•Р Р† Р Т‘Р ВµРЎР‚Р В¶Р В°РЎвЂљ Р С”Р В°Р В¶Р Т‘РЎвЂ№Р в„– РЎРѓР В»Р С•РЎвЂљ.
 * 3. Р РЋР С•РЎР‚РЎвЂљР С‘РЎР‚РЎС“Р ВµРЎвЂљ: РЎРѓР Р…Р В°РЎвЂЎР В°Р В»Р В° РЎРѓР Р†Р С•Р В±Р С•Р Т‘Р Р…РЎвЂ№Р Вµ (0 Р Т‘Р ВµРЎР‚Р В¶Р В°РЎвЂљР ВµР В»Р ВµР в„–), Р В·Р В°РЎвЂљР ВµР С Р С—Р С• Р Р†Р С•Р В·РЎР‚Р В°РЎРѓРЎвЂљР В°Р Р…Р С‘РЎР‹.
 * 4. Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ Р В»РЎС“РЎвЂЎРЎв‚¬Р С‘Р в„– РЎРѓР В»Р С•РЎвЂљ.
 */
function pickBestSlot(validSlots) {
  if (!COORD_MASTER_IP || validSlots.length <= 1) {
    return validSlots[0];
  }

  const registry = readSlotRegistry();
  const now = Date.now();

  // Р РЋРЎвЂЎР С‘РЎвЂљР В°Р ВµР С Р Т‘Р ВµРЎР‚Р В¶Р В°РЎвЂљР ВµР В»Р ВµР в„– Р С—Р С• РЎРѓР В»Р С•РЎвЂљРЎС“ Р В Р С—Р С• Р Т‘Р В°РЎвЂљР Вµ
  const heldSlots = {};
  const heldDates = {};
  for (const [nid, entry] of Object.entries(registry)) {
    if (nid === NODE_ID) continue;              // skip Р Р…Р В°РЎв‚¬Р В° Р В·Р В°Р С—Р С‘РЎРѓРЎРЉ
    if (now - entry.updated > COORD_TTL_MS) continue;  // skip Р СРЎвЂРЎР‚РЎвЂљР Р†РЎвЂ№Р Вµ (>16 Р СР С‘Р Р…)
    const slot = entry.slot;
    heldSlots[slot] = (heldSlots[slot] || 0) + 1;
    // Р РЋРЎвЂЎР С‘РЎвЂљР В°Р ВµР С Р В±Р С•РЎвЂљР С•Р Р† Р С—Р С• Р Т‘Р В°РЎвЂљР Вµ (YYYY-MM-DD)
    const datePart = slot.split('T')[0];
    heldDates[datePart] = (heldDates[datePart] || 0) + 1;
  }

  // Р РЋР С•РЎР‚РЎвЂљР С‘РЎР‚РЎС“Р ВµР С: 0) Р В¦Р ВµР В»Р ВµР Р†Р С•Р в„– Р С—РЎР‚Р С‘Р С•РЎР‚Р С‘РЎвЂљР ВµРЎвЂљ 1) Р СР ВµР Р…РЎРЉРЎв‚¬Р Вµ Р В±Р С•РЎвЂљР С•Р Р† Р Р…Р В° Р вЂќР С’Р СћР Р€, 2) Р СР ВµР Р…РЎРЉРЎв‚¬Р Вµ Р В±Р С•РЎвЂљР С•Р Р† Р Р…Р В° РЎРѓР В»Р С•РЎвЂљ, 3) Р В±Р В»Р С‘Р В¶Р В°Р в„–РЎв‚¬Р В°РЎРЏ Р Т‘Р В°РЎвЂљР В°
  const sorted = [...validSlots].sort((a, b) => {
    // 0) Р СџРЎР‚Р С‘Р С•РЎР‚Р С‘РЎвЂљР ВµРЎвЂљР Р…РЎвЂ№Р Вµ РЎРѓР В»Р С•РЎвЂљРЎвЂ№ (Р С—Р С• Р В·Р В°Р С—РЎР‚Р С•РЎРѓРЎС“)
    const isPriA = (a.startDateTime === '2026-04-22T10:45:00Z' || a.startDateTime === '2026-04-21T11:45:00Z') ? 1 : 0;
    const isPriB = (b.startDateTime === '2026-04-22T10:45:00Z' || b.startDateTime === '2026-04-21T11:45:00Z') ? 1 : 0;
    if (isPriA !== isPriB) return isPriB - isPriA; // Р СџРЎР‚Р С‘Р С•РЎР‚Р С‘РЎвЂљР ВµРЎвЂљР Р…РЎвЂ№Р Вµ РЎРѓР В»Р С•РЎвЂљРЎвЂ№ Р С‘Р Т‘РЎС“РЎвЂљ Р С—Р ВµРЎР‚Р Р†РЎвЂ№Р СР С‘

    const aPlanned = a.bookingPlan?.totalRequested || 0;
    const bPlanned = b.bookingPlan?.totalRequested || 0;
    if (aPlanned !== bPlanned) return bPlanned - aPlanned;

    const aDate = a.startDateTime.split('T')[0];
    const bDate = b.startDateTime.split('T')[0];
    const aDateHeld = heldDates[aDate] || 0;
    const bDateHeld = heldDates[bDate] || 0;
    if (aDateHeld !== bDateHeld) return aDateHeld - bDateHeld;

    const aHeld = heldSlots[a.startDateTime] || 0;
    const bHeld = heldSlots[b.startDateTime] || 0;
    if (aHeld !== bHeld) return aHeld - bHeld;

    return a.startDateTime.localeCompare(b.startDateTime);
  });

  const chosen = sorted[0];
  const chosenDate = chosen.startDateTime.split('T')[0];
  const holders = heldSlots[chosen.startDateTime] || 0;
  const dateHolders = heldDates[chosenDate] || 0;
  if (chosen.bookingPlan) {
    log('РЎР‚РЎСџР вЂ№Р’В«', `[COORD] Р В РЎСџР В Р’В»Р В Р’В°Р В Р вЂ¦ Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В Р’В»Р В РЎвЂўР РЋРІР‚С™ ${chosen.startDateTime}: ${chosen.bookingPlan.ticketInfo}`);
  }

  if (dateHolders === 0) {
    log('СЂСџвЂњРЋ', `[COORD] Р вЂ™РЎвЂ№Р В±РЎР‚Р В°Р Р… РЎРѓР В»Р С•РЎвЂљ Р Р…Р В° Р РЋР вЂ™Р С›Р вЂР С›Р вЂќР СњР Р€Р В® Р Т‘Р В°РЎвЂљРЎС“ ${chosenDate}: ${chosen.startDateTime}`);
  } else if (holders === 0) {
    log('СЂСџвЂњРЋ', `[COORD] Р вЂ™РЎвЂ№Р В±РЎР‚Р В°Р Р… Р РЋР вЂ™Р С›Р вЂР С›Р вЂќР СњР В«Р в„ў РЎРѓР В»Р С•РЎвЂљ: ${chosen.startDateTime} (Р Т‘Р В°РЎвЂљР В° ${chosenDate}: ${dateHolders} Р В±Р С•РЎвЂљ(Р С•Р Р†))`);
  } else {
    log('СЂСџвЂњРЋ', `[COORD] Р СњР В°Р С‘Р СР ВµР Р…Р ВµР Вµ Р С—Р С•Р С”РЎР‚РЎвЂ№РЎвЂљРЎвЂ№Р в„–: ${chosen.startDateTime} (${holders} Р В±Р С•РЎвЂљ(Р С•Р Р†), Р Т‘Р В°РЎвЂљР В° ${chosenDate}: ${dateHolders})`);
  }

  return chosen;
}

puppeteer.use(StealthPlugin({
  enabledEvasions: new Set([
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'navigator.vendor',
    'navigator.webdriver',
    'sourceurl',
    'user-agent-override',
    'webgl.vendor',
    'window.outerdimensions'
  ])
}));

// Enhanced stealth: rotate User-Agent and set realistic headers on every new page
const originalNewPage = puppeteer.newPage;
puppeteer.newPage = async function(...args) {
  const page = await originalNewPage.apply(this, args);
  
  // Rotate User-Agent for each new page
  const ua = getRandomUserAgent();
  const secChUa = getSecChUaFromUserAgent(ua);
  const secChUaPlatform = getSecChUaPlatform(ua);
  const secChUaMobile = ua.includes('Mobile') ? '?1' : '?0';
  
  // Extract full version from User-Agent for consistency
  const chromeVersionMatch = ua.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  let fullVersion = '"131.0.6778.86"';
  if (chromeVersionMatch) {
    const major = chromeVersionMatch[1];
    const minor = chromeVersionMatch[2] || '0';
    const build = chromeVersionMatch[3] || String(Math.floor(Math.random() * 100));
    const patch = chromeVersionMatch[4] || String(Math.floor(Math.random() * 100));
    fullVersion = `"${major}.${minor}.${build}.${patch}"`;
  }
  
  // Set comprehensive headers to mimic real browser - FULL WAF BYPASS
  const enhancedHeaders = {
    ...STANDARD_HEADERS,
    'User-Agent': ua,
    'Sec-Ch-Ua': secChUa,
    'Sec-Ch-Ua-Platform': secChUaPlatform,
    'Sec-Ch-Ua-Mobile': secChUaMobile,
    'Sec-Ch-Ua-Arch': '"x86"',
    'Sec-Ch-Ua-Full-Version': fullVersion,
    'Sec-Ch-Ua-Bitness': '"64"',
    'Sec-Ch-Ua-Model': '""',
    'Sec-Ch-Ua-WoW64': '?0',
    'Priority': 'u=0, i',
    'Purpose': 'prefetch',
    'Connection': 'keep-alive',
    'TE': 'Trailers'
  };
  
  await page.setExtraHTTPHeaders(enhancedHeaders).catch(() => {});
  
  return page;
};

// Utility functions
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randomDelay = (min = 800, max = 2000) => sleep(min + Math.random() * (max - min));
const randomInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

async function getManualCheckoutSnapshot(page) {
  if (!page || page.isClosed?.()) return null;
  const domSnapshot = await page.evaluate(() => {
    const cookieNames = String(document.cookie || '')
      .split(';')
      .map((entry) => entry.split('=')[0].trim())
      .filter(Boolean);
    const collectStorageKeys = (storage) => {
      const keys = [];
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key) keys.push(key);
        }
      } catch {}
      return keys;
    };
    const localStorageKeys = collectStorageKeys(window.localStorage);
    const sessionStorageKeys = collectStorageKeys(window.sessionStorage);
    const authPattern = /wordpress_logged_in|logged|login|auth|customer|utente|user|token|jwt|bearer|oauth|sso/i;
    const participantPattern = /^abc_(partecipantsData|extraData)_/i;
    const text = String(document.body?.innerText || document.body?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2500);
    const lowerText = text.toLowerCase();
    const lowerLocation = `${window.location.href || ''} ${document.title || ''} ${lowerText}`.toLowerCase();
    return {
      url: window.location.href,
      title: document.title || '',
      cookieNames,
      localStorageKeys,
      sessionStorageKeys,
      hasLoginCookie: cookieNames.some((name) => authPattern.test(name)),
      hasAuthStorage: localStorageKeys.concat(sessionStorageKeys).some((name) => authPattern.test(name)),
      hasParticipantStorage: localStorageKeys.concat(sessionStorageKeys).some((name) => participantPattern.test(name)),
      hasPhpSession: cookieNames.includes('PHPSESSID'),
      showsUnauthorized: /non autorizzato|non autenticato|utente non|not authorized|not authenticated|user not|invalid authorization|autorizzazione non valida/i.test(lowerText),
      showsCheckoutError: /impossibile procedere al checkout|riprova piu tardi|riprova piГ№ tardi/i.test(lowerText),
      showsOrderSuccess: /\/order_success\/|ordine completato|order completed|order complete|payment successful|pagamento completato/i.test(lowerLocation),
      showsCheckoutForm: /nome|cognome|dati visitatore|checkout|privacy|pagamento|payment/i.test(lowerText)
    };
  }).catch((error) => ({ error: error.message }));

  if (!domSnapshot || domSnapshot.error) return domSnapshot;

  try {
    const client = await page.target().createCDPSession();
    const allCookies = await client.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
    await client.detach().catch(() => {});
    const customerCookieNames = [];
    const authCookieNames = [];
    for (const cookie of allCookies.cookies || []) {
      const domain = String(cookie.domain || '');
      const name = String(cookie.name || '');
      if (/midaticket\.com$/i.test(domain) || /customer/i.test(name)) {
        customerCookieNames.push(`${domain}:${name}`);
      }
      if (/wordpress_logged_in|logged|login|auth|customer|utente|user|token|jwt|bearer|oauth|sso/i.test(name)) {
        authCookieNames.push(`${domain}:${name}`);
      }
    }
    domSnapshot.customerCookieNames = customerCookieNames.slice(0, 20);
    domSnapshot.authCookieNames = authCookieNames.slice(0, 20);
    domSnapshot.hasCustomerCookie = customerCookieNames.length > 0;
    domSnapshot.hasLoginCookie = Boolean(domSnapshot.hasLoginCookie || authCookieNames.length > 0);
  } catch {}

  return domSnapshot;
}

function classifyManualCheckoutSnapshot(snapshot) {
  if (!snapshot || snapshot.error) return 'snapshot_unavailable';
  if (isManualCheckoutTerminalSuccess(snapshot)) return 'checkout_order_success';
  const hasAuthState = Boolean(snapshot.hasLoginCookie || snapshot.hasAuthStorage || snapshot.hasCustomerCookie);
  if (snapshot.showsUnauthorized && hasAuthState) return 'unauthorized_after_manual_login';
  if (snapshot.showsUnauthorized) return 'unauthorized_without_login_state';
  if (snapshot.showsCheckoutError) return 'checkout_business_error';
  if (hasAuthState) return 'manual_login_detected';
  return 'no_login_state';
}

function isManualCheckoutTerminalSuccess(snapshot) {
  if (!snapshot || snapshot.error) return false;
  const url = String(snapshot.url || '');
  const title = String(snapshot.title || '');
  return Boolean(snapshot.showsOrderSuccess
    || /\/order_success\/|\/order-success\//i.test(url)
    || /ordine completato|order completed|order complete/i.test(title));
}

function parseFormEncodedBody(body) {
  const params = new URLSearchParams(String(body || ''));
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function summarizeCheckoutPostData(postData) {
  const fields = parseFormEncodedBody(postData);
  let participantCount = 0;
  let guideExtraCount = 0;
  try {
    const participants = JSON.parse(fields.partecipants || '[]');
    if (Array.isArray(participants)) {
      participantCount = participants.length;
      guideExtraCount = participants.filter((entry) => entry && entry.extraData && Object.keys(entry.extraData).length > 0).length;
    }
  } catch {}

  return {
    action: fields.action || '',
    hasInvoice: Boolean(fields.invoice),
    hasGift: Boolean(fields.gift),
    hasCartLock: Boolean(fields.cart_lock),
    cartLock: fields.cart_lock || '',
    hasRecaptcha: Boolean(fields.recaptcha_token),
    recaptchaLength: String(fields.recaptcha_token || '').length,
    privacy: fields['extraData[privacy]'] || '',
    covidRules: fields['extraData[covid_rules]'] || '',
    newsletter: fields['extraData[newsletter]'] || '',
    participantCount,
    guideExtraCount,
    fieldNames: Object.keys(fields).sort()
  };
}

function summarizeCookieHeader(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((entry) => entry.split('=')[0].trim())
    .filter(Boolean)
    .sort();
}

function formatCalendarRequestContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const cookieNames = Array.isArray(ctx.cookieNames) ? ctx.cookieNames.slice(0, 12).join(',') : '';
  const pageUrl = String(ctx.pageUrl || '').slice(0, 160);
  const referrer = String(ctx.referrer || '').slice(0, 160);
  const origin = String(ctx.origin || '').slice(0, 120);
  return ` ctx=url=${pageUrl || 'n/a'} origin=${origin || 'n/a'} ref=${referrer || 'n/a'} cookies=${cookieNames || 'none'} php=${ctx.hasPhpSession ? 'yes' : 'no'} octo=${ctx.hasOctofenceCookie ? 'yes' : 'no'} ready=${ctx.readyState || 'n/a'}`;
}

function summarizeCheckoutRequest(request) {
  const headers = request.headers ? request.headers() : {};
  return {
    url: request.url(),
    method: request.method(),
    resourceType: request.resourceType?.() || '',
    headers: {
      accept: headers.accept || '',
      contentType: headers['content-type'] || headers['Content-Type'] || '',
      origin: headers.origin || '',
      referer: headers.referer || headers.referrer || '',
      xRequestedWith: headers['x-requested-with'] || headers['X-Requested-With'] || '',
      userAgent: headers['user-agent'] || ''
    },
    cookieNames: summarizeCookieHeader(headers.cookie || ''),
    post: summarizeCheckoutPostData(request.postData?.() || '')
  };
}

function summarizeCheckoutResponseBody(text) {
  const raw = String(text || '');
  let json = null;
  try { json = JSON.parse(raw); } catch {}
  const firstError = Array.isArray(json?.data) ? json.data[0] : null;
  return {
    success: json && Object.prototype.hasOwnProperty.call(json, 'success') ? Boolean(json.success) : null,
    code: firstError?.code ?? null,
    message: firstError?.message || '',
    snippet: raw.replace(/\s+/g, ' ').trim().slice(0, 500)
  };
}

function attachManualCheckoutNetworkDiagnostics(page) {
  if (!page || page.__checkoutSubmitDiagnosticsAttached) return;
  page.__checkoutSubmitDiagnosticsAttached = true;
  const checkoutRequests = new WeakSet();
  const latestPath = `/tmp/sniper-checkout-submit-node${NODE_ID}.json`;

  const persist = (payload) => {
    try {
      fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
    } catch (error) {
      log('WARN', `[PAYMENT] checkout_submit_diag_write_failed error="${error.message}"`);
    }
  };

  page.on('request', (request) => {
    try {
      const postData = request.postData?.() || '';
      const isCheckoutSubmit = request.method() === 'POST'
        && /\/mtajax\/checkout\b/i.test(request.url())
        && /(^|&)action=midaabc_checkout(&|$)/.test(postData);
      if (!isCheckoutSubmit) return;
      checkoutRequests.add(request);
      const summary = {
        at: new Date().toISOString(),
        nodeId: Number(NODE_ID),
        proxyIndex: currentProxyIndex,
        request: summarizeCheckoutRequest(request),
        response: null
      };
      persist(summary);
      const cookieNames = summary.request.cookieNames.join(',');
      log('PAYMENT', `[PAYMENT] checkout_submit_request url=${summary.request.url} origin=${summary.request.headers.origin || 'none'} referer=${summary.request.headers.referer || 'none'} xrw=${summary.request.headers.xRequestedWith || 'none'} cookies=${cookieNames || 'none'} participants=${summary.request.post.participantCount} guideExtra=${summary.request.post.guideExtraCount} cartLock=${summary.request.post.hasCartLock ? 'yes' : 'no'} recaptchaLen=${summary.request.post.recaptchaLength}`);
    } catch (error) {
      log('WARN', `[PAYMENT] checkout_submit_request_diag_failed error="${error.message}"`);
    }
  });

  page.on('response', async (response) => {
    const request = response.request();
    if (!checkoutRequests.has(request)) return;
    try {
      const requestSummary = summarizeCheckoutRequest(request);
      const text = await response.text().catch((error) => `response_text_failed:${error.message}`);
      const responseSummary = summarizeCheckoutResponseBody(text);
      const payload = {
        at: new Date().toISOString(),
        nodeId: Number(NODE_ID),
        proxyIndex: currentProxyIndex,
        request: requestSummary,
        response: {
          url: response.url(),
          status: response.status(),
          headers: {
            contentType: response.headers()['content-type'] || '',
            setCookieNames: summarizeCookieHeader(response.headers()['set-cookie'] || '')
          },
          body: responseSummary
        }
      };
      persist(payload);
      log('PAYMENT', `[PAYMENT] checkout_submit_response status=${payload.response.status} success=${responseSummary.success} code=${responseSummary.code ?? 'none'} message="${responseSummary.message || ''}" contentType=${payload.response.headers.contentType || 'none'} saved=${latestPath}`);
    } catch (error) {
      log('WARN', `[PAYMENT] checkout_submit_response_diag_failed error="${error.message}"`);
    }
  });
}

async function parkBotDuringManualCheckout(reason, details = {}, page = null) {
  manualCheckoutParked = true;
  const markerPath = `/tmp/sniper-manual-checkout-node${NODE_ID}.json`;
  const startedAtMs = Date.now();
  log('PAYMENT', `[PAYMENT] manual_checkout_parked reason=${reason} proxy=${currentProxyIndex} action=stop_polling_keep_browser`);
  attachManualCheckoutNetworkDiagnostics(page);
  let lastSnapshotSignature = '';
  let loginRefreshAttempted = false;
  let lastActiveLogMinute = -1;

  while (true) {
    const snapshot = await getManualCheckoutSnapshot(page);
    if (snapshot) {
      const signature = JSON.stringify({
        url: snapshot.url || '',
        hasLoginCookie: Boolean(snapshot.hasLoginCookie),
        hasAuthStorage: Boolean(snapshot.hasAuthStorage),
        hasCustomerCookie: Boolean(snapshot.hasCustomerCookie),
        hasPhpSession: Boolean(snapshot.hasPhpSession),
        showsUnauthorized: Boolean(snapshot.showsUnauthorized),
        showsCheckoutError: Boolean(snapshot.showsCheckoutError),
        showsOrderSuccess: Boolean(snapshot.showsOrderSuccess),
        state: classifyManualCheckoutSnapshot(snapshot),
        error: snapshot.error || ''
      });
      if (signature !== lastSnapshotSignature) {
        lastSnapshotSignature = signature;
        const cookieNames = Array.isArray(snapshot.cookieNames)
          ? snapshot.cookieNames.filter((name) => /PHPSESSID|wordpress|logged|login|auth|customer|utente|user/i.test(name)).join(',')
          : '';
        const customerCookieNames = Array.isArray(snapshot.customerCookieNames)
          ? snapshot.customerCookieNames.join(',')
          : '';
        const storageKeys = []
          .concat(Array.isArray(snapshot.localStorageKeys) ? snapshot.localStorageKeys : [])
          .concat(Array.isArray(snapshot.sessionStorageKeys) ? snapshot.sessionStorageKeys : [])
          .filter((name) => /login|auth|customer|utente|user|token|jwt|bearer|oauth|sso/i.test(name))
          .slice(0, 20)
          .join(',');
        const state = classifyManualCheckoutSnapshot(snapshot);
        log('PAYMENT', `[PAYMENT] manual_checkout_snapshot state=${state} url=${snapshot.url || ''} phpSession=${snapshot.hasPhpSession ? 'yes' : 'no'} loginCookie=${snapshot.hasLoginCookie ? 'yes' : 'no'} customerCookie=${snapshot.hasCustomerCookie ? 'yes' : 'no'} authStorage=${snapshot.hasAuthStorage ? 'yes' : 'no'} unauthorized=${snapshot.showsUnauthorized ? 'yes' : 'no'} checkoutError=${snapshot.showsCheckoutError ? 'yes' : 'no'} orderSuccess=${snapshot.showsOrderSuccess ? 'yes' : 'no'} cookies=${cookieNames || 'none'} customerCookies=${customerCookieNames || 'none'} storage=${storageKeys || 'none'} error="${snapshot.error || ''}"`);
      }

      if (isManualCheckoutTerminalSuccess(snapshot)) {
        log('PAYMENT', `[PAYMENT] manual_checkout_completed reason=${reason} url=${snapshot.url || ''} action=resume_polling`);
        try {
          fs.writeFileSync(`${markerPath}.completed`, JSON.stringify({
            nodeId: Number(NODE_ID),
            pid: process.pid,
            reason,
            proxyIndex: currentProxyIndex,
            startedAt: new Date(startedAtMs).toISOString(),
            completedAt: new Date().toISOString(),
            checkout: snapshot,
            details
          }));
        } catch {}
        try { fs.rmSync(markerPath, { force: true }); } catch {}
        markHeldCartReleased('checkout_order_success');
        manualCheckoutParked = false;
        try {
          const checkoutBrowser = page?.browser?.();
          if (checkoutBrowser) await checkoutBrowser.close();
        } catch (error) {
          log('WARN', `[PAYMENT] manual_checkout_completed_browser_close_failed error="${error.message}"`);
        }
        return { completed: true, reason: 'order_success', snapshot };
      }

      if (!loginRefreshAttempted
        && CHECKOUT_RELOAD_AFTER_LOGIN_ENABLED
        && snapshot.hasCustomerCookie
        && !snapshot.hasParticipantStorage
        && !snapshot.showsCheckoutError
        && !snapshot.error
        && page
        && !page.isClosed?.()) {
        loginRefreshAttempted = true;
        log('PAYMENT', '[PAYMENT] manual_login_cookie_detected action=reload_checkout_before_names');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch((error) => {
          log('WARN', `[PAYMENT] manual_login_reload_failed error="${error.message}"`);
        });
        await sleep(1500);
      }
    }

    try {
      fs.writeFileSync(markerPath, JSON.stringify({
        nodeId: Number(NODE_ID),
        pid: process.pid,
        reason,
        proxyIndex: currentProxyIndex,
        startedAt: new Date(startedAtMs).toISOString(),
        updatedAt: new Date().toISOString(),
        checkout: snapshot || null,
        details
      }));
    } catch {}

    const minutes = Math.floor((Date.now() - startedAtMs) / 60000);
    if (minutes !== lastActiveLogMinute) {
      lastActiveLogMinute = minutes;
      log('PAYMENT', `[PAYMENT] manual_checkout_active reason=${reason} minutes=${minutes} proxy=${currentProxyIndex}`);
    }
    if (MANUAL_CHECKOUT_MAX_MS > 0 && Date.now() - startedAtMs >= MANUAL_CHECKOUT_MAX_MS) {
      log('PAYMENT', `[PAYMENT] manual_checkout_timeout reason=${reason} minutes=${minutes} limit=${MANUAL_CHECKOUT_MAX_MINUTES} action=resume_polling`);
      try {
        fs.writeFileSync(`${markerPath}.expired`, JSON.stringify({
          nodeId: Number(NODE_ID),
          pid: process.pid,
          reason,
          proxyIndex: currentProxyIndex,
          startedAt: new Date(startedAtMs).toISOString(),
          expiredAt: new Date().toISOString(),
          limitMinutes: MANUAL_CHECKOUT_MAX_MINUTES,
          checkout: snapshot || null,
          details
        }));
      } catch {}
      try { fs.rmSync(markerPath, { force: true }); } catch {}
      markHeldCartReleased('manual_checkout_timeout');
      manualCheckoutParked = false;
      try {
        const checkoutBrowser = page?.browser?.();
        if (checkoutBrowser) await checkoutBrowser.close();
      } catch (error) {
        log('WARN', `[PAYMENT] manual_checkout_timeout_browser_close_failed error="${error.message}"`);
      }
      return { completed: false, reason: 'manual_checkout_timeout', snapshot };
    }
    await sleep(5000);
  }
}

function getChromePidsForUserDataDir(userDataDir) {
  if (!userDataDir) return [];
  let procEntries = [];
  try {
    procEntries = fs.readdirSync('/proc');
  } catch {
    return [];
  }

  const pids = [];
  const argEquals = `--user-data-dir=${userDataDir}`;
  const argSpace = `--user-data-dir ${userDataDir}`;
  for (const entry of procEntries) {
    if (!/^\d+$/.test(entry)) continue;
    let cmdline = '';
    try {
      cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8').replace(/\0/g, ' ');
    } catch {
      continue;
    }
    if (!/(^|\/|\s)(google-)?chrom(e|ium)(-stable)?(\s|$)/i.test(cmdline)) continue;
    if (cmdline.includes(argEquals) || cmdline.includes(argSpace)) {
      pids.push(Number(entry));
    }
  }

  return Array.from(new Set(pids)).filter(pid => pid > 0 && pid !== process.pid);
}

async function waitForChromeProfileExit(userDataDir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let pids = getChromePidsForUserDataDir(userDataDir);
  while (pids.length > 0 && Date.now() < deadline) {
    await sleep(150);
    pids = getChromePidsForUserDataDir(userDataDir);
  }
  return pids;
}

function removeChromeProfileLocks(userDataDir) {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(`${userDataDir}/${name}`, { force: true });
    } catch {}
  }
}

function clearChromeSessionRestoreState(userDataDir) {
  if (!userDataDir) return;
  const defaultDir = path.join(userDataDir, 'Default');
  const files = [
    path.join(userDataDir, 'Last Session'),
    path.join(userDataDir, 'Last Tabs'),
    path.join(userDataDir, 'Current Session'),
    path.join(userDataDir, 'Current Tabs'),
    path.join(defaultDir, 'Last Session'),
    path.join(defaultDir, 'Last Tabs'),
    path.join(defaultDir, 'Current Session'),
    path.join(defaultDir, 'Current Tabs')
  ];
  for (const file of files) {
    try { fs.rmSync(file, { force: true }); } catch {}
  }
  try { fs.rmSync(path.join(defaultDir, 'Sessions'), { recursive: true, force: true }); } catch {}

  const patchJsonFile = (filePath, patcher) => {
    try {
      if (!fs.existsSync(filePath)) return;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      patcher(data);
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
    } catch {}
  };

  patchJsonFile(path.join(defaultDir, 'Preferences'), (prefs) => {
    prefs.profile = prefs.profile || {};
    prefs.profile.exit_type = 'Normal';
    prefs.profile.exited_cleanly = true;
    prefs.session = prefs.session || {};
    prefs.session.restore_on_startup = 5;
  });

  patchJsonFile(path.join(userDataDir, 'Local State'), (state) => {
    state.profile = state.profile || {};
    state.profile.exit_type = 'Normal';
    state.profile.exited_cleanly = true;
  });
}

async function prepareChromeProfileForLaunch(userDataDir, label) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
  } catch {}

  let pids = getChromePidsForUserDataDir(userDataDir);
  if (pids.length > 0) {
    log('WARN', `[BROWSER] profile_busy label=${label} dir=${userDataDir} pids=${pids.join(',')} action=term`);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
    pids = await waitForChromeProfileExit(userDataDir, 3000);
  }

  if (pids.length > 0) {
    log('WARN', `[BROWSER] profile_busy label=${label} dir=${userDataDir} pids=${pids.join(',')} action=kill`);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    pids = await waitForChromeProfileExit(userDataDir, 2000);
  }

  if (pids.length === 0) {
    removeChromeProfileLocks(userDataDir);
    clearChromeSessionRestoreState(userDataDir);
  } else {
    log('WARN', `[BROWSER] profile_still_busy label=${label} dir=${userDataDir} pids=${pids.join(',')}`);
  }
}

async function launchChromeWithProfile(options, userDataDir, label) {
  await prepareChromeProfileForLaunch(userDataDir, label);
  try {
    return await puppeteer.launch(options);
  } catch (error) {
    const message = `${error?.message || ''}\n${error?.stack || ''}`;
    if (!/SingletonLock|ProcessSingleton|Failed to launch the browser process/i.test(message)) {
      throw error;
    }

    log('WARN', `[BROWSER] launch_failed_retry label=${label} dir=${userDataDir} error="${error.message}"`);
    await prepareChromeProfileForLaunch(userDataDir, `${label}:retry`);
    return puppeteer.launch(options);
  }
}

function normalizeSchedulerNodeIds(value) {
  const source = Array.isArray(value) ? value : DEFAULT_SCHEDULER_ACTIVE_NODE_IDS;
  const seen = new Set();
  const ids = [];
  for (const raw of source) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length > 0 ? ids : DEFAULT_SCHEDULER_ACTIVE_NODE_IDS.slice();
}

function getSchedulerConfig() {
  const scheduler = config.scheduler || {};
  const activeNodeIds = normalizeSchedulerNodeIds(scheduler.activeNodeIds);
  const cycleMs = Number(scheduler.cycleMs) > 0
    ? Number(scheduler.cycleMs)
    : DEFAULT_SCHEDULER_CYCLE_MS;
  return {
    mode: scheduler.mode || 'strict_grid',
    cycleMs,
    activeNodeIds,
    allowBurst: scheduler.allowBurst === true,
    releaseResponse: scheduler.releaseResponse || 'log_only',
    recatchMode: scheduler.recatchMode || 'grid'
  };
}

function getSchedulerState() {
  const scheduler = getSchedulerConfig();
  const nodeId = parseInt(NODE_ID, 10) || 1;
  const slotIndex = scheduler.activeNodeIds.indexOf(nodeId);
  const slotMs = scheduler.cycleMs / scheduler.activeNodeIds.length;
  return {
    ...scheduler,
    nodeId,
    active: slotIndex !== -1,
    slotIndex,
    slotCount: scheduler.activeNodeIds.length,
    slotMs,
    slotOffsetMs: slotIndex >= 0 ? Math.round(slotIndex * slotMs) : null
  };
}

const getNodeSlotIndex = () => getSchedulerState().slotIndex;
const isSchedulerNodeActive = () => getSchedulerState().active;
const formatRomeDateTime = (value) => new Date(value).toLocaleString('sv-SE', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
}).replace(' ', 'T');
const getTimeZoneOffsetMinutes = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return Math.round((asUtc - date.getTime()) / 60000);
};
const parseRomeLocalDateTimeToUtcDate = (value) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const baseUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(baseUtcMs);
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = getTimeZoneOffsetMinutes(guess, 'Europe/Rome');
    guess = new Date(baseUtcMs - offsetMinutes * 60000);
  }
  return guess;
};
const getTargetReferenceDate = (target) => {
  if (target.target_datetime_start) return parseRomeLocalDateTimeToUtcDate(target.target_datetime_start);
  if (target.target_date_start) return new Date(target.target_date_start + 'T12:00:00Z');
  if (target.target_date) return new Date(target.target_date + 'T12:00:00Z');
  return null;
};

const getMonthsForLocalDateRange = (startValue, endValue = startValue) => {
  const parseLocalYmd = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) };
  };

  const start = parseLocalYmd(startValue) || parseLocalYmd(endValue);
  const end = parseLocalYmd(endValue) || start;
  if (!start) return [];

  const startKey = start.year * 12 + (start.month - 1);
  const endKey = Math.max(startKey, end.year * 12 + (end.month - 1));
  const months = [];
  for (let key = startKey; key <= endKey && months.length < 24; key++) {
    months.push({
      year: Math.floor(key / 12),
      month: (key % 12) + 1
    });
  }
  return months;
};

function getCurrentNodeOverride() {
  return (config.nodeOverrides && config.nodeOverrides[NODE_ID]) || {};
}

function getCurrentTargetType() {
  const nodeOverride = getCurrentNodeOverride();
  return (nodeOverride && nodeOverride.mode) || config.application.mode || "underground";
}

function buildEffectiveTarget(rawTarget, nodeOverride = getCurrentNodeOverride(), options = {}) {
  if (!rawTarget) return null;

  const overrides = {};
  const shouldLogRolling = options.logRolling === true;

  if (nodeOverride.time_range) overrides.time_range = nodeOverride.time_range;
  if (nodeOverride.tickets) overrides.tickets = nodeOverride.tickets;
  if (nodeOverride.ticketSearchMode) overrides.ticketSearchMode = nodeOverride.ticketSearchMode;
  if (nodeOverride.ticket_search_mode) overrides.ticketSearchMode = nodeOverride.ticket_search_mode;

  if (nodeOverride.rolling_days_ahead !== undefined) {
    const romeDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    const [ry, rm, rd] = romeDate.split('-').map(Number);
    const todayRome = new Date(Date.UTC(ry, rm - 1, rd));
    const startDate = new Date(todayRome);
    startDate.setUTCDate(startDate.getUTCDate() + nodeOverride.rolling_days_ahead);
    const count = nodeOverride.rolling_days_count || 3;
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + count - 1);
    overrides.target_date_start = startDate.toISOString().split('T')[0];
    overrides.target_date_end = endDate.toISOString().split('T')[0];

    if (shouldLogRolling && (!global._lastRollingLog || global._lastRollingLog !== overrides.target_date_start)) {
      global._lastRollingLog = overrides.target_date_start;
      log('СЂСџвЂњвЂ¦', `[ROLLING] Р вЂќР С‘Р В°Р С—Р В°Р В·Р С•Р Р…: ${overrides.target_date_start} РІР‚вЂќ ${overrides.target_date_end} (today+${nodeOverride.rolling_days_ahead}, ${count}Р Т‘)`);
    }
  } else if (nodeOverride.target_datetime_start || nodeOverride.target_datetime_end) {
    overrides.target_datetime_start = nodeOverride.target_datetime_start;
    overrides.target_datetime_end = nodeOverride.target_datetime_end;
  } else if (nodeOverride.target_date_start) {
    overrides.target_date_start = nodeOverride.target_date_start;
    overrides.target_date_end = nodeOverride.target_date_end;
  } else if (nodeOverride.target_date) {
    overrides.target_date = nodeOverride.target_date;
  }

  if (Object.keys(overrides).length === 0) {
    return rawTarget;
  }

  const target = { ...rawTarget, ...overrides };
  if (overrides.target_datetime_start || overrides.target_datetime_end) {
    delete target.target_date;
    delete target.target_date_start;
    delete target.target_date_end;
    delete target.time_range;
  }
  if (overrides.target_date_start) {
    delete target.target_date;
  }

  return target;
}

function formatTargetWindowForLog(target) {
  if (!target) return 'n/a';
  if (target.target_datetime_start || target.target_datetime_end) {
    return `${target.target_datetime_start || 'РІР‚вЂќ'} -> ${target.target_datetime_end || 'РІР‚вЂќ'}`;
  }
  if (target.target_date_start || target.target_date_end) {
    const dateRange = `${target.target_date_start || 'РІР‚вЂќ'} -> ${target.target_date_end || 'РІР‚вЂќ'}`;
    if (target.time_range) {
      return `${dateRange} ${target.time_range.start || 'РІР‚вЂќ'}-${target.time_range.end || 'РІР‚вЂќ'}`;
    }
    return dateRange;
  }
  if (target.target_date) {
    if (target.time_range) {
      return `${target.target_date} ${target.time_range.start || 'РІР‚вЂќ'}-${target.time_range.end || 'РІР‚вЂќ'}`;
    }
    return target.target_date;
  }
  if (target.min_days_ahead !== undefined) {
    return `rolling ${target.min_days_ahead}+`;
  }
  return 'n/a';
}

function getCurrentTargetContext() {
  const mode = getCurrentTargetType();
  const rawTarget = (config.targets || []).find(t => t.type === mode);
  const target = buildEffectiveTarget(rawTarget, getCurrentNodeOverride(), { logRolling: false });
  return {
    version: config.configMeta?.version || 0,
    mode,
    target
  };
}

function log(emoji, message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] [NODE ${NODE_ID}] ${emoji} ${message}`);
}

function readWebPaymentRequest() {
  if (!fs.existsSync(PAY_REQUEST_PATH)) return null;

  try {
    const raw = fs.readFileSync(PAY_REQUEST_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    let ageMs = Infinity;
    try { ageMs = Date.now() - fs.statSync(PAY_REQUEST_PATH).mtimeMs; } catch {}
    if (ageMs < 5000) {
      log('WARN', `[PAYMENT] request_file_not_ready age_ms=${Math.max(0, Math.round(ageMs))} error="${error.message}"`);
      return null;
    }
    log('WARN', `[PAYMENT] cart_modify_failed reason=invalid_request_file error="${error.message}"`);
    notifyTelegram(`РћС€РёР±РєР° web-РѕРїР»Р°С‚С‹: РЅРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ ${PAY_REQUEST_PATH}: ${error.message}`);
    return { invalid: true, error: error.message };
  }
}

function removeWebPaymentRequest() {
  try {
    if (fs.existsSync(PAY_REQUEST_PATH)) fs.unlinkSync(PAY_REQUEST_PATH);
  } catch (error) {
    log('WARN', `[PAYMENT] cleanup_failed path=${PAY_REQUEST_PATH} error="${error.message}"`);
  }
}

function normalizePassengerEntry(entry, type) {
  if (!entry || typeof entry !== 'object') return null;
  const firstName = String(entry.firstName || '').trim();
  const lastName = String(entry.lastName || '').trim();
  if (!firstName || !lastName) return null;
  return { firstName, lastName, type };
}

function normalizePaymentPassengerDetails(request, adults, children) {
  const inputParticipants = Array.isArray(request?.participants) ? request.participants : null;
  const configuredParticipants = Array.isArray(config.participants) ? config.participants : [];
  const sourceParticipants = inputParticipants || configuredParticipants;
  const adultsPool = sourceParticipants
    .filter((entry) => String(entry?.type || 'adult').toLowerCase() === 'adult')
    .map((entry) => normalizePassengerEntry(entry, 'adult'))
    .filter(Boolean);
  const childrenPool = sourceParticipants
    .filter((entry) => String(entry?.type || '').toLowerCase() === 'child')
    .map((entry) => normalizePassengerEntry(entry, 'child'))
    .filter(Boolean);

  const guideSource = request?.guideDetails || (request?.guide && typeof request.guide === 'object' ? request.guide : null) || config.guide || configuredParticipants.find((entry) => String(entry?.type || '').toLowerCase() === 'guide') || {};
  const guide = normalizePassengerEntry({ ...guideSource, type: 'guide' }, 'guide');
  if (guide) {
    guide.licenseNumber = String(guideSource.licenseNumber || guideSource.license || guideSource.cardNumber || '').trim();
  }

  return {
    adults: adultsPool.slice(0, adults),
    children: childrenPool.slice(0, children),
    guide
  };
}

function getPaymentQuantityValidationError(adults, children, currentQty, options = {}) {
  if (!Number.isInteger(adults) || adults < MIN_PAYMENT_ADULTS) {
    return {
      reason: 'invalid_adults_min',
      message: `adults must be an integer >= ${MIN_PAYMENT_ADULTS}`
    };
  }
  if (!Number.isInteger(children) || children < 0) {
    return {
      reason: 'invalid_children',
      message: 'children must be an integer >= 0'
    };
  }
  if (!currentQty) {
    return {
      reason: 'missing_cart_items',
      message: 'active cart item data is missing'
    };
  }
  const paidParticipants = adults + children;
  const minParticipants = Math.max(1, Number(options.minParticipants || MIN_PAYMENT_PARTICIPANTS));
  if (!options.checkoutOnly && paidParticipants < minParticipants) {
    return {
      reason: 'below_min_total',
      message: `minimum ${minParticipants + Math.max(0, Number(options.guideQty || 0))} tickets total`
    };
  }
  if (paidParticipants > currentQty) {
    return {
      reason: 'too_many_requested',
      message: `requested ${paidParticipants}, caught ${currentQty}`
    };
  }
  return null;
}

function applyWebPaymentRequest(request) {
  if (!request) return true;

  const adults = Number(request.adults);
  const children = Number(request.children || 0);
  const currentQty = getCartItemsNonGuideQty(cartItemsInfo);
  const currentAdults = getCartItemsAdultQty(cartItemsInfo);
  const currentChildren = getCartItemsChildQty(cartItemsInfo);
  const currentGuide = getCartItemsGuideQty(cartItemsInfo);
  const requestGuide = Math.max(0, Number(request.guide ?? currentGuide) || 0);
  const checkoutOnly = Boolean(request.checkoutOnly || request.skipCartModification || request.directCheckout);
  const minParticipants = currentGuide > 0 ? MIN_PAYMENT_PARTICIPANTS : 1;

  if (request.invalid) {
    removeWebPaymentRequest();
    return false;
  }

  if (requestGuide !== currentGuide) {
    log('WARN', `[PAYMENT] cart_modify_failed reason=guide_mismatch requestedGuide=${requestGuide} caughtGuide=${currentGuide}`);
    notifyTelegram(`Payment error: requested guide ${requestGuide}, caught guide ${currentGuide}.`);
    removeWebPaymentRequest();
    return false;
  }

  if (checkoutOnly && (adults !== currentAdults || children !== currentChildren)) {
    log('WARN', `[PAYMENT] cart_modify_failed reason=checkout_only_mismatch adults=${adults} children=${children} caughtAdults=${currentAdults} caughtChildren=${currentChildren} guide=${currentGuide}`);
    notifyTelegram('Payment error: checkout-only request does not match the caught cart.');
    removeWebPaymentRequest();
    return false;
  }

  const validationError = getPaymentQuantityValidationError(adults, children, currentQty, {
    checkoutOnly,
    guideQty: currentGuide,
    minParticipants
  });
  if (validationError) {
    log('WARN', `[PAYMENT] cart_modify_failed reason=${validationError.reason} adults=${request.adults} children=${request.children || 0} caughtNonGuide=${currentQty}`);
    notifyTelegram(`Payment error: ${validationError.message}; adults can be 0+.`);
    removeWebPaymentRequest();
    return false;
  }

  if (!Number.isInteger(children) || children < 0) {
    log('WARN', `[PAYMENT] cart_modify_failed reason=invalid_children children=${request.children}`);
    notifyTelegram(`РћС€РёР±РєР° web-РѕРїР»Р°С‚С‹: РґРµС‚СЃРєРёРµ Р±РёР»РµС‚С‹ РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ С†РµР»С‹Рј С‡РёСЃР»РѕРј РѕС‚ 0, РїРѕР»СѓС‡РµРЅРѕ ${request.children}.`);
    removeWebPaymentRequest();
    return false;
  }

  if (!currentQty) {
    log('WARN', `[PAYMENT] cart_modify_failed reason=missing_cart_items adults=${adults} children=${children}`);
    notifyTelegram('РћС€РёР±РєР° web-РѕРїР»Р°С‚С‹: Р±РѕС‚ РЅРµ РІРёРґРёС‚ РґР°РЅРЅС‹Рµ Р°РєС‚РёРІРЅРѕР№ РєРѕСЂР·РёРЅС‹, РёР·РјРµРЅРµРЅРёРµ РєРѕР»РёС‡РµСЃС‚РІР° РЅРµРІРѕР·РјРѕР¶РЅРѕ.');
    removeWebPaymentRequest();
    return false;
  }

  if (adults + children > currentQty) {
    log('WARN', `[PAYMENT] cart_modify_failed reason=too_many_requested adults=${adults} children=${children} caughtNonGuide=${currentQty}`);
    notifyTelegram(`РћС€РёР±РєР° web-РѕРїР»Р°С‚С‹: РїРѕР№РјР°РЅРѕ ${currentQty} РЅРµ-guide СЃР»РѕС‚РѕРІ, Р·Р°РїСЂРѕС€РµРЅРѕ ${adults + children}.`);
    removeWebPaymentRequest();
    return false;
  }

  payDialogActive = false;
  payDialogOwnerId = null;
  payDialogStartedAtMs = 0;
  payDesiredAdults = adults;
  payDesiredChildren = children;
  payCheckoutOnly = checkoutOnly;
  payPassengerDetails = PAYMENT_PASSENGER_AUTOFILL_ENABLED
    ? normalizePaymentPassengerDetails(request, adults, children)
    : null;
  payCommandReceived = !shouldDeferPaymentModification();
  removeWebPaymentRequest();

  const passengerCount = (payPassengerDetails?.adults?.length || 0) + (payPassengerDetails?.children?.length || 0) + (payPassengerDetails?.guide ? 1 : 0);
  log('PAYMENT', `[PAYMENT] payment_request_received source=web adults=${adults} children=${children} guide=${currentGuide} checkoutOnly=${checkoutOnly ? 'yes' : 'no'} caughtNonGuide=${currentQty} passengerDetails=${passengerCount} passengerAutofill=${PAYMENT_PASSENGER_AUTOFILL_ENABLED ? 'enabled' : 'disabled'}`);
  if (payCommandReceived) {
    notifyTelegram(`Web payment accepted: ${adults} adults + ${children} children + ${currentGuide} guide. ${checkoutOnly ? 'Opening checkout without cart edit...' : 'Editing cart...'}`);
  } else {
    const retryReason = paymentModifyInFlight ? 'in_flight' : (paymentModifyRetryReason || 'cooldown');
    const retryInMs = logPaymentModifyDeferred(retryReason, adults, children, 'source=web');
    notifyTelegram(`Web payment accepted: ${adults} adults + ${children} children + ${currentGuide} guide. Cart is held; retrying automatically in ~${Math.max(1, Math.ceil(retryInMs / 1000))}s.`);
  }
  return true;
}

/**
 * Absolute Epoch Grid: Р В Р В°РЎРѓРЎРѓРЎвЂЎР С‘РЎвЂљРЎвЂ№Р Р†Р В°Р ВµРЎвЂљ Р В·Р В°Р Т‘Р ВµРЎР‚Р В¶Р С”РЎС“ Р Т‘Р С• РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р ВµР С–Р С• РЎРѓР В»Р С•РЎвЂљР В° Р Р…Р С•Р Т‘РЎвЂ№.
 */
function calcSyncedRetryDelay() {
  const state = getSchedulerState();
  if (!state.active) return state.cycleMs;

  const now = Date.now();
  const mySlot = state.slotOffsetMs;

  // Р СњР В°РЎвЂЎР В°Р В»Р С• РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР в„– РЎРЊР С—Р С•РЎвЂ¦Р С‘ (Р С—РЎР‚Р С‘Р Р†РЎРЏР В·Р С”Р В° Р С” UNIX epoch, Р С•Р Т‘Р С‘Р Р…Р В°Р С”Р С•Р Р†Р В° Р Т‘Р В»РЎРЏ Р Р†РЎРѓР ВµРЎвЂ¦ РЎРѓР ВµРЎР‚Р Р†Р ВµРЎР‚Р С•Р Р†)
  const cycleStart = now - (now % state.cycleMs);

  // Р ВР Т‘Р ВµР В°Р В»РЎРЉР Р…РЎвЂ№Р в„– Р СР С•Р СР ВµР Р…РЎвЂљ Р Р†РЎвЂ№РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р Р† РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР в„– РЎРЊР С—Р С•РЎвЂ¦Р Вµ
  let fireTime = cycleStart + mySlot;

  // Р вЂўРЎРѓР В»Р С‘ Р СР С•Р в„– РЎРѓР В»Р С•РЎвЂљ Р Р† РЎРЊРЎвЂљР С•Р в„– РЎРЊР С—Р С•РЎвЂ¦Р Вµ РЎС“Р В¶Р Вµ Р С—РЎР‚Р С•РЎв‚¬Р ВµР В» РІР‚вЂќ Р В¶Р Т‘РЎС“ РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°РЎС“РЎР‹ РЎРЊР С—Р С•РЎвЂ¦РЎС“
  if (fireTime <= now) {
    fireTime += state.cycleMs;
  }

  // Р СџР С•Р В»Р С•Р В¶Р С‘РЎвЂљР ВµР В»РЎРЉР Р…РЎвЂ№Р в„– Р Т‘Р В¶Р С‘РЎвЂљРЎвЂљР ВµРЎР‚ (100-1500ms) РІР‚вЂќ Р Т‘Р ВµР В»Р В°Р ВµРЎвЂљ Р С—Р В°РЎвЂљРЎвЂљР ВµРЎР‚Р Р… Р С•РЎР‚Р С–Р В°Р Р…Р С‘РЎвЂЎР Р…РЎвЂ№Р С
  return Math.max(10, Math.round(fireTime - now));
}

/**
 * Р вЂ“Р Т‘РЎвЂРЎвЂљ Р Т‘Р С• РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р ВµР С–Р С• РЎРѓР В»Р С•РЎвЂљР В° Р Р…Р С•Р Т‘РЎвЂ№ Р Р† Р С’Р В±РЎРѓР С•Р В»РЎР‹РЎвЂљР Р…Р С•Р в„– Р В­Р С—Р С•РЎвЂ¦Р В°Р В»РЎРЉР Р…Р С•Р в„– Р РЋР ВµРЎвЂљР С”Р Вµ.
 */
async function waitForNextPoll() {
  const state = getSchedulerState();
  if (!state.active) {
    log('SCHEDULER', `[SCHEDULER] strict_grid inactive node=${state.nodeId} active_nodes=${state.activeNodeIds.join(',')} polling=disabled sleep_ms=${state.cycleMs}`);
    await sleep(state.cycleMs);
    return false;
  }

  const delayMs = calcSyncedRetryDelay();
  log('SCHEDULER', `[SCHEDULER] strict_grid next_poll_in_ms=${delayMs} node=${state.nodeId} slot=${state.slotIndex + 1}/${state.slotCount} offset_ms=${state.slotOffsetMs} step_ms=${state.slotMs.toFixed(0)} cycle_ms=${state.cycleMs} extra_retry=false`);
  reportProxyLeaseEvent('lease_refresh', 'strict_grid_wait');
  await sleep(delayMs);
  return true;
}

function getPrimaryPollingTargetForPrewarm() {
  const liveNodeOverride = getCurrentNodeOverride();
  const liveTargetType = getCurrentTargetType();
  const rawTarget = (config.targets || []).find((item) => item.type === liveTargetType);
  if (!rawTarget) return null;
  return buildEffectiveTarget(rawTarget, liveNodeOverride, { logRolling: false });
}

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  PROXY ENGINE: РЎР‚Р С•РЎвЂљР В°РЎвЂ Р С‘РЎРЏ, Р С—Р С•Р С‘РЎРѓР С” РЎРѓР Р†Р С•Р В±Р С•Р Т‘Р Р…РЎвЂ№РЎвЂ¦, Р С—Р ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘Р Вµ
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
function getLegacyNodeProxies() {
  return (config.proxies && config.proxies[NODE_ID]) || [];
}

function getActiveSharedProxyNodeIds() {
  const explicit = Array.isArray(config.proxyPool?.activeNodeIds)
    ? config.proxyPool.activeNodeIds
    : (Array.isArray(config.scheduler?.activeNodeIds) ? config.scheduler.activeNodeIds : []);
  const disabled = new Set(
    (Array.isArray(config.proxyPool?.disabledNodeIds) ? config.proxyPool.disabledNodeIds : [2])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
  return Array.from(new Set(
    explicit
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0 && !disabled.has(value))
  )).sort((a, b) => a - b);
}

function isSharedProxyPoolActiveForNode() {
  return SHARED_PROXY_POOL_ENABLED && getActiveSharedProxyNodeIds().includes(Number(NODE_ID));
}

function parseProxySourceLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length !== 4) return null;
  const [host, portRaw, username, password] = parts;
  const port = Number(portRaw);
  if (!host || !Number.isInteger(port) || port <= 0 || !username || !password) return null;
  return { host, port, username, password };
}

function loadSharedProxyPoolFromConfig() {
  const seen = new Set();
  const result = [];
  const disabled = new Set(
    (Array.isArray(config.proxyPool?.disabledNodeIds) ? config.proxyPool.disabledNodeIds : [2])
      .map((value) => Number(value))
  );
  const groups = config.proxies && typeof config.proxies === 'object' ? config.proxies : {};
  for (const [nodeId, proxies] of Object.entries(groups)) {
    if (disabled.has(Number(nodeId)) || !Array.isArray(proxies)) continue;
    for (const proxy of proxies) {
      if (!proxy?.host || !proxy?.port) continue;
      const key = `${proxy.host}:${proxy.port}:${proxy.username || ''}:${proxy.password || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        host: proxy.host,
        port: Number(proxy.port),
        username: proxy.username || '',
        password: proxy.password || ''
      });
    }
  }
  return result;
}

function loadSharedProxyPool() {
  if (sharedProxyPoolCache && Array.isArray(sharedProxyPoolCache.proxies)) {
    return sharedProxyPoolCache.proxies;
  }

  let proxies = [];
  let source = SHARED_PROXY_SOURCE_PATH;
  try {
    const lines = fs.readFileSync(SHARED_PROXY_SOURCE_PATH, 'utf8').split(/\r?\n/);
    proxies = lines.map(parseProxySourceLine).filter(Boolean);
  } catch (error) {
    source = 'config.proxies';
    proxies = loadSharedProxyPoolFromConfig();
    log('WARN', `[PROXY POOL] raw source unavailable path=${SHARED_PROXY_SOURCE_PATH} fallback=config.proxies error=${error.message}`);
  }

  sharedProxyPoolCache = {
    source,
    proxies: proxies.map((proxy, index) => ({
      ...proxy,
      proxyId: String(index),
      index
    }))
  };
  return sharedProxyPoolCache.proxies;
}

function getNodeProxies() {
  if (SHARED_PROXY_POOL_ENABLED) {
    return isSharedProxyPoolActiveForNode() ? loadSharedProxyPool() : [];
  }
  return getLegacyNodeProxies();
}

function getProxyLeaseCoordinatorBaseUrl() {
  const configured = config.proxyPool?.coordinatorUrl || process.env.PROXY_LEASE_COORDINATOR_URL || '';
  if (configured) return String(configured).replace(/\/+$/, '');
  const host = config.coordination?.masterIp || process.env.COORDINATOR_IP || '127.0.0.1';
  return `https://${host}:3000`;
}

function postJsonWithTimeout(url, payload, timeoutMs = PROXY_LEASE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const body = JSON.stringify(payload || {});
    const client = targetUrl.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search || ''}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      rejectUnauthorized: process.env.COORD_TLS_INSECURE === '1' ? false : undefined,
      timeout: timeoutMs
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(responseBody || '{}'); } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve({ ok: false, error: `http_${res.statusCode}`, statusCode: res.statusCode, body: responseBody.slice(0, 500), data: parsed });
        }
        if (parsed) return resolve(parsed);
        resolve({ ok: false, error: `invalid_json_http_${res.statusCode}`, body: responseBody.slice(0, 500) });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout_${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function selectSharedFallbackProxy(reason = 'fallback', avoidCurrent = true) {
  const proxies = getNodeProxies();
  if (!proxies.length) return false;
  const oldIdx = currentProxyIndex;
  const seed = hashSeed(`${NODE_ID}:${reason}:${Math.floor(Date.now() / 60000)}`);
  const baseOffset = (seed % Math.max(1, proxies.length - 1)) + 1;
  let nextIdx = (currentProxyIndex + baseOffset) % proxies.length;
  if (!avoidCurrent || proxies.length === 1) {
    nextIdx = (currentProxyIndex + seed) % proxies.length;
  } else if (nextIdx === currentProxyIndex) {
    nextIdx = (currentProxyIndex + 1) % proxies.length;
  }
  selectCurrentProxy(nextIdx);
  currentProxyLease = {
    fallback: true,
    proxy: { proxyId: String(nextIdx), index: nextIdx },
    leaseUntilMs: Date.now() + 60000
  };
  log('WARN', `[PROXY LEASE] coordinator fallback ring reason=${reason} old_proxy=${oldIdx} new_proxy=${currentProxyIndex} total=${proxies.length}`);
  return true;
}

async function acquireProxyLease(reason = 'browser_start', options = {}) {
  if (!isSharedProxyPoolActiveForNode()) return false;
  const proxies = getNodeProxies();
  if (!proxies.length) return false;

  const avoidProxyId = options.avoidCurrent ? String(currentProxyIndex) : null;
  if (Date.now() < proxyLeaseUnavailableUntilMs) {
    if (PROXY_LEASE_ALLOW_LOCAL_FALLBACK) {
      return selectSharedFallbackProxy(reason, Boolean(options.avoidCurrent));
    }
    return { ok: false, error: 'coordinator_backoff', retryAfterMs: Math.max(1000, proxyLeaseUnavailableUntilMs - Date.now()) };
  }

  const url = `${getProxyLeaseCoordinatorBaseUrl()}/api/proxy-leases/acquire`;
  try {
    const response = await postJsonWithTimeout(url, {
      nodeId: Number(NODE_ID),
      reason,
      currentProxyId: String(currentProxyIndex),
      avoidProxyId
    }, PROXY_LEASE_TIMEOUT_MS);
    if (!response || !response.ok || !response.proxy) {
      return {
        ok: false,
        error: response?.error || 'lease_not_granted',
        retryAfterMs: Number(response?.retryAfterMs || 0) || 3000,
        totalProxies: response?.totalProxies,
        leased: response?.leased
      };
    }

    const proxyIdx = Number(response.proxy.index ?? response.proxy.proxyId);
    if (!Number.isInteger(proxyIdx) || proxyIdx < 0 || proxyIdx >= proxies.length) {
      throw new Error(`invalid_proxy_index_${response.proxy.index ?? response.proxy.proxyId}`);
    }

    const oldIdx = currentProxyIndex;
    selectCurrentProxy(proxyIdx);
    currentProxyLease = {
      fallback: false,
      proxy: response.proxy,
      leaseUntilMs: Number(response.leaseUntilMs || 0),
      leaseOwnerNodeId: response.leaseOwnerNodeId
    };
    proxyLeaseUnavailableUntilMs = 0;
    log('PROXY', `[PROXY LEASE] acquired reason=${reason} old_proxy=${oldIdx} new_proxy=${currentProxyIndex} ttl_ms=${Math.max(0, currentProxyLease.leaseUntilMs - Date.now())} total=${response.totalProxies || proxies.length}`);
    return { ok: true };
  } catch (error) {
    proxyLeaseUnavailableUntilMs = Date.now() + PROXY_LEASE_FAILURE_BACKOFF_MS;
    if (PROXY_LEASE_ALLOW_LOCAL_FALLBACK) {
      log('WARN', `[PROXY LEASE] coordinator unavailable reason=${reason} error=${error.message}; using fallback ring`);
      return { ok: selectSharedFallbackProxy(reason, Boolean(options.avoidCurrent)), fallback: true };
    }
    log('WARN', `[PROXY LEASE] coordinator unavailable reason=${reason} error=${error.message}; waiting for coordinator to avoid duplicate proxy use`);
    return { ok: false, error: 'coordinator_unavailable', retryAfterMs: PROXY_LEASE_FAILURE_BACKOFF_MS };
  }
}

async function acquirePreloadProxyLease(reason = 'preload_recatch') {
  if (!isSharedProxyPoolActiveForNode()) return null;
  const proxies = getNodeProxies();
  if (!proxies.length) return null;
  const url = `${getProxyLeaseCoordinatorBaseUrl()}/api/proxy-leases/acquire`;
  const response = await postJsonWithTimeout(url, {
    nodeId: Number(NODE_ID),
    reason,
    currentProxyId: String(currentProxyIndex),
    avoidProxyId: String(currentProxyIndex)
  }, PROXY_LEASE_TIMEOUT_MS);
  if (!response || !response.ok || !response.proxy) {
    log('WARN', `[PROXY LEASE] preload lease not granted reason=${reason} error=${response?.error || 'lease_not_granted'} leased=${response?.leased ?? '?'} total=${response?.totalProxies ?? proxies.length}`);
    return null;
  }
  const proxyIdx = Number(response.proxy.index ?? response.proxy.proxyId);
  if (!Number.isInteger(proxyIdx) || proxyIdx < 0 || proxyIdx >= proxies.length) {
    throw new Error(`invalid_preload_proxy_index_${response.proxy.index ?? response.proxy.proxyId}`);
  }
  return {
    proxyIdx,
    proxy: proxies[proxyIdx],
    proxyLease: {
      fallback: false,
      proxy: response.proxy,
      leaseUntilMs: Number(response.leaseUntilMs || 0),
      leaseOwnerNodeId: response.leaseOwnerNodeId
    }
  };
}

function getProxyLeaseTtlMs() {
  return Math.max(30000, Number(config.proxyPool?.leaseTtlMs || 180000));
}

function refreshProxyLease(lease = currentProxyLease, context = 'lease_refresh', extra = {}) {
  if (!isSharedProxyPoolActiveForNode() || !lease || lease.fallback || !lease.proxy) return false;
  const proxyId = lease.proxy.proxyId ?? lease.proxy.index;
  if (proxyId === undefined || proxyId === null || proxyId === '') return false;
  const proxyIndex = Number(lease.proxy.index ?? lease.proxy.proxyId ?? currentProxyIndex);
  const refreshedUntilMs = Date.now() + getProxyLeaseTtlMs();
  lease.leaseUntilMs = refreshedUntilMs;
  const url = `${getProxyLeaseCoordinatorBaseUrl()}/api/proxy-leases/report`;
  postJsonWithTimeout(url, {
    nodeId: Number(NODE_ID),
    proxyId: String(proxyId),
    event: 'lease_refresh',
    context,
    currentProxyIndex: Number.isInteger(proxyIndex) ? proxyIndex : currentProxyIndex,
    leaseUntilMs: refreshedUntilMs,
    ...extra
  }, Math.min(800, PROXY_LEASE_TIMEOUT_MS)).catch(() => {});
  return true;
}

function startProxyLeaseRefreshTimer() {
  if (!isSharedProxyPoolActiveForNode() || proxyLeaseRefreshTimer) return;
  proxyLeaseRefreshTimer = setInterval(() => {
    refreshProxyLease(currentProxyLease, 'periodic_active_browser');
  }, PROXY_LEASE_REFRESH_INTERVAL_MS);
  if (typeof proxyLeaseRefreshTimer.unref === 'function') proxyLeaseRefreshTimer.unref();
  log('PROXY', `[PROXY LEASE] periodic_refresh enabled interval_ms=${PROXY_LEASE_REFRESH_INTERVAL_MS}`);
}

function reportProxyLeaseEvent(event, context = '', extra = {}) {
  if (!isSharedProxyPoolActiveForNode()) return;
  if (event === 'lease_refresh') {
    refreshProxyLease(currentProxyLease, context, extra);
    return;
  }
  const proxyId = currentProxyLease?.proxy?.proxyId ?? String(currentProxyIndex);
  const url = `${getProxyLeaseCoordinatorBaseUrl()}/api/proxy-leases/report`;
  postJsonWithTimeout(url, {
    nodeId: Number(NODE_ID),
    proxyId,
    event,
    context,
    currentProxyIndex,
    leaseUntilMs: currentProxyLease?.leaseUntilMs || 0,
    ...extra
  }, Math.min(800, PROXY_LEASE_TIMEOUT_MS)).catch(() => {});
}

function getProxyLeaseReleaseTarget(lease = currentProxyLease) {
  if (!isSharedProxyPoolActiveForNode()) return null;
  if (!lease || lease.fallback || !lease.proxy) return null;
  const proxyId = lease.proxy.proxyId ?? lease.proxy.index;
  if (proxyId === undefined || proxyId === null || proxyId === '') return null;
  return {
    proxyId: String(proxyId),
    index: Number(lease.proxy.index ?? lease.proxy.proxyId ?? currentProxyIndex),
    leaseUntilMs: Number(lease.leaseUntilMs || 0)
  };
}

function queueProxyLeaseRelease(reason, lease = currentProxyLease) {
  const target = getProxyLeaseReleaseTarget(lease);
  if (!target) return false;
  const key = `${target.proxyId}:${target.index}`;
  if (!pendingProxyLeaseReleases.some((item) => `${item.proxyId}:${item.index}` === key)) {
    pendingProxyLeaseReleases.push({ ...target, reason: reason || 'browser_closed' });
    if (pendingProxyLeaseReleases.length > 20) {
      pendingProxyLeaseReleases = pendingProxyLeaseReleases.slice(-20);
    }
  }
  return true;
}

function releaseProxyLeaseNow(target, reason = 'browser_closed') {
  if (!isSharedProxyPoolActiveForNode() || !target || !target.proxyId) return Promise.resolve(false);
  const url = `${getProxyLeaseCoordinatorBaseUrl()}/api/proxy-leases/report`;
  return postJsonWithTimeout(url, {
    nodeId: Number(NODE_ID),
    proxyId: String(target.proxyId),
    event: 'release',
    context: reason,
    currentProxyIndex: Number.isInteger(Number(target.index)) ? Number(target.index) : currentProxyIndex,
    leaseUntilMs: Number(target.leaseUntilMs || 0)
  }, Math.min(800, PROXY_LEASE_TIMEOUT_MS))
    .then(() => true)
    .catch(() => false);
}

async function flushPendingProxyLeaseReleases(reason = 'browser_closed') {
  if (!pendingProxyLeaseReleases.length) return;
  const releases = pendingProxyLeaseReleases.splice(0, pendingProxyLeaseReleases.length);
  await Promise.all(releases.map((target) => releaseProxyLeaseNow(target, reason || target.reason)));
  log('PROXY', `[PROXY LEASE] released_after_browser_close count=${releases.length} reason=${reason}`);
}

function resolveBrowserProxyIndex(browser, options = {}) {
  if (options.proxyIdx !== undefined && options.proxyIdx !== null) {
    const optIdx = Number(options.proxyIdx);
    if (Number.isInteger(optIdx) && optIdx >= 0) return optIdx;
  }
  const browserIdx = browser && Number(browser.__sniperProxyIndex);
  if (Number.isInteger(browserIdx) && browserIdx >= 0) return browserIdx;
  return currentProxyIndex;
}

function getBrowserProxyIndex(browser) {
  const browserIdx = browser && Number(browser.__sniperProxyIndex);
  return Number.isInteger(browserIdx) && browserIdx >= 0 ? browserIdx : null;
}

function browserProxyMismatch(browser) {
  const browserIdx = getBrowserProxyIndex(browser);
  return browserIdx !== null && browserIdx !== currentProxyIndex;
}

function redactProxy(proxy) {
  if (!proxy) return 'direct';
  const host = proxy.host || proxy.hostname || 'unknown';
  const port = proxy.port || 'unknown';
  return `${host}:${port}`;
}

function buildProxyContext(proxyIdx = currentProxyIndex, proxy = currentProxy, relay = {}, options = {}) {
  const resolvedIdx = Number.isInteger(Number(proxyIdx)) ? Number(proxyIdx) : currentProxyIndex;
  const relayPort = relay && relay.localPort ? Number(relay.localPort) : null;
  const viaRelay = Boolean(relay && relay.viaRelay);
  const hasAuth = Boolean(proxy && (proxy.username || proxy.user || proxy.password || proxy.pass));
  let proxyMode = 'direct';
  if (proxy && viaRelay) proxyMode = 'relay';
  else if (proxy && hasAuth) proxyMode = 'chrome-auth';
  else if (proxy) proxyMode = 'proxy-server';
  return {
    proxyMode,
    proxyIndex: resolvedIdx,
    proxyServer: redactProxy(proxy),
    relayPort,
    profile: options.profile || (proxy ? `proxy-${resolvedIdx}` : 'colosseo'),
    source: options.source || 'runtime',
    argsProxyServer: options.argsProxyServer || null
  };
}

function formatProxyContext(ctx) {
  const c = ctx || buildProxyContext();
  const parts = [
    `proxyMode=${c.proxyMode || 'unknown'}`,
    `proxyIndex=${Number.isInteger(Number(c.proxyIndex)) ? Number(c.proxyIndex) : 'n/a'}`,
    `proxyServer=${c.proxyServer || 'direct'}`
  ];
  if (c.relayPort) parts.push(`relayPort=${c.relayPort}`);
  if (c.profile) parts.push(`profile=${c.profile}`);
  if (c.argsProxyServer) parts.push(`argsProxyServer=${c.argsProxyServer}`);
  if (c.source) parts.push(`source=${c.source}`);
  return parts.join(' ');
}

function getBrowserProxyContext(browser) {
  if (browser && browser.__sniperProxyContext) return browser.__sniperProxyContext;
  if (browser) {
    const idx = getBrowserProxyIndex(browser);
    const proxies = getNodeProxies();
    if (idx !== null) return buildProxyContext(idx, proxies[idx] || null, { localPort: browser.__sniperRelayPort, viaRelay: Boolean(browser.__sniperRelayPort) }, { source: 'browser_metadata' });
  }
  return activeBrowserProxyContext || buildProxyContext();
}

function getPageProxyContext(page) {
  try {
    if (page && typeof page.browser === 'function') return getBrowserProxyContext(page.browser());
  } catch (e) { /* non-critical metadata */ }
  return activeBrowserProxyContext || buildProxyContext();
}

function logProxyContext(phase, page = null, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  log('PROXY', `[NET] ${phase} ${formatProxyContext(getPageProxyContext(page))}${suffix}`);
}

function tagBrowserProxyMetadata(browser, proxyIdx, relay = {}, context = null) {
  if (!browser) return browser;
  try {
    browser.__sniperProxyIndex = Number(proxyIdx);
    browser.__sniperRelayPort = relay && relay.localPort ? Number(relay.localPort) : null;
    browser.__sniperProxyContext = context || buildProxyContext(proxyIdx, getNodeProxies()[Number(proxyIdx)] || currentProxy, relay, { source: 'tag' });
    activeBrowserProxyContext = browser.__sniperProxyContext;
    browser.__sniperCreatedAt = Date.now();
  } catch (e) { /* non-critical metadata */ }
  return browser;
}

async function closeBrowserAndFlushProxyReleases(browser, reason = 'browser_close', options = {}) {
  const relayProxyIdx = resolveBrowserProxyIndex(browser, options);
  if (!browser) {
    await flushPendingProxyLeaseReleases(reason);
    if (!options.keepRelay) stopProxyRelayForIndex(relayProxyIdx, reason);
    return;
  }
  await browser.close().catch(() => {});
  await flushPendingProxyLeaseReleases(reason);
  if (!options.keepRelay) stopProxyRelayForIndex(relayProxyIdx, reason);
}

async function ensureProxyLeaseForBrowser(reason = 'browser_start') {
  if (!isSharedProxyPoolActiveForNode()) return false;
  const leaseProxyIndex = Number(currentProxyLease?.proxy?.index ?? currentProxyLease?.proxy?.proxyId);
  const leaseValid = currentProxyLease
    && leaseProxyIndex === currentProxyIndex
    && Number(currentProxyLease.leaseUntilMs || 0) - Date.now() > 30000;
  if (leaseValid) {
    reportProxyLeaseEvent('lease_refresh', reason);
    return true;
  }
  while (isSharedProxyPoolActiveForNode()) {
    const result = await acquireProxyLease(reason, { avoidCurrent: false });
    if (result === true || result?.ok) return true;
    const requestedWaitMs = Number(result?.retryAfterMs || 0);
    const waitMs = Math.max(
      PROXY_LEASE_WAIT_MIN_MS,
      Math.min(PROXY_LEASE_WAIT_MAX_MS, requestedWaitMs || randomInt(PROXY_LEASE_WAIT_MIN_MS, PROXY_LEASE_WAIT_MAX_MS))
    );
    log('WARN', `[PROXY LEASE] waiting for free lease reason=${reason} error=${result?.error || 'unknown'} leased=${result?.leased ?? '?'} total=${result?.totalProxies ?? getNodeProxies().length} wait_ms=${waitMs}`);
    await sleep(waitMs);
  }
  return false;
}

function hashSeed(input) {
  let hash = 0;
  const value = String(input || '');
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function buildStartupProxySeedSource() {
  const nodeOverride = (config.nodeOverrides && config.nodeOverrides[NODE_ID]) || {};
  return [
    NODE_ID,
    (config.application && config.application.mode) || '',
    nodeOverride.mode || '',
    nodeOverride.target_datetime_start || nodeOverride.target_date_start || nodeOverride.target_date || '',
    nodeOverride.target_datetime_end || nodeOverride.target_date_end || '',
    (config.application && config.application.holdMode) ? 'hold' : 'scan'
  ].join('|');
}

function getStartupProxyIndex(proxyCount) {
  if (proxyCount <= 1) return 0;
  return hashSeed(buildStartupProxySeedSource()) % proxyCount;
}

function getProxyUnavailableUntil(idx, proxy = null, now = Date.now()) {
  return Math.max(
    Number(proxyBans[idx] || 0),
    getProxyCalendarBlacklistUntil(idx, proxy, now)
  );
}

function findUnbannedProxyFrom(startIdx) {
  const proxies = getNodeProxies();
  if (proxies.length === 0) return null;
  const now = Date.now();
  cleanupExpiredCalendarBlacklist(now, { save: true });
  for (let offset = 0; offset < proxies.length; offset++) {
    const idx = (startIdx + offset + proxies.length) % proxies.length;
    if (getProxyUnavailableUntil(idx, proxies[idx], now) <= now) return idx;
  }
  return null;
}

/**
 * Р ВРЎвЂ°Р ВµРЎвЂљ РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р С‘Р в„– Р Р…Р ВµР В±Р В°Р Р…РЎвЂР Р…Р Р…РЎвЂ№Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘ (Р Р…Р В°РЎвЂЎР С‘Р Р…Р В°РЎРЏ РЎРѓ РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР С–Р С•+1).
 * Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ Р С‘Р Р…Р Т‘Р ВµР С”РЎРѓ Р С‘Р В»Р С‘ null Р ВµРЎРѓР В»Р С‘ Р Р†РЎРѓР Вµ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…РЎвЂ№.
 */
function findUnbannedProxy() {
  return findUnbannedProxyFrom(currentProxyIndex + 1);
}

/**
 * Р СњР В°РЎвЂ¦Р С•Р Т‘Р С‘РЎвЂљ Р С—РЎР‚Р С•Р С”РЎРѓР С‘, Р С”Р С•РЎвЂљР С•РЎР‚РЎвЂ№Р в„– РЎР‚Р В°Р В·Р В±Р В°Р Р…Р С‘РЎвЂљРЎРѓРЎРЏ РЎР‚Р В°Р Р…РЎРЉРЎв‚¬Р Вµ Р Р†РЎРѓР ВµРЎвЂ¦.
 */
function findEarliestUnbanProxy() {
  const proxies = getNodeProxies();
  if (proxies.length === 0) return 0;
  let earliest = 0, earliestTime = Infinity;
  for (let i = 0; i < proxies.length; i++) {
    const ban = getProxyUnavailableUntil(i, proxies[i]);
    if (ban < earliestTime) { earliestTime = ban; earliest = i; }
  }
  return earliest;
}

/**
 * Р В¦Р ВµР Р…РЎвЂљРЎР‚Р В°Р В»РЎРЉР Р…Р В°РЎРЏ РЎвЂћРЎС“Р Р…Р С”РЎвЂ Р С‘РЎРЏ Р С—Р ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘РЎРЏ Р С—РЎР‚Р С•Р С”РЎРѓР С‘.
 * Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ true Р ВµРЎРѓР В»Р С‘ Р Р…Р В°РЎв‚¬РЎвЂР В» РЎРѓР Р†Р ВµР В¶Р С‘Р в„–, false Р ВµРЎРѓР В»Р С‘ Р Р†РЎРѓР Вµ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…РЎвЂ№.
 */
function switchProxy(reason) {
  const proxies = getNodeProxies();
  if (proxies.length === 0) return false;

  const oldIdx = currentProxyIndex;
  delete payloadMissCounts[oldIdx];
  delete calendar429Streaks[oldIdx];
  if (isSharedProxyPoolActiveForNode()) {
    queueProxyLeaseRelease(reason || 'proxy_rotated', currentProxyLease);
    currentProxyLease = null;
    internal403Count = 0;
    consecutive403Count = 0;
    hadRateLimit429 = false;
    saveBanState();
    log('PROXY', `[PROXY LEASE] current lease invalidated reason=${reason}; next browser waits for coordinator lease`);
    return true;
  }
  const unbanned = findUnbannedProxy();

  if (unbanned !== null) {
    currentProxyIndex = unbanned;
  } else {
    // Р вЂ™РЎРѓР Вµ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…РЎвЂ№ РІР‚вЂќ Р В±Р ВµРЎР‚РЎвЂР С РЎвЂљР С•РЎвЂљ, Р С”РЎвЂљР С• РЎР‚Р В°Р В·Р В±Р В°Р Р…Р С‘РЎвЂљРЎРѓРЎРЏ РЎР‚Р В°Р Р…РЎРЉРЎв‚¬Р Вµ
    currentProxyIndex = findEarliestUnbanProxy();
  }

  currentProxy = proxies[currentProxyIndex];
  internal403Count = 0;
  consecutive403Count = 0;
  hadRateLimit429 = false;

  log('СЂСџвЂќвЂћ', `Р РЋР СљР вЂўР СњР С’ Р СџР В Р С›Р С™Р РЋР В [${reason}]: #${oldIdx} РІвЂ вЂ™ #${currentProxyIndex} (${currentProxy.host}:${currentProxy.port})`);

  if (unbanned === null) {
    const nearest = proxyBans[currentProxyIndex] || 0;
    const mins = Math.ceil(Math.max(0, nearest - Date.now()) / 60000);
    log('РІС™В РїС‘РЏ', `Р вЂ™РЎРѓР Вµ ${proxies.length} Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…РЎвЂ№! Р вЂР В»Р С‘Р В¶Р В°Р в„–РЎв‚¬Р С‘Р в„– РЎР‚Р В°Р В·Р В±Р В°Р Р… РЎвЂЎР ВµРЎР‚Р ВµР В· ~${mins} Р СР С‘Р Р….`);
  }

  saveBanState();
  return unbanned !== null;
}

function rotateProxyAfterWafPressure(reason) {
  const oldIdx = currentProxyIndex;
  const globalState = recordGlobalWafPressure(reason || 'waf_pressure', oldIdx);
  reportProxyLeaseEvent(reason && String(reason).includes('cart') ? 'cart_pressure' : 'waf_pressure', reason || 'waf_pressure');
  const switched = switchProxy(`${reason || 'waf_pressure'} no-ban`);
  log('WARN', `[PROXY] WAF pressure rotate reason=${reason} old_proxy=${oldIdx} new_proxy=${currentProxyIndex} switched=${switched} cooldown=false distinct_proxies=${globalState.distinctProxies}`);
  return switched;
}

function rotateProxyAfterConnectFailure(reason) {
  const oldIdx = currentProxyIndex;
  reportProxyLeaseEvent('connect_fail', reason || 'connect_fail');
  const quarantined = quarantineCurrentProxy(reason || 'connect_fail', CONNECT_FAIL_COOLDOWN_MS);
  schedulePressureBackoff(reason || 'connect_fail');
  const switched = switchProxy(`${reason || 'connect_fail'} ${quarantined ? 'cooldown' : 'no-ban'}`);
  log('WARN', `[PROXY] connect_fail rotate reason=${reason} old_proxy=${oldIdx} new_proxy=${currentProxyIndex} switched=${switched} cooldown=${quarantined}`);
  return switched;
}

function rotateProxyAfterCalendar429Pressure(reason, streak) {
  const oldIdx = currentProxyIndex;
  reportProxyLeaseEvent('waf_pressure', reason || 'calendar_429', { httpCode: 429, streak });
  const quarantined = quarantineCurrentProxy(reason || 'calendar_429', CALENDAR_429_COOLDOWN_MS);
  schedulePressureBackoff(reason || 'calendar_429');
  const switched = switchProxy(`${reason || 'calendar_429'} ${quarantined ? 'cooldown' : 'no-ban'}`);
  log('WARN', `[PROXY] calendar_429 rotate reason=${reason} streak=${streak} old_proxy=${oldIdx} new_proxy=${currentProxyIndex} switched=${switched} cooldown=${quarantined}`);
  return switched;
}

function rotateProxyAfterCalendarWaf403(reason, extra = {}) {
  const oldIdx = currentProxyIndex;
  recordCalendarProxyBlacklist(reason || 'calendar_waf_403', extra);
  reportProxyLeaseEvent('waf_pressure', reason || 'calendar_waf_403', { httpCode: 403, ...extra });
  const quarantined = quarantineCurrentProxy(reason || 'calendar_waf_403', CALENDAR_WAF_403_COOLDOWN_MS);
  schedulePressureBackoff(reason || 'calendar_waf_403');
  const switched = switchProxy(`${reason || 'calendar_waf_403'} ${quarantined ? 'cooldown' : 'no-ban'}`);
  log('WARN', `[PROXY] calendar_waf_403 rotate reason=${reason} old_proxy=${oldIdx} new_proxy=${currentProxyIndex} switched=${switched} cooldown=${quarantined} cooldown_min=${Math.ceil(CALENDAR_WAF_403_COOLDOWN_MS / 60000)}`);
  return switched;
}

function failClosedAfterPageWaf(reason, page, urlKey, detail = '') {
  if (!PAGE_WAF_FAIL_CLOSED_ENABLED) return null;
  const oldIdx = currentProxyIndex;
  const normalizedReason = reason || 'page_waf_block';
  clearCalendarPayloadCache(urlKey, `${normalizedReason} fail closed`);
  const quarantined = quarantineCurrentProxy(normalizedReason, PAGE_WAF_FAIL_CLOSED_BACKOFF_MS);
  schedulePressureBackoff(normalizedReason);
  const switched = switchProxy(`${normalizedReason} ${quarantined ? 'cooldown' : 'no-ban'}`);
  const detailSuffix = detail ? ` ${detail}` : '';
  log('WARN', `[WAF] ${normalizedReason} fail_closed ${formatProxyContext(getPageProxyContext(page))}${detailSuffix} -> cooldown proxy, skip calendar API, next strict-grid cycle old_proxy=${oldIdx} new_proxy=${currentProxyIndex} switched=${switched} cooldown=${quarantined} cooldown_min=${Math.ceil(PAGE_WAF_FAIL_CLOSED_BACKOFF_MS / 60000)}`);
  return { status: WAF_PRESSURE_STATUS, reason: normalizedReason };
}

function resetPayloadMissCount(proxyIdx = currentProxyIndex) {
  delete payloadMissCounts[proxyIdx];
}

async function capturePayloadMissContext(page) {
  const currentUrl = page?.url ? page.url() : '';
  const title = await page?.title?.().catch(() => '');
  const snippet = await page?.evaluate(() => {
    const text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 180);
  }).catch(() => '');
  return { currentUrl, title, snippet };
}

async function neutralizeVisibleWafPage(page, reason = 'waf_page') {
  if (!NEUTRALIZE_VISIBLE_WAF_PAGE || !page) return false;
  try {
    await page.evaluate((neutralizeReason) => {
      try { window.stop(); } catch (e) {}
      document.title = 'Calendar API probe';
      if (document.documentElement) {
        document.documentElement.style.background = '#fff';
      }
      let body = document.body;
      if (!body && document.documentElement) {
        body = document.createElement('body');
        document.documentElement.appendChild(body);
      }
      if (!body) return;
      body.replaceChildren();
      Object.assign(body.style, {
        margin: '0',
        minHeight: '100vh',
        background: '#fff',
        color: '#111',
        fontFamily: 'Arial, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      });
      const box = document.createElement('div');
      Object.assign(box.style, {
        fontSize: '18px',
        lineHeight: '1.45',
        textAlign: 'center'
      });
      const title = document.createElement('div');
      title.textContent = 'Calendar API probe active';
      const detail = document.createElement('div');
      detail.textContent = String(neutralizeReason || 'waf_page');
      detail.style.fontSize = '12px';
      detail.style.color = '#666';
      detail.style.marginTop = '8px';
      box.append(title, detail);
      body.appendChild(box);
    }, String(reason || 'waf_page').slice(0, 80));
    log('PROXY', `[WAF] visible block page neutralized reason=${reason} ${formatProxyContext(getPageProxyContext(page))}`);
    return true;
  } catch (error) {
    log('WARN', `[WAF] visible block page neutralize failed reason=${reason} error="${error.message}"`);
    return false;
  }
}

function getTargetPrimaryDateYMD(target) {
  if (target?.target_datetime_start) return target.target_datetime_start.slice(0, 10);
  if (target?.target_date_start) return target.target_date_start;
  if (target?.target_date) return target.target_date;
  return '';
}

async function getPageIdFromDom(page) {
  return await page.evaluate(() => {
    const meta = document.querySelector('meta[name="page-id"]');
    if (meta?.content) return meta.content;
    const bodyId = document.body?.dataset?.pageId;
    if (bodyId) return bodyId;
    const html = document.body?.innerHTML || '';
    const match = html.match(/page["\s]*[:=]\s*["']?(\d+)/i);
    return match ? match[1] : '';
  }).catch(() => '');
}

async function extractSlotsFromDom(page, target) {
  const targetDateYMD = getTargetPrimaryDateYMD(target);
  return await page.evaluate(async (targetDateYMD) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

    const trigger = Array.from(document.querySelectorAll('a,button,[role="button"]'))
      .find(el => /scegli data e ora|choose date/i.test(normalize(el.innerText || el.textContent)));
    if (trigger) trigger.click();
    await sleep(250);

    if (targetDateYMD) {
      const targetDay = String(Number(targetDateYMD.split('-')[2] || '0'));
      const dayLink = Array.from(document.querySelectorAll('.ui-datepicker-calendar a'))
        .find(el => normalize(el.textContent) === targetDay && !el.closest('.ui-datepicker-other-month'));
      if (dayLink && !dayLink.classList.contains('ui-state-active')) {
        dayLink.click();
        await sleep(250);
      }
    }

    const $ = window.jQuery || window.$;
    const inputs = Array.from(document.querySelectorAll('.abc-slotpicker input[name="slot"]'));
    return inputs.map((input) => {
      const period = $ ? $(input).data('period') : null;
      if (!period || !period.period_id || !period.startDateTime) return null;
      const label = input.closest('label');
      const suffix = normalize(label?.querySelector('.option-suffix')?.textContent || '');
      return {
        period_id: period.period_id,
        startDateTime: period.startDateTime,
        endDateTime: period.endDateTime || period.startDateTime,
        capacity: period.capacity ?? period.available ?? period.free ?? period.places ?? period.seats ?? null,
        originalCapacity: period.originalCapacity ?? period.original_capacity ?? period.initialCapacity ?? period.totalCapacity ?? null,
        residualGroupsNumber: period.residualGroupsNumber ?? null,
        singleGroupCapacity: period.singleGroupCapacity ?? null,
        language: period.language || '',
        soldout: input.disabled && (suffix.includes('sold out') || suffix.includes('chiusa') || suffix.includes('insufficiente') || Number(period.capacity ?? 0) === 0),
        sold_out: input.disabled && Number(period.capacity ?? 0) === 0
      };
    }).filter(Boolean);
  }, targetDateYMD).catch(() => []);
}

/**
 * Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµРЎвЂљ, Р В·Р В°Р В±Р В°Р Р…Р ВµР Р… Р В»Р С‘ РЎвЂљР ВµР С”РЎС“РЎвЂ°Р С‘Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘.
 */
function isCurrentProxyBanned() {
  if (isSharedProxyPoolActiveForNode()) return false;
  const ban = getProxyUnavailableUntil(currentProxyIndex, getNodeProxies()[currentProxyIndex]);
  return ban > Date.now();
}

const COOKIES_DIR = `/tmp/sniper-cookies-node${NODE_ID}`;

function getCookieFilePath(proxyIdx) {
  return path.join(COOKIES_DIR, `cookies-proxy-${proxyIdx}.json`);
}

async function savePageCookies(page, proxyIdx) {
  try {
    const cookies = await page.cookies('https://ticketing.colosseo.it').catch(() => []);
    if (!cookies || cookies.length === 0) return;
    
    if (!fs.existsSync(COOKIES_DIR)) {
      fs.mkdirSync(COOKIES_DIR, { recursive: true });
    }
    
    const filePath = getCookieFilePath(proxyIdx);
    fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), 'utf8');
    log('PROXY', `[COOKIE] saved cookies for proxy #${proxyIdx} count=${cookies.length}`);
  } catch (error) {
    log('WARN', `[COOKIE] failed to save cookies for proxy #${proxyIdx} error="${error.message}"`);
  }
}

async function restorePageCookies(page, proxyIdx) {
  try {
    const filePath = getCookieFilePath(proxyIdx);
    if (!fs.existsSync(filePath)) {
      log('PROXY', `[COOKIE] no cookies file found for proxy #${proxyIdx}`);
      return;
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    const cookies = JSON.parse(data);
    if (cookies && cookies.length > 0) {
      await page.setCookie(...cookies);
      log('PROXY', `[COOKIE] restored cookies for proxy #${proxyIdx} count=${cookies.length}`);
    }
  } catch (error) {
    log('WARN', `[COOKIE] failed to restore cookies for proxy #${proxyIdx} error="${error.message}"`);
  }
}

function classifyCookieState(cookieNamesStr) {
  const names = (cookieNamesStr || '').split(',').map(s => s.trim().toLowerCase());
  const hasPhp = names.includes('phpsessid');
  const hasOcto = names.includes('octofence') || names.includes('octofence_session');
  if (hasPhp && hasOcto) return 'php+octo';
  if (hasPhp) return 'php_only';
  if (hasOcto) return 'octo_only';
  return 'none';
}

async function waitForOctofenceChallenge(page, timeoutMs = 15000) {
  const startMs = Date.now();
  let lastState = 'none';
  while (Date.now() - startMs < timeoutMs) {
    const state = await page.evaluate(() => {
      const cookieStr = String(document.cookie || '');
      const body = document.body ? (document.body.innerText || '') : '';
      const title = document.title || '';
      const isChallenge = /checking your browser|please wait|verifica/i.test(body);
      const isWaf = /hosting provider ip address|you have received a 403|you have been blocked|octofence|cloudflare|cf-ray|block_style|http error 403|access denied|was denied/i.test(body) || /block/i.test(title);
      return {
        cookies: cookieStr.split(';').map(c => c.split('=')[0].trim()).filter(Boolean).join(','),
        isChallenge,
        isWaf,
        readyState: document.readyState,
        url: location.href
      };
    }).catch(() => ({ cookies: '', isChallenge: false, isWaf: false, readyState: 'unknown', url: '' }));

    if (state.isWaf) {
      log('WARN', `[COOKIE] WAF block detected during challenge wait. url=${state.url}`);
      return { passed: false, cookieState: 'none', elapsed: Date.now() - startMs };
    }

    lastState = classifyCookieState(state.cookies);
    
    if (lastState === 'php+octo') {
      log('OK', `[COOKIE] challenge passed cookie_state=${lastState} elapsed=${Date.now() - startMs}ms`);
      return { passed: true, cookieState: lastState, elapsed: Date.now() - startMs };
    }
    
    if (!state.isChallenge && lastState !== 'none' && state.readyState === 'complete') {
      log('PROXY', `[COOKIE] page loaded cookie_state=${lastState} elapsed=${Date.now() - startMs}ms`);
      return { passed: lastState !== 'none', cookieState: lastState, elapsed: Date.now() - startMs };
    }

    if (!state.isChallenge && state.readyState === 'complete' && lastState === 'none') {
      log('PROXY', `[COOKIE] page load completed with no cookies/challenge. elapsed=${Date.now() - startMs}ms`);
      return { passed: false, cookieState: lastState, elapsed: Date.now() - startMs };
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  log('WARN', `[COOKIE] challenge_timeout cookie_state=${lastState} elapsed=${timeoutMs}ms`);
  return { passed: false, cookieState: lastState, elapsed: timeoutMs };
}

async function injectAntiDetectScripts(page, proxyIdx = 0) {
  await page.emulateTimezone('Europe/Rome').catch(() => {});
  const concurrency = ((proxyIdx || 0) % 3) * 4 + 8; // 8, 12, or 16
  const screenWidth = 1920;
  const screenHeight = 1080;
  
  // Get current User-Agent to sync chrome.runtime version
  let ua = '';
  try {
    ua = await page.browser().userAgent();
  } catch (e) {
    ua = getRandomUserAgent();
  }
  const chromeVersionMatch = ua.match(/Chrome\/(\d+)/);
  const chromeVersion = chromeVersionMatch ? chromeVersionMatch[1] : '131';
  const chromeFullVersion = `${chromeVersion}.0.${Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 100)}`;
  
  // Inject custom anti-detect script FIRST before any other modifications
  await page.evaluateOnNewDocument(ANTI_DETECT_SCRIPT).catch(() => {});
  
  await page.evaluateOnNewDocument((concurrency, screenWidth, screenHeight, chromeFullVersion) => {
    if (Object.getPrototypeOf(navigator)) {
      Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
        get: () => false
      });
    } else {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
    }

    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => concurrency });
    Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'language', { get: () => 'it-IT' });

    Object.defineProperty(window.screen, 'width', { get: () => screenWidth });
    Object.defineProperty(window.screen, 'height', { get: () => screenHeight });
    Object.defineProperty(window.screen, 'availWidth', { get: () => screenWidth });
    Object.defineProperty(window.screen, 'availHeight', { get: () => screenHeight });

    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} }),
        sendMessage: () => {},
        getManifest: () => ({ name: 'Chrome', version: chromeFullVersion }),
        getURL: (path) => 'chrome-extension://' + path
      };
    }

    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission, onchange: null })
          : originalQuery(params);
    }

    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (x, y, w, h) {
      const imageData = origGetImageData.apply(this, arguments);
      if (w > 10 && h > 10) {
        for (let i = 0; i < 4; i++) {
          const idx = i * 4;
          imageData.data[idx] = (imageData.data[idx] + 1) % 256;
        }
      }
      return imageData;
    };

    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      const ctx = this.getContext('2d');
      if (ctx) {
        try {
          ctx.fillStyle = 'rgba(0,0,0,0.01)';
          ctx.fillRect(0, 0, 1, 1);
        } catch (e) {}
      }
      return origToDataURL.apply(this, arguments);
    };

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Google Inc. (NVIDIA)';
      if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, vs_5_0 ps_5_0)';
      return getParameter.apply(this, arguments);
    };
    
    if (window.WebGL2RenderingContext) {
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Google Inc. (NVIDIA)';
        if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, vs_5_0 ps_5_0)';
        return getParameter2.apply(this, arguments);
      };
    }
  }, concurrency, screenWidth, screenHeight, chromeFullVersion).catch(() => {});
}

async function performHumanLikeBehavior(page) {
  try {
    log('PROXY', `[HUMAN] Performing human-like interactions before calendar fetch...`);
    
    // Увеличенная задержка для лучшей эмуляции человека
    const delay = randomInt(8000, 15000);
    await sleep(delay);

    const width = 1920;
    const height = 1080;
    
    // Эмуляция более плавных движений мыши (кривые Безье с большим количеством точек)
    for (let i = 0; i < 8; i++) {
      const startX = randomInt(100, width - 100);
      const startY = randomInt(100, height - 100);
      const endX = randomInt(100, width - 100);
      const endY = randomInt(100, height - 100);
      
      // Плавное движение с промежуточными точками и случайными отклонениями
      const steps = randomInt(15, 30);
      for (let j = 0; j <= steps; j++) {
        const t = j / steps;
        // Кривая Безье с контролем случайных отклонений
        const cp1x = startX + randomInt(-100, 100);
        const cp1y = startY + randomInt(-100, 100);
        const cp2x = endX + randomInt(-100, 100);
        const cp2y = endY + randomInt(-100, 100);
        
        // Кубическая кривая Безье
        const x = Math.pow(1-t, 3) * startX + 3 * Math.pow(1-t, 2) * t * cp1x + 3 * (1-t) * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * endX;
        const y = Math.pow(1-t, 3) * startY + 3 * Math.pow(1-t, 2) * t * cp1y + 3 * (1-t) * Math.pow(t, 2) * cp2y + Math.pow(t, 3) * endY;
        
        await page.mouse.move(x, y).catch(() => {});
        await sleep(randomInt(20, 60));
      }
    }
    
    // Случайные клики в разных областях страницы с предварительным движением
    for (let i = 0; i < 3; i++) {
      const clickX = randomInt(100, 400);
      const clickY = randomInt(30, 150);
      await page.mouse.move(clickX, clickY).catch(() => {});
      await sleep(randomInt(300, 600));
      await page.mouse.click(clickX, clickY).catch(() => {});
      await sleep(randomInt(400, 800));
    }

    // Эмуляция скролла с паузами и возвратом
    await page.evaluate(async () => {
      const scrollSteps = [50, 100, 150, 200, 250, 200, 150, 100, 50];
      for (const step of scrollSteps) {
        window.scrollBy(0, step);
        await new Promise(r => setTimeout(r, randomInt(150, 400)));
      }
      await new Promise(r => setTimeout(r, randomInt(800, 1500)));
      // Возврат наверх с паузами
      window.scrollTo(0, 0);
    }).catch(() => {});

    // Дополнительная пауза после всех действий
    await sleep(randomInt(2000, 4000));
    
    log('PROXY', `[HUMAN] Human-like interactions completed successfully`);
  } catch (error) {
    log('WARN', `[HUMAN] Human-like interactions failed error="${error.message}"`);
  }
}

const REPUTATION_STATE_FILE = `/tmp/sniper-proxy-reputation-node${NODE_ID}.json`;
let proxyReputation = {};

function loadProxyReputation() {
  try {
    if (fs.existsSync(REPUTATION_STATE_FILE)) {
      proxyReputation = JSON.parse(fs.readFileSync(REPUTATION_STATE_FILE, 'utf8'));
      log('PROXY', `[REPUTATION] loaded reputation records count=${Object.keys(proxyReputation).length}`);
    }
  } catch (error) {
    log('WARN', `[REPUTATION] load failed error="${error.message}"`);
  }
}

function saveProxyReputation() {
  try {
    const dir = path.dirname(REPUTATION_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REPUTATION_STATE_FILE, JSON.stringify(proxyReputation, null, 2), 'utf8');
  } catch (error) {
    log('WARN', `[REPUTATION] save failed error="${error.message}"`);
  }
}

function getProxyReputationScore(idx) {
  const rep = proxyReputation[idx];
  if (!rep) return 0;
  
  let score = (rep.successCount || 0) * 10 - (rep.failCount || 0) * 3;
  
  const asn = String(rep.asn || '').toLowerCase();
  const badAsns = ['egihosting', 'colocrossing', 'm247', 'hostroyale', 'datacenter', 'hosting', 'ovh', 'digitalocean', 'hetzner', 'linode', 'aws', 'amazon', 'google cloud', 'azure'];
  const hasBadAsn = badAsns.some(bad => asn.includes(bad));
  if (hasBadAsn) {
    score -= 20;
  }
  
  return score;
}

function recordProxySuccess(idx) {
  if (!proxyReputation[idx]) {
    proxyReputation[idx] = { successCount: 0, failCount: 0, consecutiveFailures: 0, lastSuccessAt: 0, lastFailAt: 0, asn: '', score: 0 };
  }
  proxyReputation[idx].successCount++;
  proxyReputation[idx].consecutiveFailures = 0;
  proxyReputation[idx].lastSuccessAt = Date.now();
  proxyReputation[idx].score = getProxyReputationScore(idx);
  saveProxyReputation();
  recordCalendarEvent('success');
  log('PROXY', `[REPUTATION] proxy #${idx} success registered score=${proxyReputation[idx].score}`);
}

function recordProxyFailure(idx, asn = '', type = 'waf403') {
  if (!proxyReputation[idx]) {
    proxyReputation[idx] = { successCount: 0, failCount: 0, consecutiveFailures: 0, lastSuccessAt: 0, lastFailAt: 0, asn: '', score: 0 };
  }
  proxyReputation[idx].failCount++;
  proxyReputation[idx].consecutiveFailures = (proxyReputation[idx].consecutiveFailures || 0) + 1;
  proxyReputation[idx].lastFailAt = Date.now();
  if (asn) {
    proxyReputation[idx].asn = asn;
  }
  proxyReputation[idx].score = getProxyReputationScore(idx);
  saveProxyReputation();
  recordCalendarEvent(type);
  log('PROXY', `[REPUTATION] proxy #${idx} failure registered (asn=${asn}) score=${proxyReputation[idx].score} consecutiveFailures=${proxyReputation[idx].consecutiveFailures}`);
}

function getAdaptiveCooldownMs(idx) {
  const rep = proxyReputation[idx];
  const consecutive = rep ? (rep.consecutiveFailures || 0) : 0;
  
  if (consecutive <= 1) {
    return 30 * 60000;
  } else if (consecutive === 2) {
    return 120 * 60000;
  } else {
    return 480 * 60000;
  }
}

const calendarEvents = [];
const EVENT_WINDOW_24H = 24 * 60 * 60 * 1000;

function recordCalendarEvent(type) {
  const now = Date.now();
  calendarEvents.push({ at: now, type });
  
  while (calendarEvents.length && now - calendarEvents[0].at > EVENT_WINDOW_24H) {
    calendarEvents.shift();
  }
}

function getCalendarStatsSummary() {
  const now = Date.now();
  const windows = [
    { label: '1h', duration: 1 * 60 * 60 * 1000 },
    { label: '6h', duration: 6 * 60 * 60 * 1000 },
    { label: '24h', duration: 24 * 60 * 60 * 1000 }
  ];
  
  const stats = {};
  for (const win of windows) {
    const cutoff = now - win.duration;
    const filtered = calendarEvents.filter(e => e.at >= cutoff);
    const counts = { success: 0, waf403: 0, rate429: 0, connect_fail: 0, other_fail: 0 };
    for (const e of filtered) {
      if (e.type === 'success') counts.success++;
      else if (e.type === 'waf403') counts.waf403++;
      else if (e.type === 'rate429') counts.rate429++;
      else if (e.type === 'connect_fail') counts.connect_fail++;
      else counts.other_fail++;
    }
    stats[win.label] = counts;
  }
  
  return stats;
}

let lastStatsLogAt = 0;
const STATS_LOG_INTERVAL_MS = 30 * 60 * 1000;

function checkAndLogStats() {
  const now = Date.now();
  if (now - lastStatsLogAt < STATS_LOG_INTERVAL_MS) return;
  lastStatsLogAt = now;
  
  const stats = getCalendarStatsSummary();
  const stat1h = stats['1h'];
  
  const proxies = getNodeProxies();
  let bestIdx = -1, bestScore = -Infinity;
  let worstIdx = -1, worstScore = Infinity;
  let activeCount = 0;
  
  for (let i = 0; i < proxies.length; i++) {
    const score = getProxyReputationScore(i);
    const unavailableUntil = getProxyUnavailableUntil(i, proxies[i], now);
    if (unavailableUntil <= now) {
      activeCount++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
    if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }
  
  const bestStr = bestIdx !== -1 ? `#${bestIdx}(score=${bestScore})` : 'n/a';
  const worstStr = worstIdx !== -1 ? `#${worstIdx}(score=${worstScore})` : 'n/a';
  
  log('STATS', `[STATS] 1h success=${stat1h.success} waf403=${stat1h.waf403} rate429=${stat1h.rate429} connect_fail=${stat1h.connect_fail} best_proxy=${bestStr} worst_proxy=${worstStr} active_proxies=${activeCount}/${proxies.length}`);
}

async function getBrowserWorkPage(browser, label = 'browser') {
  const pages = await browser.pages().catch(() => []);
  const page = await browser.newPage();

  for (const existingPage of pages) {
    if (existingPage !== page && existingPage.url && existingPage.url() === 'about:blank') {
      await existingPage.close().catch(() => {});
    }
  }

  const proxyIdx = resolveBrowserProxyIndex(browser);
  
  // Рандомная задержка перед любыми действиями (human-like) - увеличено для обхода WAF
  const initialDelay = randomInt(5000, 12000);
  log('PROXY', `[BROWSER] applying initial human-like delay ${initialDelay}ms before first request label=${label}`);
  await sleep(initialDelay);
  
  // Дополнительная пауза перед установкой заголовков (эмуляция загрузки браузера)
  await sleep(randomInt(1000, 2500));
  
  // Генерируем свежий User-Agent для этой сессии
  const ua = getRandomUserAgent();
  const secChUa = getSecChUaFromUserAgent(ua);
  const secChUaPlatform = getSecChUaPlatform(ua);
  
  // Извлекаем полную версию из User-Agent для согласованности
  const chromeVersionMatch = ua.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
  let fullVersion = '"131.0.6778.86"';
  if (chromeVersionMatch) {
    const major = chromeVersionMatch[1];
    const minor = chromeVersionMatch[2] || '0';
    const build = chromeVersionMatch[3] || String(Math.floor(Math.random() * 100));
    const patch = chromeVersionMatch[4] || String(Math.floor(Math.random() * 100));
    fullVersion = `"${major}.${minor}.${build}.${patch}"`;
  }
  
  // Устанавливаем заголовки ДО любых запросов - критично для обхода WAF
  const customHeaders = {
    ...STANDARD_HEADERS,
    'User-Agent': ua,
    'Sec-Ch-Ua': secChUa,
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': secChUaPlatform,
    'Sec-Ch-Ua-Full-Version': fullVersion,
    'Sec-Ch-Ua-Arch': '"x86"',
    'Sec-Ch-Ua-Bitness': '"64"',
    'Sec-Ch-Ua-Model': '""',
    'Sec-Ch-Ua-WoW64': '?0',
    'Priority': 'u=0, i',
    'Upgrade-Insecure-Requests': '1'
  };
  
  await page.setExtraHTTPHeaders(customHeaders);
  log('PROXY', `[BROWSER] set anti-WAF headers for label=${label} ua=${ua.substring(0, 50)}...`);
  
  await injectAntiDetectScripts(page, proxyIdx);
  await restorePageCookies(page, proxyIdx);

  // Дополнительная эмуляция человека перед первым запросом
  await performHumanLikeBehavior(page);

  log('PROXY', `[BROWSER] fresh stealth page opened with full anti-WAF protection label=${label}`);
  return page;
}

function maybeAddLoginProxyBypass(args, label = 'BROWSER') {
  if (!CHECKOUT_LOGIN_PROXY_BYPASS_ENABLED) {
    log('PROXY', `[${label}] login_proxy_bypass=disabled same_proxy_for_login_and_checkout=true`);
    return;
  }
  args.push('--proxy-bypass-list=prenocolosseo-customer.midaticket.com');
  log('PROXY', `[${label}] login_proxy_bypass=enabled host=prenocolosseo-customer.midaticket.com`);
}

async function createBrowser() {
  await ensureProxyLeaseForBrowser('browser_start');
  // Р Р€РЎРѓРЎвЂљР В°Р Р…Р В°Р Р†Р В»Р С‘Р Р†Р В°Р ВµР С currentProxy Р С‘Р В· РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР С–Р С• Р С‘Р Р…Р Т‘Р ВµР С”РЎРѓР В°
  const proxies = getNodeProxies();
  if (proxies.length > 0) {
    currentProxy = proxies[currentProxyIndex];
  }

  const userDataDir = proxies.length > 0
    ? path.join(PROXY_PROFILE_ROOT, `proxy-${currentProxyIndex}`)
    : path.join(PROXY_PROFILE_ROOT, 'colosseo');

  const args = [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-infobars',
    '--password-store=basic',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1920,1080',
    // Enhanced Anti-WAF flags for better stealth
    '--disable-features=IsolateOrigins,site-per-process,ImprovedCookieControls,LazyFrameLoading,GlobalMediaControls,DestroyProfileOnBrowserClose,DialMediaRouteProvider,AcceptCHFrame,AutoExpandDetailsElement,CertificateTransparencyRequirementUpdater,AvoidUnsafeCountrySettings',
    '--disable-site-isolation-trials',
    '--disable-web-security',
    '--allow-running-insecure-content',
    '--disable-ipc-flooding-protection',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--safebrowsing-disable-auto-update',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-logging',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-save-password-bubble',
    '--disable-software-reporting',
    '--disable-threaded-animation',
    '--disable-threaded-scrolling',
    '--disable-lcd-text',
  ];

  let relay = { localPort: null, viaRelay: false };
  if (currentProxy) {
    relay = await ensureProxyRelay(currentProxy, currentProxyIndex);
  }

  // Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р С—РЎР‚Р С•Р С”РЎРѓР С‘-РЎРѓР ВµРЎР‚Р Р†Р ВµРЎР‚ Р Р† Р В°РЎР‚Р С–РЎС“Р СР ВµР Р…РЎвЂљРЎвЂ№ Chrome
  if (currentProxy) {
    const proxyTarget = relay.viaRelay
      ? `127.0.0.1:${relay.localPort}`
      : `http://${currentProxy.host}:${currentProxy.port}`;
    args.push(`--proxy-server=${proxyTarget}`);
    maybeAddLoginProxyBypass(args, 'BROWSER');
    const proxyContext = buildProxyContext(currentProxyIndex, currentProxy, relay, {
      profile: `proxy-${currentProxyIndex}`,
      source: 'createBrowser',
      argsProxyServer: proxyTarget
    });
    log('PROXY', `[BROWSER] launch ${formatProxyContext(proxyContext)}`);
    log('СЂСџРЉС’', `Р СџРЎР‚Р С•Р С”РЎРѓР С‘: ${currentProxy.host}:${currentProxy.port} (#${currentProxyIndex}/${proxies.length}) | Р СџРЎР‚Р С•РЎвЂћР С‘Р В»РЎРЉ: proxy-${currentProxyIndex}`);
  } else {
    log('PROXY', `[BROWSER] launch ${formatProxyContext(buildProxyContext(currentProxyIndex, null, relay, {
      profile: 'colosseo',
      source: 'createBrowser',
      argsProxyServer: 'none'
    }))}`);
  }

  const browser = await launchChromeWithProfile({
    headless: false,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    defaultViewport: null,
    dumpio: true,
    args,
    ignoreDefaultArgs: ['--enable-automation', '--user-data-dir'],
  }, userDataDir, `polling-proxy-${currentProxyIndex}`);

  tagBrowserProxyMetadata(browser, currentProxyIndex, relay, buildProxyContext(currentProxyIndex, currentProxy, relay, {
    profile: currentProxy ? `proxy-${currentProxyIndex}` : 'colosseo',
    source: 'polling_browser',
    argsProxyServer: currentProxy ? (relay.viaRelay ? `127.0.0.1:${relay.localPort}` : `http://${currentProxy.host}:${currentProxy.port}`) : 'none'
  }));
  return browser;
}

async function openPollingBrowserForCurrentProxy() {
  const pollingBrowser = await createBrowser();
  const pollingPage = await getBrowserWorkPage(pollingBrowser, `polling-proxy-${currentProxyIndex}`);

  if (currentProxy && currentProxy.username && !proxyRelayState[currentProxyIndex]) {
    await pollingPage.authenticate({
      username: currentProxy.username,
      password: currentProxy.password
    });
    log('PROXY', `[PROXY] auth set proxyUser=${currentProxy.username} ${formatProxyContext(getPageProxyContext(pollingPage))}`);
  }

  return { browser: pollingBrowser, page: pollingPage };
}

/**
 * Р РЋР С•Р В·Р Т‘Р В°РЎвЂРЎвЂљ Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ Р Р…Р В° Р С”Р С•Р Р…Р С”РЎР‚Р ВµРЎвЂљР Р…Р С•Р С Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р вЂР вЂўР вЂ” Р С‘Р В·Р СР ВµР Р…Р ВµР Р…Р С‘РЎРЏ Р С–Р В»Р С•Р В±Р В°Р В»РЎРЉР Р…Р С•Р С–Р С• РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘РЎРЏ.
 * Р ВРЎРѓР С—Р С•Р В»РЎРЉР В·РЎС“Р ВµРЎвЂљРЎРѓРЎРЏ Р Т‘Р В»РЎРЏ Р С—РЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘ Р Р†РЎвЂљР С•РЎР‚Р С•Р С–Р С• Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚Р В° Р Р†Р С• Р Р†РЎР‚Р ВµР СРЎРЏ hold.
 */
async function createBrowserForProxy(proxyIdx, options = {}) {
  const proxies = getNodeProxies();
  let resolvedProxyIdx = proxyIdx;
  let proxyLease = options.proxyLease || null;
  if (isSharedProxyPoolActiveForNode() && !proxyLease) {
    const acquired = await acquirePreloadProxyLease(options.reason || 'preload_recatch');
    if (!acquired) {
      throw new Error('preload_proxy_lease_not_granted');
    }
    resolvedProxyIdx = acquired.proxyIdx;
    proxyLease = acquired.proxyLease;
  }
  const proxy = proxies[resolvedProxyIdx] || null;

  const userDataDir = options.userDataDir || (proxy
    ? path.join(PROXY_PROFILE_ROOT, `proxy-${resolvedProxyIdx}`)
    : path.join(PROXY_PROFILE_ROOT, 'colosseo'));

  const args = [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-infobars',
    '--password-store=basic',
    `--user-data-dir=${userDataDir}`,
    '--window-size=1920,1080'
  ];

  let relay = { localPort: null, viaRelay: false };
  if (proxy) {
    relay = await ensureProxyRelay(proxy, resolvedProxyIdx, '[PRE-LOAD RELAY]');
  }

  if (proxy) {
    const proxyTarget = relay.viaRelay
      ? `127.0.0.1:${relay.localPort}`
      : `http://${proxy.host}:${proxy.port}`;
    args.push(`--proxy-server=${proxyTarget}`);
    maybeAddLoginProxyBypass(args, 'PRE-LOAD');
    log('PROXY', `[BROWSER] launch ${formatProxyContext(buildProxyContext(resolvedProxyIdx, proxy, relay, {
      profile: `proxy-${resolvedProxyIdx}`,
      source: 'createBrowserForProxy',
      argsProxyServer: proxyTarget
    }))}`);
    log('СЂСџРЉС’', `[PRE-LOAD] Р СџРЎР‚Р С•Р С”РЎРѓР С‘: ${proxy.host}:${proxy.port} (#${resolvedProxyIdx}) | Р СџРЎР‚Р С•РЎвЂћР С‘Р В»РЎРЉ: proxy-${resolvedProxyIdx}`);
  } else {
    log('PROXY', `[BROWSER] launch ${formatProxyContext(buildProxyContext(resolvedProxyIdx, null, relay, {
      profile: 'colosseo',
      source: 'createBrowserForProxy',
      argsProxyServer: 'none'
    }))}`);
  }

  const newBrowser = await launchChromeWithProfile({
    headless: false,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    defaultViewport: null,
    dumpio: true,
    args,
    ignoreDefaultArgs: ['--enable-automation', '--user-data-dir'],
  }, userDataDir, `proxy-${resolvedProxyIdx}`);
  tagBrowserProxyMetadata(newBrowser, resolvedProxyIdx, relay, buildProxyContext(resolvedProxyIdx, proxy, relay, {
    profile: proxy ? `proxy-${resolvedProxyIdx}` : 'colosseo',
    source: 'preload_browser',
    argsProxyServer: proxy ? (relay.viaRelay ? `127.0.0.1:${relay.localPort}` : `http://${proxy.host}:${proxy.port}`) : 'none'
  }));

  const newPage = await getBrowserWorkPage(newBrowser, `preload-proxy-${resolvedProxyIdx}`);

  if (proxy && proxy.username && !relay.viaRelay) {
    await newPage.authenticate({
      username: proxy.username,
      password: proxy.password
    });
    log('PROXY', `[PRE-LOAD] proxy auth set proxyUser=${proxy.username} ${formatProxyContext(getPageProxyContext(newPage))}`);
  }

  return { browser: newBrowser, page: newPage, proxy, proxyIdx: resolvedProxyIdx, proxyLease, userDataDir };
}

/**
 * Р СџРЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р В° РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р ВµР С–Р С• Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р Т‘Р В»РЎРЏ Р СР С–Р Р…Р С•Р Р†Р ВµР Р…Р Р…Р С•Р С–Р С• re-catch.
 * Р РЋР С•Р В·Р Т‘Р В°РЎвЂРЎвЂљ Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚, Р Р…Р В°Р Р†Р С‘Р С–Р С‘РЎР‚РЎС“Р ВµРЎвЂљ Р Р…Р В° target URL, Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р Р†Р В°РЎвЂљРЎвЂ№Р Р†Р В°Р ВµРЎвЂљ calendar payload.
 */
async function preloadForRecatch(target) {
  const proxies = getNodeProxies();
  if (proxies.length < 2) return null;

  const nextIdx = (currentProxyIndex + 1) % proxies.length;
  log('СЂСџвЂќвЂћ', `[HOLD] Pre-loading Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${nextIdx} Р Т‘Р В»РЎРЏ re-catch...`);

  const { browser: plBrowser, page: plPage, proxy: plProxy, proxyIdx: plIdx, proxyLease: plProxyLease } = await createBrowserForProxy(nextIdx);

  // Р В¤Р С•РЎР‚Р СР С‘РЎР‚РЎС“Р ВµР С URL Р С”Р В°Р С” Р Р† checkAvailability
  let effectiveUrl = target.url;
  if (target.type === 'underground') {
    let refDate = getTargetReferenceDate(target);
    if (!refDate) {
      const minDays = target.min_days_ahead || 14;
      refDate = new Date();
      refDate.setDate(refDate.getDate() + minDays);
    }
    const tParam = refDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const baseUrl = target.url.split('?')[0];
    effectiveUrl = `${baseUrl}?t=${encodeURIComponent(tParam)}`;
  }

  const urlKey = target.url.split('?')[0];
  const cacheSignature = getCalendarPayloadCacheSignature(target);
  // Do not reset global cartItemsInfo here: preload may run while the current held cart is still alive.
  let interceptedPayload = null;
  let domSlotsReady = false;

  const interceptFn = request => {
    if (request.url().includes('/mtajax/calendars_month') && request.method() === 'POST' && request.postData()) {
      interceptedPayload = request.postData();
    }
  };
  plPage.on('request', interceptFn);

  log('СЂСџРЉС’', `[PRE-LOAD] Р СњР В°Р Р†Р С‘Р С–Р В°РЎвЂ Р С‘РЎРЏ: ${effectiveUrl.substring(0, 60)}...`);
  await plPage.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => {
    log('РІС™В РїС‘РЏ', `[PRE-LOAD] Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р Р…Р В°Р Р†Р С‘Р С–Р В°РЎвЂ Р С‘Р С‘: ${e.message.slice(0, 50)}`);
  });

  // Р вЂ“Р Т‘РЎвЂР С Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р Р†Р В°РЎвЂљ payload (Р СР В°Р С”РЎРѓ 15РЎРѓ)
  for (let i = 0; i < 15; i++) {
    if (interceptedPayload) break;
    await sleep(1000);
  }

  plPage.off('request', interceptFn);

  if (interceptedPayload) {
    // Р РЋР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎРЏР ВµР С payload Р Р† Р С–Р В»Р С•Р В±Р В°Р В»РЎРЉР Р…РЎвЂ№Р в„– Р С”РЎРЊРЎв‚¬ Р Т‘Р В»РЎРЏ Р С‘РЎРѓР С—Р С•Р В»РЎРЉР В·Р С•Р Р†Р В°Р Р…Р С‘РЎРЏ checkAvailability
    interceptedCalendars[urlKey] = interceptedPayload;
    interceptedCalendars[urlKey + '_signature'] = cacheSignature;
    if (target.type === 'underground') {
      const minDays = target.min_days_ahead || 14;
      const td = new Date(); td.setDate(td.getDate() + minDays);
      interceptedCalendars[urlKey + '_month'] = `${td.getFullYear()}-${td.getMonth()}`;
    }
    log('РІСљвЂ¦', `[PRE-LOAD] Р СџРЎР‚Р С•Р С”РЎРѓР С‘ #${plIdx} Р С–Р С•РЎвЂљР С•Р Р†! Payload Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р Р†Р В°РЎвЂЎР ВµР Р….`);
  } else {
    log('РІС™В РїС‘РЏ', `[PRE-LOAD] Payload Р СњР вЂў Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р Р†Р В°РЎвЂЎР ВµР Р… Р Р…Р В° Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${plIdx}`);
    // Р СџРЎР‚Р С•Р В±РЎС“Р ВµР С РЎР‚РЎС“РЎвЂЎР Р…Р С•Р в„– Р С‘Р В·Р Р†Р В»Р ВµРЎвЂЎРЎРЉ payload Р С‘Р В· РЎРѓРЎвЂљРЎР‚Р В°Р Р…Р С‘РЎвЂ РЎвЂ№
    const manualPayloadRefDate = getTargetReferenceDate(target) || new Date();
    const manualPayloadYear = manualPayloadRefDate.getFullYear();
    const manualPayloadMonth = manualPayloadRefDate.getMonth() + 1;
    const manualPayload = await plPage.evaluate((year, month) => {
      const html = document.body ? document.body.innerHTML : '';
      const match = html.match(/"entranceEvent_guid"\s*(?:=>|:)\s*"([a-f0-9\-]{36})/i) || html.match(/name="entranceEvent_guid"\s*value="([a-f0-9\-]{36})/i);
      if (match) return `action=midaabc_calendars_month&guids[entranceEvent_guid][]=${match[1]}&year=${year}&month=${month}&day=`;
      return null;
    }, manualPayloadYear, manualPayloadMonth).catch(() => null);
    if (manualPayload) {
      interceptedPayload = manualPayload;
      interceptedCalendars[urlKey] = manualPayload;
      interceptedCalendars[urlKey + '_signature'] = cacheSignature;
      log('РІСљвЂ¦', `[PRE-LOAD] Payload Р С‘Р В·Р Р†Р В»Р ВµРЎвЂЎРЎвЂР Р… Р Р†РЎР‚РЎС“РЎвЂЎР Р…РЎС“РЎР‹ Р С‘Р В· РЎРѓРЎвЂљРЎР‚Р В°Р Р…Р С‘РЎвЂ РЎвЂ№.`);
    }
  }

  if (!interceptedPayload) {
    const domSlots = await extractSlotsFromDom(plPage, target);
    if (domSlots.length > 0) {
      domSlotsReady = true;
      log('Р Р†РЎС™РІР‚В¦', `[PRE-LOAD] DOM fallback Р В РЎвЂ“Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР В Р вЂ : ${domSlots.length} Р РЋР С“Р В Р’В»Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР В Р вЂ  Р В Р вЂ¦Р В Р’В° Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р В Р’Вµ.`);
    }
  }

  return { browser: plBrowser, page: plPage, proxy: plProxy, proxyIdx: plIdx, proxyLease: plProxyLease, payload: interceptedPayload, domSlotsReady };
}

/**
 * Р вЂ™РЎвЂ№Р С—Р С•Р В»Р Р…РЎРЏР ВµРЎвЂљ checkout: Р В·Р В°Р С”РЎР‚РЎвЂ№Р Р†Р В°Р ВµРЎвЂљ Puppeteer, Р В·Р В°Р С—РЎС“РЎРѓР С”Р В°Р ВµРЎвЂљ РЎвЂЎР С‘РЎРѓРЎвЂљРЎвЂ№Р в„– Chrome.
 * Р вЂ™РЎвЂ№Р Р…Р ВµРЎРѓР ВµР Р…Р С• Р Р† РЎвЂћРЎС“Р Р…Р С”РЎвЂ Р С‘РЎР‹ Р Т‘Р В»РЎРЏ РЎС“Р В±Р С‘РЎР‚Р В°Р Р…Р С‘РЎРЏ Р Т‘РЎС“Р В±Р В»Р С‘РЎР‚Р С•Р Р†Р В°Р Р…Р С‘РЎРЏ.
 */
async function clearCheckoutLoginState(page) {
  if (!CHECKOUT_CLEAR_LOGIN_STATE_ENABLED) {
    log('PAYMENT', '[PAYMENT] checkout_login_state_clear_skipped reason=disabled');
    return { enabled: false, oldStateDetected: false };
  }
  if (!page || page.isClosed?.()) return { enabled: true, oldStateDetected: false, error: 'page_closed' };

  const authNamePattern = /wordpress_logged_in|logged|login|auth|customer|utente|user|token|jwt|bearer|oauth|sso/i;
  const preserveCookiePattern = /^(PHPSESSID|octofence|octofence_session|wp_woocommerce_session|woocommerce_cart_hash|woocommerce_items_in_cart|mida|cookie|consent|pll_language|wp-wpml_current_language)$/i;
  const customerOrigins = [
    'https://prenocolosseo-customer.midaticket.com',
    'https://customer.midaticket.com',
    'https://prenocolosseo.midaticket.com'
  ];
  const checkoutOrigins = [
    'https://ticketing.colosseo.it',
    'https://ticketing.colosseo.it/it/checkout'
  ];
  const removed = {
    customerOriginsCleared: 0,
    customerCookies: 0,
    checkoutAuthCookies: 0,
    checkoutAuthStorage: 0,
    savedCredentialFiles: 0
  };

  try {
    const client = await page.target().createCDPSession();
    try {
      for (const origin of customerOrigins) {
        await client.send('Storage.clearDataForOrigin', {
          origin,
          storageTypes: 'cookies,local_storage,session_storage,indexeddb,websql,service_workers,cache_storage'
        });
        removed.customerOriginsCleared += 1;
      }
      const allCookies = await client.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
      for (const cookie of allCookies.cookies || []) {
        const domain = String(cookie.domain || '');
        const name = String(cookie.name || '');
        const isCustomerCookie = /(^|\.)prenocolosseo-customer\.midaticket\.com$/i.test(domain)
          || /(^|\.)customer\.midaticket\.com$/i.test(domain)
          || (/midaticket\.com$/i.test(domain) && authNamePattern.test(name));
        const isCheckoutAuthCookie = /(^|\.)ticketing\.colosseo\.it$/i.test(domain)
          && authNamePattern.test(name)
          && !preserveCookiePattern.test(name);
        if (!isCustomerCookie && !isCheckoutAuthCookie) continue;
        await client.send('Network.deleteCookies', {
          name,
          domain,
          path: cookie.path || '/'
        }).catch(() => {});
        if (isCustomerCookie) removed.customerCookies += 1;
        if (isCheckoutAuthCookie) removed.checkoutAuthCookies += 1;
      }
    } finally {
      await client.detach().catch(() => {});
    }
  } catch (error) {
    log('WARN', `[PAYMENT] checkout_login_state_clear_origin_failed error="${error.message}"`);
  }

  try {
    const context = page.browserContext?.();
    const cookies = context && typeof context.cookies === 'function'
      ? await context.cookies(...checkoutOrigins, ...customerOrigins)
      : await page.cookies(...checkoutOrigins, ...customerOrigins);
    const deleteCandidates = [];
    for (const cookie of cookies || []) {
      const domain = String(cookie.domain || '');
      const name = String(cookie.name || '');
      const isCustomerCookie = /prenocolosseo-customer\.midaticket\.com|customer\.midaticket\.com/i.test(domain)
        || (/midaticket\.com/i.test(domain) && authNamePattern.test(name));
      const isCheckoutAuthCookie = domain.includes('ticketing.colosseo.it')
        && authNamePattern.test(name)
        && !preserveCookiePattern.test(name);
      if (isCustomerCookie || isCheckoutAuthCookie) {
        const url = `${cookie.secure ? 'https' : 'http'}://${domain.replace(/^\./, '')}${cookie.path || '/'}`;
        deleteCandidates.push({ name: cookie.name, url });
        if (isCustomerCookie) removed.customerCookies += 1;
        if (isCheckoutAuthCookie) removed.checkoutAuthCookies += 1;
      }
    }
    if (deleteCandidates.length > 0) {
      await page.deleteCookie(...deleteCandidates);
    }
  } catch (error) {
    log('WARN', `[PAYMENT] checkout_login_state_clear_cookies_failed error="${error.message}"`);
  }

  try {
    removed.checkoutAuthStorage = await page.evaluate((patternSource) => {
      const authPattern = new RegExp(patternSource, 'i');
      let count = 0;
      const clearMatching = (storage) => {
        const keys = [];
        try {
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && authPattern.test(key)) keys.push(key);
          }
          for (const key of keys) storage.removeItem(key);
          count += keys.length;
        } catch {}
      };
      clearMatching(window.localStorage);
      clearMatching(window.sessionStorage);
      return count;
    }, authNamePattern.source).catch(() => 0);
  } catch (error) {
    log('WARN', `[PAYMENT] checkout_login_state_clear_storage_failed error="${error.message}"`);
  }

  const oldStateDetected = Boolean(
    removed.customerCookies > 0
    || removed.checkoutAuthCookies > 0
    || removed.checkoutAuthStorage > 0
    || removed.savedCredentialFiles > 0
  );
  log('PAYMENT', `[PAYMENT] checkout_login_state_cleared state=${oldStateDetected ? 'old_login_state_detected' : 'no_old_login_state'} customerOriginsCleared=${removed.customerOriginsCleared} customerCookies=${removed.customerCookies} checkoutAuthCookies=${removed.checkoutAuthCookies} checkoutAuthStorage=${removed.checkoutAuthStorage} savedCredentialFiles=${removed.savedCredentialFiles}`);
  return { enabled: true, oldStateDetected, removed };
}

async function clickCheckoutProceedButton(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const candidates = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    const acceptCookie = candidates.find((element) => {
      const text = normalize(element.innerText || element.textContent || element.value);
      return isVisible(element) && /^(accetto|accept|ok)$/.test(text);
    });
    if (acceptCookie) acceptCookie.click();

    const proceed = candidates.find((element) => {
      const text = normalize(element.innerText || element.textContent || element.value);
      return isVisible(element) && (
        text.includes('accetta e procedi') ||
        text.includes('accetta') && text.includes('procedi') ||
        text.includes('accept and proceed') ||
        text.includes('continue') ||
        text.includes('proceed')
      );
    });
    if (!proceed) return false;
    proceed.click();
    return true;
  }).catch(() => false);
}

async function waitForCheckoutTransition(page) {
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
    sleep(2500)
  ]);
}

async function pageHasCheckoutPassengerFields(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const inputs = Array.from(document.querySelectorAll('input, textarea'))
      .filter((input) => {
        const type = normalize(input.getAttribute('type') || 'text');
        return isVisible(input) && !['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio'].includes(type);
      });
    const text = normalize(document.body?.innerText || document.body?.textContent || '');
    return inputs.length >= 2 && (
      text.includes('dati visitatore') ||
      text.includes('nome') && text.includes('cognome') ||
      text.includes('visitor') && text.includes('surname')
    );
  }).catch(() => false);
}

async function prepareControlledCheckoutPage(page) {
  const checkoutUrl = 'https://ticketing.colosseo.it/it/checkout';
  await page.bringToFront().catch(() => {});
  if (!/\/checkout\/?|\bcheckout\b/i.test(page.url())) {
    await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }

  const hasPassengerFields = await pageHasCheckoutPassengerFields(page);
  log('PAYMENT', `[PAYMENT] checkout_operator_handoff_ready url=${page.url()} passengerFields=${hasPassengerFields ? 'yes' : 'no'} action=manual_login_and_continue`);
  return hasPassengerFields;
}

function getCleanCheckoutUserDataDir(proxyIdx) {
  const safeProxyIdx = Number.isInteger(Number(proxyIdx)) ? Number(proxyIdx) : 'unknown';
  return `/root/chrome-checkout-data/node-${NODE_ID}-proxy-${safeProxyIdx}`;
}

async function captureTicketingBrowserState(page) {
  const cookieUrls = [
    'https://ticketing.colosseo.it',
    'https://ticketing.colosseo.it/it/checkout',
    'https://www.google.com'
  ];
  const cookies = await page.cookies(...cookieUrls).catch(() => []);
  const storage = await page.evaluate(() => {
    const collect = (source) => {
      const out = {};
      try {
        for (let i = 0; i < source.length; i++) {
          const key = source.key(i);
          if (key) out[key] = source.getItem(key);
        }
      } catch {}
      return out;
    };
    return {
      localStorage: collect(window.localStorage),
      sessionStorage: collect(window.sessionStorage)
    };
  }).catch(() => ({ localStorage: {}, sessionStorage: {} }));
  return {
    cookies: (cookies || []).filter((cookie) => {
      const domain = String(cookie.domain || '');
      return /(^|\.)ticketing\.colosseo\.it$/i.test(domain)
        || /(^|\.)colosseo\.it$/i.test(domain)
        || /(^|\.)google\.com$/i.test(domain);
    }),
    storage
  };
}

async function openCleanOperatorCheckoutPage(sourcePage) {
  const checkoutUrl = 'https://ticketing.colosseo.it/it/checkout';
  const checkoutProfile = getCleanCheckoutUserDataDir(currentProxyIndex);
  const state = await captureTicketingBrowserState(sourcePage);
  fs.rmSync(checkoutProfile, { recursive: true, force: true });
  fs.mkdirSync(checkoutProfile, { recursive: true });

  const displayValue = resolveCheckoutDisplay();
  let relay = { localPort: null, viaRelay: false };
  let proxyTarget = null;
  if (currentProxy) {
    relay = await ensureProxyRelay(currentProxy, currentProxyIndex, '[CHECKOUT CLEAN RELAY]');
    proxyTarget = relay.viaRelay
      ? `127.0.0.1:${relay.localPort}`
      : `http://${currentProxy.host}:${currentProxy.port}`;
  }

  const args = [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-sync',
    '--disable-save-password-bubble',
    '--disable-blink-features=AutomationControlled',
    '--password-store=basic',
    `--user-data-dir=${checkoutProfile}`,
    '--window-size=1920,1080'
  ];
  if (proxyTarget) args.push(`--proxy-server=${proxyTarget}`);

  const checkoutProxyContext = buildProxyContext(currentProxyIndex, currentProxy, relay, {
    profile: checkoutProfile,
    source: 'checkout_clean',
    argsProxyServer: proxyTarget || 'none'
  });
  log('PAYMENT', `[PAYMENT] checkout_clean_profile_started ${formatProxyContext(checkoutProxyContext)} cookies=${state.cookies.length}`);
  const checkoutBrowser = await launchChromeWithProfile({
    headless: false,
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    defaultViewport: null,
    dumpio: true,
    args,
    ignoreDefaultArgs: ['--enable-automation', '--user-data-dir'],
    env: {
      ...process.env,
      DISPLAY: displayValue,
      XAUTHORITY: '/root/.Xauthority'
    }
  }, checkoutProfile, `checkout-clean-proxy-${currentProxyIndex}`);
  tagBrowserProxyMetadata(checkoutBrowser, currentProxyIndex, relay, checkoutProxyContext);

  const checkoutPage = await getBrowserWorkPage(checkoutBrowser, `checkout-clean-proxy-${currentProxyIndex}`);
  if (state.cookies.length > 0) {
    await checkoutPage.setCookie(...state.cookies).catch((error) => {
      log('WARN', `[PAYMENT] checkout_clean_cookie_restore_failed error="${error.message}"`);
    });
  }
  await checkoutPage.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await checkoutPage.evaluate((storage) => {
    const restore = (target, values) => {
      try {
        for (const [key, value] of Object.entries(values || {})) {
          if (/login|auth|customer|utente|user|token|jwt|bearer|oauth|sso/i.test(key)) continue;
          target.setItem(key, value);
        }
      } catch {}
    };
    restore(window.localStorage, storage.localStorage);
    restore(window.sessionStorage, storage.sessionStorage);
  }, state.storage).catch(() => {});
  await checkoutPage.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  return { browser: checkoutBrowser, page: checkoutPage, checkoutProfile };
}

async function performCheckout(holdBrowser, holdPage, slotInfo, ticketInfo, options = {}) {
  try {
    const hasControlledPage = Boolean(holdPage && !holdPage.isClosed?.());
    if (hasControlledPage) {
      log('PAYMENT', '[PAYMENT] checkout_controlled_started');
      const loginStateClear = await clearCheckoutLoginState(holdPage).catch((error) => {
        log('WARN', `[PAYMENT] checkout_login_state_clear_failed error="${error.message}"`);
        return null;
      });
      const cleanCheckout = CHECKOUT_CLEAN_PROFILE_ENABLED
        ? await openCleanOperatorCheckoutPage(holdPage).catch((error) => {
          log('WARN', `[PAYMENT] checkout_clean_profile_failed error="${error.message}" action=use_existing_profile`);
          return null;
        })
        : null;
      if (!CHECKOUT_CLEAN_PROFILE_ENABLED) {
        log('PAYMENT', '[PAYMENT] checkout_clean_profile_skipped reason=disabled_by_config');
      }
      const checkoutPage = cleanCheckout?.page || holdPage;
      const formReady = await prepareControlledCheckoutPage(checkoutPage);
      if (formReady) {
        if (PAYMENT_PASSENGER_AUTOFILL_ENABLED) {
          const fillResult = await fillPaymentPassengerDetails(
            checkoutPage,
            options.detailGuids || cartItemsInfo?.detailGuids || [],
            options.passengerDetails || null
          ).catch((error) => {
            log('PAYMENT', `[PAYMENT] passenger_fill_failed error="${error.message}"`);
            return false;
          });
          log('PAYMENT', `[PAYMENT] checkout_controlled_ready passengerFill=${fillResult ? 'ok' : 'manual'}`);
        } else {
          log('PAYMENT', '[PAYMENT] checkout_controlled_ready passengerFill=disabled');
        }
      } else {
        log('PAYMENT', `[PAYMENT] checkout_controlled_ready passengerFill=manual reason=form_not_detected url=${checkoutPage.url()}`);
      }
      if (loginStateClear?.oldStateDetected) {
        log('PAYMENT', '[PAYMENT] checkout_controlled_handoff state=old_login_state_detected_and_cleared');
      }
      log('РЎР‚РЎСџРІР‚СњРІР‚Сљ', 'Checkout РѕС‚РєСЂС‹С‚ РІ СѓРїСЂР°РІР»СЏРµРјРѕРј Chrome. Р—Р°РІРµСЂС€РёС‚Рµ РѕРїР»Р°С‚Сѓ С‡РµСЂРµР· noVNC/RDP.');
      if (holdBrowser && typeof holdBrowser.disconnect === 'function') {
        log('PAYMENT', '[PAYMENT] checkout_browser_kept_for_monitoring');
      }
      return {
        controlled: true,
        page: checkoutPage,
        browser: cleanCheckout?.browser || holdBrowser,
        checkoutProfile: cleanCheckout?.checkoutProfile || null
      };
    }

    if (holdBrowser) {
      await holdBrowser.close();
      log('СЂСџвЂќвЂњ', 'Puppeteer Chrome Р В·Р В°Р С”РЎР‚РЎвЂ№РЎвЂљ. Р СџРЎР‚Р С•РЎвЂћР С‘Р В»РЎРЉ Р С•РЎРѓР Р†Р С•Р В±Р С•Р В¶Р Т‘РЎвЂР Р….');
    }

    // Р С›Р С—РЎР‚Р ВµР Т‘Р ВµР В»РЎРЏР ВµР С РЎР‚Р ВµР В°Р В»РЎРЉР Р…РЎвЂ№Р в„– DISPLAY (Р В°Р Р…Р В°Р В»Р С•Р С– launcher.sh: Xorg+xrdp)
    let displayValue = resolveCheckoutDisplay();
    log('СЂСџвЂ“ТђРїС‘РЏ', `Checkout Chrome DISPLAY=${displayValue}`);
    const profileArg = `--user-data-dir=/root/chrome-user-data/proxy-${currentProxyIndex}`;
    const checkoutUrl = 'https://ticketing.colosseo.it/it/checkout';

    if (currentProxy) {
      const relay = await ensureProxyRelay(currentProxy, currentProxyIndex, '[CHECKOUT RELAY]');
      const proxyTarget = relay.viaRelay
        ? `127.0.0.1:${relay.localPort}`
        : `http://${currentProxy.host}:${currentProxy.port}`;
      const chromeCmd = `DISPLAY=${displayValue} XAUTHORITY=/root/.Xauthority google-chrome-stable --no-sandbox --no-first-run --no-default-browser-check --disable-sync --disable-blink-features=AutomationControlled --proxy-server=${proxyTarget} ${profileArg} --window-size=1920,1080 '${checkoutUrl}'`;
      log('СЂСџРЏРѓ', `Р вЂ”Р В°Р С—РЎС“РЎРѓР С”Р В°Р ВµР С РЎвЂЎР С‘РЎРѓРЎвЂљРЎвЂ№Р в„– Chrome Р Т‘Р В»РЎРЏ checkout...`);
      exec(chromeCmd, (err) => {
        if (err) log('РІС™В РїС‘РЏ', `Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р В·Р В°Р С—РЎС“РЎРѓР С”Р В° Chrome: ${err.message}`);
      });
      log('СЂСџвЂќвЂњ', 'Р В§Р С‘РЎРѓРЎвЂљРЎвЂ№Р в„– Chrome Р В·Р В°Р С—РЎС“РЎвЂ°Р ВµР Р…. Р вЂ”Р В°Р в„–Р Т‘Р С‘РЎвЂљР Вµ РЎвЂЎР ВµРЎР‚Р ВµР В· RDP Р С‘ Р С•Р С—Р В»Р В°РЎвЂљР С‘РЎвЂљР Вµ!');
    } else {
      const chromeCmd = `DISPLAY=${displayValue} XAUTHORITY=/root/.Xauthority google-chrome-stable --no-sandbox --no-first-run --no-default-browser-check --disable-sync --user-data-dir=/root/chrome-user-data/proxy-${currentProxyIndex} --window-size=1920,1080 '${checkoutUrl}'`;
      exec(chromeCmd);
      log('СЂСџвЂќвЂњ', 'Р В§Р С‘РЎРѓРЎвЂљРЎвЂ№Р в„– Chrome Р В·Р В°Р С—РЎС“РЎвЂ°Р ВµР Р… Р Р…Р В° checkout (Р В±Р ВµР В· Р С—РЎР‚Р С•Р С”РЎРѓР С‘).');
    }
  } catch (e) {
    log('РІС™В РїС‘РЏ', `Р С›РЎв‚¬Р С‘Р В±Р С”Р В° checkout: ${e.message}`);
  }

  // Telegram: РЎРѓРЎвЂљР В°РЎвЂљРЎС“РЎРѓ Р’В«Р С›Р С—Р В»Р В°РЎвЂљР В°Р’В» РЎС“Р В¶Р Вµ Р С—Р С•Р С”Р В°Р В·Р В°Р Р… РЎвЂЎР ВµРЎР‚Р ВµР В· editTelegram Р Р† hold-РЎРѓР ВµР С”РЎвЂ Р С‘Р С‘
}

function resolveCheckoutDisplay() {
  try {
    execSync('touch /root/.Xauthority 2>/dev/null || true', { stdio: 'ignore' });
  } catch {}

  const candidates = [];
  const addCandidate = (value) => {
    const raw = String(value || '').trim();
    const displayMatch = raw.match(/(?::|X)(\d+)(?:\.\d+)?$/);
    const numericMatch = raw.match(/^(\d+)$/);
    const displayId = displayMatch ? Number(displayMatch[1]) : numericMatch ? Number(numericMatch[1]) : NaN;
    if (Number.isInteger(displayId) && displayId >= 0 && !candidates.includes(displayId)) {
      candidates.push(displayId);
    }
  };

  const addCandidatesFromCommand = (command) => {
    try {
      execSync(command, { encoding: 'utf8' })
        .split(/\s+/)
        .forEach(addCandidate);
    } catch {}
  };

  const addCandidateFromFile = (filePath) => {
    try {
      if (fs.existsSync(filePath)) {
        addCandidate(fs.readFileSync(filePath, 'utf8').trim());
      }
    } catch {}
  };

  try {
    addCandidate(process.env.PREFERRED_DISPLAY || '');
    addCandidateFromFile(`/tmp/sniper-preferred-display-node${NODE_ID}`);
    addCandidateFromFile(`/tmp/sniper-rdp-login-display-node${NODE_ID}`);
    addCandidateFromFile(`/tmp/sniper-active-display-node${NODE_ID}`);
    addCandidate(process.env.DISPLAY || '');
  } catch {}

  addCandidatesFromCommand("ps -eo args= 2>/dev/null | grep '[X]org' | grep xrdp | grep -- ' -auth ' | grep -oE '(^|[[:space:]]):[0-9]+' | tr -d ' ' | sort -Vr | awk '!seen[$0]++'");
  addCandidatesFromCommand("ps -eo args= 2>/dev/null | grep '[X]org' | grep xrdp | grep -oE '(^|[[:space:]]):[0-9]+' | tr -d ' ' | sort -Vr | awk '!seen[$0]++'");

  addCandidatesFromCommand("ls /tmp/.X11-unix/X* 2>/dev/null | sed 's#.*X##' | sort -nr");

  for (const displayId of candidates) {
    for (const display of [`:${displayId}.0`, `:${displayId}`]) {
      try {
        execSync(`DISPLAY=${display} XAUTHORITY=/root/.Xauthority xdpyinfo >/dev/null 2>&1`, { stdio: 'ignore' });
        return display;
      } catch {}
    }
  }

  try {
    execSync('command -v Xvfb >/dev/null 2>&1 || (apt-get update -y >/dev/null 2>&1 || true; apt-get install -y xvfb xauth x11-utils >/dev/null 2>&1 || true)', { stdio: 'ignore' });
    execSync('ps -eo args= 2>/dev/null | grep -q "[X]vfb :99" || nohup Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -ac >/tmp/xvfb99.log 2>&1 & sleep 2', { stdio: 'ignore' });
    execSync('DISPLAY=:99 XAUTHORITY=/root/.Xauthority xdpyinfo >/dev/null 2>&1', { stdio: 'ignore' });
    return ':99';
  } catch (error) {
    log('WARN', `[CHECKOUT] display_probe_failed error="${error.message}"`);
    return ':12.0';
  }
}

async function performWarmup(page) {
  await page.evaluate(() => {
    try {
      // Р ВР СР С‘РЎвЂљР С‘РЎР‚РЎС“Р ВµР С РЎРѓР ВµРЎР‚Р С‘РЎР‹ Р Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘Р в„– Р СРЎвЂ№РЎв‚¬Р С‘
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(100 + Math.random() * 800);
        const y = Math.floor(100 + Math.random() * 600);
        document.dispatchEvent(new MouseEvent('mousemove', {
          clientX: x, clientY: y, bubbles: true, cancelable: true
        }));
        // Р РЋР В»РЎС“РЎвЂЎР В°Р в„–Р Р…РЎвЂ№Р в„– РЎРѓР С”РЎР‚Р С•Р В»Р В»
        if (Math.random() > 0.3) {
          window.scrollBy(0, Math.floor(Math.random() * 200 - 100));
        }
      }
      // Р В¤Р ВµР в„–Р С”Р С•Р Р†РЎвЂ№Р в„– Р С”Р В»Р С‘Р С” Р Р† Р С—РЎС“РЎРѓРЎвЂљР С•РЎвЂљРЎС“
      if (Math.random() > 0.8) {
        document.body.click();
      }
    } catch (e) { }
  });
}

// Memory to hold captured interception payloads per URL
const interceptedCalendars = {};

function getCalendarPayloadCacheSignature(target) {
  const baseUrl = String(target?.url || '').split('?')[0];
  return JSON.stringify({
    baseUrl,
    type: target?.type || '',
    mode: target?.mode || '',
    target_datetime_start: target?.target_datetime_start || '',
    target_datetime_end: target?.target_datetime_end || '',
    target_date: target?.target_date || '',
    target_date_start: target?.target_date_start || '',
    target_date_end: target?.target_date_end || '',
    time_range: target?.time_range || null,
    min_days_ahead: target?.min_days_ahead ?? null,
    max_days_ahead: target?.max_days_ahead ?? null,
    tickets: Array.isArray(target?.tickets)
      ? target.tickets.map(t => ({ label: t.label || '', quantity: Number(t.quantity) || 0 }))
      : []
  });
}

function clearCalendarPayloadCache(urlKey, reason) {
  if (!urlKey) return;
  delete interceptedCalendars[urlKey];
  delete interceptedCalendars[urlKey + '_month'];
  delete interceptedCalendars[urlKey + '_signature'];
  if (reason) log('WARN', `[CALENDAR] reset cached payload: ${reason}`);
}

function clearAllCalendarPayloadCaches(reason) {
  for (const key of Object.keys(interceptedCalendars)) {
    delete interceptedCalendars[key];
  }
  if (reason) log('WARN', `[CALENDAR] reset all cached payloads: ${reason}`);
}

function getProxyProbeTarget() {
  const targetType = getCurrentTargetType();
  const rawTarget = Array.isArray(config.targets)
    ? config.targets.find((target) => target.type === targetType)
    : null;
  return rawTarget ? buildEffectiveTarget(rawTarget, getCurrentNodeOverride()) : null;
}

function isHealthyProxyProbeResult(result) {
  return !!result && ['available', 'unavailable', 'no_slots'].includes(result.status);
}

async function probeBannedProxy(proxyIdx, target) {
  let probeBrowser = null;
  let probePage = null;

  selectCurrentProxy(proxyIdx);
  clearAllCalendarPayloadCaches(`proxy ban probe #${proxyIdx}`);
  log('PROXY', `[PROXY BAN] probing proxy #${proxyIdx} (${currentProxy ? `${currentProxy.host}:${currentProxy.port}` : 'direct'})`);

  try {
    const opened = await openPollingBrowserForCurrentProxy();
    probeBrowser = opened.browser;
    probePage = opened.page;
    const result = await checkAvailability(probePage, target);

    if (isHealthyProxyProbeResult(result)) {
      clearProxyBanAfterProbe(proxyIdx, `calendar_${result.status}`);
      return { proxyIdx, cleared: true, status: result.status };
    }

    const status = result?.status || result?.reason || 'unknown';
    log('PROXY', `[PROXY BAN] proxy #${proxyIdx} still blocked/unhealthy after probe status=${status}`);
    return { proxyIdx, cleared: false, status };
  } catch (error) {
    log('WARN', `[PROXY BAN] probe failed for proxy #${proxyIdx}: ${error.message}`);
    return { proxyIdx, cleared: false, status: 'probe_error' };
  } finally {
    isTestProbe = false;
    if (probeBrowser) await closeBrowserAndFlushProxyReleases(probeBrowser, 'proxy_ban_probe_close', { proxyIdx });
  }
}

async function runProxyBanProbeRound(proxyIndexes, options = {}) {
  const target = getProxyProbeTarget();
  if (!target) {
    log('WARN', '[PROXY BAN] probe skipped: no target for current mode');
    return { checked: 0, cleared: 0, results: [] };
  }

  const force = options.force === true;
  const quick = options.quick === true;
  const reason = options.reason || 'scheduled';
  const delayMin = quick ? PROXY_BAN_FAST_PROBE_MIN_DELAY_MS : 750;
  const delayMax = quick ? PROXY_BAN_FAST_PROBE_MAX_DELAY_MS : 1500;
  const uniqueProxyIndexes = Array.from(new Set((proxyIndexes || []).map((idx) => Number(idx)).filter((idx) => Number.isInteger(idx) && idx >= 0)));
  const results = [];
  log('PROXY', `[PROXY BAN] probe round started: ${uniqueProxyIndexes.length} proxy/proxies reason=${reason} quick=${quick} force=${force}`);

  for (const proxyIdx of uniqueProxyIndexes) {
    if (!force && !((proxyBans[proxyIdx] || 0) > Date.now())) continue;
    isTestProbe = true;
    const result = await probeBannedProxy(proxyIdx, target);
    results.push(result);
    const delayMs = delayMin + Math.random() * Math.max(0, delayMax - delayMin);
    if (delayMs > 0) await sleep(delayMs);
  }

  const cleared = results.filter((result) => result.cleared).length;
  scheduleNextProxyBanProbe(Date.now(), false);
  log('PROXY', `[PROXY BAN] probe round finished: checked=${results.length}, cleared=${cleared}, next_ms=${Math.max(0, nextProxyBanProbeAtMs - Date.now())}`);
  return { checked: results.length, cleared, results };
}

function buildCalendarPageContext(target) {
  let effectiveUrl = target.url;
  let refDate = getTargetReferenceDate(target);
  if (!refDate && target.min_days_ahead) {
    refDate = new Date();
    refDate.setDate(refDate.getDate() + target.min_days_ahead);
  }
  if (refDate) {
    const tParam = refDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const baseUrl = target.url.split('?')[0];
    effectiveUrl = `${baseUrl}?t=${encodeURIComponent(tParam)}`;
  }

  return {
    effectiveUrl,
    urlKey: target.url.split('?')[0],
    cacheSignature: getCalendarPayloadCacheSignature(target)
  };
}

function rememberCalendarPayloadRequest(request, target, urlKey, cacheSignature) {
  if (!request.url().includes('/mtajax/calendars_month') || request.method() !== 'POST' || !request.postData()) return;
  interceptedCalendars[urlKey] = request.postData();
  interceptedCalendars[urlKey + '_signature'] = cacheSignature;
  let cacheDate = getTargetReferenceDate(target);
  if (!cacheDate && target.min_days_ahead) {
    cacheDate = new Date();
    cacheDate.setDate(cacheDate.getDate() + target.min_days_ahead);
  }
  if (cacheDate) interceptedCalendars[urlKey + '_month'] = `${cacheDate.getFullYear()}-${cacheDate.getMonth()}`;
}

function buildStaticCalendarPayload(target) {
  const url = String(target?.url || '');
  let pageId = target?.calendar_page_id || target?.calendarPageId || target?.page_id || target?.pageId || null;
  if (!pageId && url.includes('/24h-colosseo-foro-romano-palatino-gruppi/')) {
    pageId = 332;
  }
  if (!pageId && url.includes('/24h-colosseo-foro-romano-palatino/')) {
    pageId = 35;
  }
  if (!pageId) return null;

  const refDate = getTargetReferenceDate(target) || new Date();
  const params = new URLSearchParams();
  params.set('action', 'midaabc_calendars_month');
  params.set('page', String(pageId));
  params.set('year', String(refDate.getFullYear()));
  params.set('month', String(refDate.getMonth() + 1));
  params.set('day', '');
  return params.toString();
}

function rememberStaticCalendarPayload(target, urlKey, cacheSignature, reason) {
  const normalizedReason = String(reason || 'unknown');
  const isWafReason = /waf|block|403/i.test(normalizedReason);
  const isPageBlockReason = /page.*block|payload.*block|cached_payload_origin_waf_block/i.test(normalizedReason);
  if (!STATIC_CALENDAR_PAYLOAD_ENABLED) {
    log('WARN', `[CALENDAR] static calendars payload disabled reason=${normalizedReason}`);
    return false;
  }
  if (isWafReason && !STATIC_CALENDAR_PAYLOAD_AFTER_WAF_ENABLED) {
    log('WARN', `[CALENDAR] static calendars payload skipped after WAF/page block reason=${normalizedReason}`);
    return false;
  }
  if (isPageBlockReason && !STATIC_CALENDAR_PAYLOAD_AFTER_PAGE_BLOCK_ENABLED) {
    log('WARN', `[CALENDAR] static calendars payload skipped after page block reason=${normalizedReason}`);
    return false;
  }
  const payload = buildStaticCalendarPayload(target);
  if (!payload) return false;
  interceptedCalendars[urlKey] = payload;
  interceptedCalendars[urlKey + '_signature'] = cacheSignature;
  interceptedCalendars[urlKey + '_staticReason'] = normalizedReason;
  const refDate = getTargetReferenceDate(target) || new Date();
  interceptedCalendars[urlKey + '_month'] = `${refDate.getFullYear()}-${refDate.getMonth()}`;
  log('WARN', `[CALENDAR] using static calendars payload reason=${normalizedReason} payload=${payload}`);
  return true;
}

async function prewarmCalendarPayload(page, target, reason = 'before_strict_slot') {
  if (!page || !target || !target.url) return { ok: false, reason: 'missing_page_or_target' };
  const { effectiveUrl, urlKey, cacheSignature } = buildCalendarPageContext(target);
  if (interceptedCalendars[urlKey]) return { ok: true, cached: true, reason: 'payload_already_cached' };

  const interceptFn = request => rememberCalendarPayloadRequest(request, target, urlKey, cacheSignature);
  try {
    page.on('request', interceptFn);
    log('SCHEDULER', `[SCHEDULER] prewarm page_load allowed_outside_grid=true reason=${reason} proxy=${currentProxyIndex}`);

    const currentUrl = page.url();
    if (currentUrl.includes(urlKey) && currentUrl !== 'about:blank') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => log('WARN', `[PREWARM] reload failed proxy=${currentProxyIndex} error="${e.message}"`));
    } else {
      await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => log('WARN', `[PREWARM] goto failed proxy=${currentProxyIndex} error="${e.message}"`));
    }

    const startedAt = Date.now();
    while (!interceptedCalendars[urlKey] && Date.now() - startedAt < PREWARM_PAYLOAD_WAIT_MS) {
      await sleep(500);
    }
  } catch (error) {
    log('WARN', `[PREWARM] page_load error proxy=${currentProxyIndex} error="${error.message}"`);
  } finally {
    page.off('request', interceptFn);
  }

  if (interceptedCalendars[urlKey]) {
    log('SCHEDULER', `[SCHEDULER] prewarm payload_ready proxy=${currentProxyIndex} reason=${reason}`);
    return { ok: true, reason: 'payload_ready' };
  }

  const { currentUrl, title, snippet } = await capturePayloadMissContext(page);
  if (isProxyConnectFailureText(currentUrl, title, snippet)) {
    log('WARN', `[PREWARM] connect_fail proxy=${currentProxyIndex} url=${currentUrl || 'n/a'}`);
    rotateProxyAfterConnectFailure('prewarm_connect_fail');
    clearCalendarPayloadCache(urlKey, 'prewarm connect fail');
    return { ok: false, reason: 'connect_fail' };
  }
  if (isWafLikeText(`${title} ${snippet}`)) {
    log('WARN', `[PREWARM] waf_pressure proxy=${currentProxyIndex} title="${title || 'n/a'}"`);
    rotateProxyAfterWafPressure('prewarm_waf_block');
    clearCalendarPayloadCache(urlKey, 'prewarm waf pressure');
    return { ok: false, reason: 'waf_pressure' };
  }

  log('WARN', `[PREWARM] payload_missing proxy=${currentProxyIndex} url=${currentUrl || 'n/a'} title="${title || 'n/a'}"`);
  clearCalendarPayloadCache(urlKey, 'prewarm payload missing');
  return { ok: false, reason: 'payload_missing' };
}

async function prewarmBrowserBeforeNextStrictSlot(browser, page, consecutiveErrors) {
  if (!PREWARM_BEFORE_STRICT_SLOT_ENABLED || !isSharedProxyPoolActiveForNode()) {
    return { browser, page, consecutiveErrors };
  }
  if (consecutiveErrors < 2) return { browser, page, consecutiveErrors };

  const target = getPrimaryPollingTargetForPrewarm();
  if (!target) return { browser, page, consecutiveErrors };

  let currentBrowser = browser;
  let currentPage = page;
  let currentErrors = consecutiveErrors;

  for (let attempt = 1; attempt <= PREWARM_BEFORE_STRICT_SLOT_MAX_ATTEMPTS; attempt++) {
    const timeToSlotMs = calcSyncedRetryDelay();
    if (timeToSlotMs < PREWARM_BEFORE_STRICT_SLOT_MIN_MS) {
      log('SCHEDULER', `[SCHEDULER] prewarm skipped reason=slot_too_close ms=${timeToSlotMs}`);
      break;
    }

    try {
      if (currentBrowser) {
        await closeBrowserAndFlushProxyReleases(currentBrowser, 'prewarm_browser_recreate');
        currentBrowser = null;
        currentPage = null;
      }

      currentBrowser = await createBrowser();
      currentPage = await getBrowserWorkPage(currentBrowser, `prewarm-proxy-${currentProxyIndex}`);
      if (currentProxy && currentProxy.username && !proxyRelayState[currentProxyIndex]) {
        await currentPage.authenticate({
          username: currentProxy.username,
          password: currentProxy.password
        });
      }

      const result = await prewarmCalendarPayload(currentPage, target, `attempt_${attempt}`);
      if (result.ok) {
        currentErrors = 0;
        log('SCHEDULER', `[SCHEDULER] prewarm browser_ready proxy=${currentProxyIndex} attempt=${attempt}/${PREWARM_BEFORE_STRICT_SLOT_MAX_ATTEMPTS}`);
        break;
      }
      currentErrors = 2;
    } catch (error) {
      currentErrors = 2;
      log('WARN', `[SCHEDULER] prewarm failed attempt=${attempt}/${PREWARM_BEFORE_STRICT_SLOT_MAX_ATTEMPTS} error="${error.message}"`);
    }
  }

  return { browser: currentBrowser, page: currentPage, consecutiveErrors: currentErrors };
}

async function checkAvailability(page, target) {
  // РІвЂўС’РІвЂўС’РІвЂўС’ Р вЂќР С‘Р Р…Р В°Р СР С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ Р С–Р ВµР Р…Р ВµРЎР‚Р В°РЎвЂ Р С‘РЎРЏ URL Р Т‘Р В»РЎРЏ Р вЂ™Р РЋР вЂўР Тђ РЎвЂљР С‘Р С—Р С•Р Р† (group, underground, individual) РІвЂўС’РІвЂўС’РІвЂўС’
  const { effectiveUrl, urlKey, cacheSignature } = buildCalendarPageContext(target);
  logProxyContext('calendar_prepare', page, `targetType=${target?.type || 'unknown'} urlKey=${urlKey}`);

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р С™РЎРЊРЎв‚¬-Р С‘Р Р…Р Р†Р В°Р В»Р С‘Р Т‘Р В°РЎвЂ Р С‘РЎРЏ Р С—РЎР‚Р С‘ РЎРѓР СР ВµР Р…Р Вµ Р СР ВµРЎРѓРЎРЏРЎвЂ Р В° РЎвЂ Р ВµР В»Р С‘ (Р Т‘Р В»РЎРЏ Р вЂ™Р РЋР вЂўР Тђ РЎвЂљР С‘Р С—Р С•Р Р†) РІвЂўС’РІвЂўС’РІвЂўС’
  if (interceptedCalendars[urlKey]) {
    if (interceptedCalendars[urlKey + '_signature'] && interceptedCalendars[urlKey + '_signature'] !== cacheSignature) {
      clearCalendarPayloadCache(urlKey, 'target signature changed');
    }
  }

  if (interceptedCalendars[urlKey]) {
    let checkDate = getTargetReferenceDate(target);
    if (!checkDate && target.min_days_ahead) { checkDate = new Date(); checkDate.setDate(checkDate.getDate() + target.min_days_ahead); }
    if (checkDate) {
      const targetMonthKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
      if (interceptedCalendars[urlKey + '_month'] !== targetMonthKey) {
        log('СЂСџвЂќвЂћ', `Р РЋР СР ВµР Р…Р В° Р СР ВµРЎРѓРЎРЏРЎвЂ Р В° РЎвЂ Р ВµР В»Р С‘ РІвЂ вЂ™ РЎРѓР В±РЎР‚Р С•РЎРѓ Р С”РЎРЊРЎв‚¬Р В° calendars payload`);
        clearCalendarPayloadCache(urlKey, 'target month changed');
      }
    }
  }

  // When a cached calendars payload exists but the current page is about:blank
  // (common after direct recatch browser preparation), a relative fetch('/mtajax/...')
  // will fail with "Failed to parse URL".  Put the page back on the target origin first.
  if (interceptedCalendars[urlKey]) {
    const currentUrlForOrigin = page && typeof page.url === 'function' ? page.url() : '';
    const pageHasTargetOrigin = Boolean(currentUrlForOrigin && currentUrlForOrigin !== 'about:blank' && currentUrlForOrigin.startsWith(urlKey));
    if (!pageHasTargetOrigin) {
      log('SCHEDULER', isTestProbe
        ? '[SCHEDULER] proxy_probe cached_payload_origin_prepare allowed_outside_grid=true'
        : '[SCHEDULER] strict_grid cached_payload_origin_prepare page_load allowed_by_slot=true');
      await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
        .catch(e => log('WARN', `[CALENDAR] cached_payload_origin_prepare goto_error=${e.message}`));

      const preparedContent = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      if (isProxyConnectFailureText(page.url ? page.url() : '', '', preparedContent)) {
        recordCalendarEvent('connect_fail');
        log('WARN', `[PROXY] Cached payload origin prepare failed on proxy #${currentProxyIndex} (${currentProxy ? currentProxy.host : 'direct'}) -> connect_fail, rotate proxy, next strict-grid cycle`);
        rotateProxyAfterConnectFailure('cached_payload_origin_connect_fail');
        clearCalendarPayloadCache(urlKey, 'cached payload origin connect fail');
        return { status: WAF_PRESSURE_STATUS, reason: 'cached_payload_origin_connect_fail' };
      }
      if (isWafLikeText(preparedContent) || preparedContent.includes('Block')) {
        const failClosed = failClosedAfterPageWaf('cached_payload_origin_waf_block', page, urlKey);
        if (failClosed) return failClosed;
        if (rememberStaticCalendarPayload(target, urlKey, cacheSignature, 'cached_payload_origin_waf_block')) {
          log('WARN', `[WAF] Cached payload origin prepare blocked ${formatProxyContext(getPageProxyContext(page))} -> use static calendar payload, no proxy rotate`);
          await neutralizeVisibleWafPage(page, 'cached_payload_origin_waf_block');
        } else {
          log('WARN', `[WAF] Cached payload origin prepare blocked ${formatProxyContext(getPageProxyContext(page))} -> rotate proxy, no local proxy ban, next strict-grid cycle`);
          rotateProxyAfterWafPressure('cached_payload_origin_waf_block');
          clearCalendarPayloadCache(urlKey, 'cached payload origin waf pressure');
          return { status: WAF_PRESSURE_STATUS, reason: 'cached_payload_origin_waf_block' };
        }
      }
    }
  }

  let domSlots = [];

  if (!interceptedCalendars[urlKey]) {
    log('СЂСџвЂќРЊ', `Р СџР ВµРЎР‚Р Р†Р С‘РЎвЂЎР Р…Р В°РЎРЏ Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р В° Р С‘ Р С•Р В±РЎвЂ¦Р С•Р Т‘ Р В·Р В°РЎвЂ°Р С‘РЎвЂљРЎвЂ№ Р Т‘Р В»РЎРЏ: ${effectiveUrl.substring(0, 60)}...`);
    let interceptFn = null;
    try {
      interceptFn = request => {
        if (request.url().includes('/mtajax/calendars_month') && request.method() === 'POST' && request.postData()) {
          interceptedCalendars[urlKey] = request.postData();
          interceptedCalendars[urlKey + '_signature'] = cacheSignature;
          // Р РЋР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎРЏР ВµР С Р СР ВµРЎРѓРЎРЏРЎвЂ  Р Т‘Р В»РЎРЏ Р С”РЎРЊРЎв‚¬-Р С‘Р Р…Р Р†Р В°Р В»Р С‘Р Т‘Р В°РЎвЂ Р С‘Р С‘ (Р Т‘Р В»РЎРЏ Р вЂ™Р РЋР вЂўР Тђ РЎвЂљР С‘Р С—Р С•Р Р†)
          let cacheDate = getTargetReferenceDate(target);
          if (!cacheDate && target.min_days_ahead) { cacheDate = new Date(); cacheDate.setDate(cacheDate.getDate() + target.min_days_ahead); }
          if (cacheDate) interceptedCalendars[urlKey + '_month'] = `${cacheDate.getFullYear()}-${cacheDate.getMonth()}`;
        }
      };
      page.on('request', interceptFn);

      log('SCHEDULER', isTestProbe
        ? '[SCHEDULER] proxy_probe page_load allowed_outside_grid=true'
        : '[SCHEDULER] strict_grid page_load allowed_by_slot=true');

      // Р ВР СљР ВР СћР С’Р В¦Р ВР Р‡ Р СњР С’Р вЂ“Р С’Р СћР ВР Р‡ F5 (Р вЂўРЎРѓР В»Р С‘ Р СРЎвЂ№ РЎС“Р В¶Р Вµ Р Р…Р В° РЎРѓР В°Р в„–РЎвЂљР Вµ - Р С•Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР СРЎРѓРЎРЏ, Р В° Р Р…Р Вµ Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р С•Р Т‘Р С‘Р С)
      const currentUrl = page.url();
      if (currentUrl.includes(urlKey) && currentUrl !== 'about:blank') {
        log('СЂСџвЂќвЂћ', `Р РЋРЎвЂљРЎР‚Р В°Р Р…Р С‘РЎвЂ Р В° РЎС“Р В¶Р Вµ Р С•РЎвЂљР С”РЎР‚РЎвЂ№РЎвЂљР В°, Р С‘Р СР С‘РЎвЂљР С‘РЎР‚РЎС“Р ВµР С Р Р…Р В°Р В¶Р В°РЎвЂљР С‘Р Вµ F5 (page.reload)...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => log('РІС™В РїС‘РЏ', `Р С›РЎв‚¬Р С‘Р В±Р С”Р В° reload: ${e.message}`));
      } else {
        log('СЂСџРЉС’', `Р СџР ВµРЎР‚Р ВµРЎвЂ¦Р С•Р Т‘ Р С—Р С• URL (page.goto)...`);
        await page.goto(effectiveUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => log('РІС™В РїС‘РЏ', `Р С›РЎв‚¬Р С‘Р В±Р С”Р В° goto: ${e.message}`));
      }

      for (let i = 0; i < 15; i++) {
        if (interceptedCalendars[urlKey]) break;
        const earlyPageContent = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
        if (earlyPageContent && (isWafLikeText(earlyPageContent) || earlyPageContent.includes('Block'))) {
          const failClosed = failClosedAfterPageWaf('page_waf_block_early', page, urlKey);
          if (failClosed) return failClosed;
          if (rememberStaticCalendarPayload(target, urlKey, cacheSignature, 'page_waf_block_early')) {
            log('WARN', `[WAF] Page block detected early ${formatProxyContext(getPageProxyContext(page))} -> use static calendar payload, neutralize visible page, no proxy rotate`);
            await neutralizeVisibleWafPage(page, 'page_waf_block_early');
          }
          break;
        }
        await sleep(1000);
      }
    } catch (e) {
      log('РІС™В РїС‘РЏ', `Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р Р…Р В°Р Р†Р С‘Р С–Р В°РЎвЂ Р С‘Р С‘: ${e.message.slice(0, 50)}`);
    } finally {
      if (interceptFn) page.off('request', interceptFn);
    }

    if (!interceptedCalendars[urlKey]) {
      const pageContent = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      if (isProxyConnectFailureText(page.url ? page.url() : '', '', pageContent)) {
        recordCalendarEvent('connect_fail');
        log('WARN', `[PROXY] Page load failed on proxy #${currentProxyIndex} (${currentProxy ? currentProxy.host : 'direct'}) -> connect_fail, rotate proxy, next strict-grid cycle`);
        rotateProxyAfterConnectFailure('page_connect_fail');
        clearCalendarPayloadCache(urlKey, 'page connect fail');
        return { status: WAF_PRESSURE_STATUS, reason: 'page_connect_fail' };
      }
      if (isWafLikeText(pageContent) || pageContent.includes('Block')) {
        const wafUrl = page && typeof page.url === 'function' ? page.url() : '';
        const wafTitle = await page.title().catch(() => '');
        const wafSnippet = String(pageContent || '').replace(/\s+/g, ' ').trim().substring(0, 220);
        const failClosed = failClosedAfterPageWaf('page_waf_block', page, urlKey, `url=${wafUrl || 'n/a'} title="${wafTitle}" snippet="${wafSnippet}"`);
        if (failClosed) return failClosed;
        if (rememberStaticCalendarPayload(target, urlKey, cacheSignature, 'page_waf_block')) {
          log('WARN', `[WAF] Page block ${formatProxyContext(getPageProxyContext(page))} url=${wafUrl || 'n/a'} title="${wafTitle}" snippet="${wafSnippet}" -> use static calendar payload, no proxy rotate`);
          await neutralizeVisibleWafPage(page, 'page_waf_block');
        } else {
          log('WARN', `[WAF] Page block ${formatProxyContext(getPageProxyContext(page))} url=${wafUrl || 'n/a'} title="${wafTitle}" snippet="${wafSnippet}" -> rotate proxy, no local proxy ban, next strict-grid cycle`);
          rotateProxyAfterWafPressure('page_waf_block');
          clearCalendarPayloadCache(urlKey, 'page waf pressure');
          return { status: WAF_PRESSURE_STATUS, reason: 'page_waf_block' };
        }
      }

      const manualPayloadRefDate = getTargetReferenceDate(target) || new Date();
      const manualPayloadYear = manualPayloadRefDate.getFullYear();
      const manualPayloadMonth = manualPayloadRefDate.getMonth() + 1;
      const manualPayload = await page.evaluate((year, month) => {
        const html = document.body ? document.body.innerHTML : '';
        const match = html.match(/"entranceEvent_guid"\s*(?:=>|:)\s*"([a-f0-9\-]{36})/i) || html.match(/name="entranceEvent_guid"\s*value="([a-f0-9\-]{36})/i);
        if (match) return `action=midaabc_calendars_month&guids[entranceEvent_guid][]=${match[1]}&year=${year}&month=${month}&day=`;
        return null;
      }, manualPayloadYear, manualPayloadMonth).catch(() => null);
      if (manualPayload) {
        interceptedCalendars[urlKey] = manualPayload;
        interceptedCalendars[urlKey + '_signature'] = cacheSignature;
      }
      if (!manualPayload) {
        domSlots = await extractSlotsFromDom(page, target);
        if (domSlots.length > 0) {
          log('Р Р†РЎС™РІР‚В¦', `[DOM] Р В Р’ВР В Р’В· Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р РЋРІР‚в„– Р В РЎвЂР В Р’В·Р В Р вЂ Р В Р’В»Р В Р’ВµР РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂў ${domSlots.length} Р РЋР С“Р В Р’В»Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР В Р вЂ  Р В Р’В±Р В Р’ВµР В Р’В· calendars payload.`);
        }
      }
    }
  }

  let payload = interceptedCalendars[urlKey];
  if (!payload && domSlots.length === 0) {
    const missCount = (payloadMissCounts[currentProxyIndex] || 0) + 1;
    payloadMissCounts[currentProxyIndex] = missCount;
    const { currentUrl, title, snippet } = await capturePayloadMissContext(page);
    if (currentUrl || title || snippet) {
      log('РЎР‚РЎСџРІР‚СљРІР‚С›', `Payload miss context: url=${currentUrl || 'n/a'} | title=${title || 'n/a'} | body=${snippet || 'n/a'}`);
    }
    if (isProxyConnectFailureText(currentUrl, title, snippet)) {
      recordCalendarEvent('connect_fail');
      log('WARN', `[PROXY] Payload missing because page load failed on proxy #${currentProxyIndex} (${currentProxy ? currentProxy.host : 'direct'}) -> connect_fail, rotate proxy, next strict-grid cycle`);
      rotateProxyAfterConnectFailure('payload_connect_fail');
      clearCalendarPayloadCache(urlKey, 'payload connect fail');
      return { status: WAF_PRESSURE_STATUS, reason: 'payload_connect_fail' };
    }
    if (isWafLikeText(`${title} ${snippet}`)) {
      const failClosed = failClosedAfterPageWaf('payload_waf_block', page, urlKey);
      if (failClosed) return failClosed;
      if (rememberStaticCalendarPayload(target, urlKey, cacheSignature, 'payload_waf_block')) {
        log('WARN', `[WAF] Payload missing because page is blocked ${formatProxyContext(getPageProxyContext(page))} -> use static calendar payload, no proxy rotate`);
        await neutralizeVisibleWafPage(page, 'payload_waf_block');
        payload = interceptedCalendars[urlKey];
      } else {
        log('WARN', `[WAF] Payload missing because page is blocked ${formatProxyContext(getPageProxyContext(page))} -> rotate proxy, no proxy ban, next strict-grid cycle`);
        rotateProxyAfterWafPressure('payload_waf_block');
        clearCalendarPayloadCache(urlKey, 'payload missing waf pressure');
        return { status: WAF_PRESSURE_STATUS, reason: 'payload_waf_block' };
      }
    }
    if (payload) {
      resetPayloadMissCount();
    } else if (missCount >= PAYLOAD_FAIL_MAX) {
      log('WARN', `[PAYLOAD] Payload API miss x${missCount} on proxy #${currentProxyIndex} -> no proxy ban; refresh browser on next cycle`);
      clearCalendarPayloadCache(urlKey, 'payload missing hard block');
      return { status: 'error', reason: 'payload_missing' };
    } else {
      log('РІСњРЉ', 'Р СњР Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ Р С—Р С•Р В»РЎС“РЎвЂЎР С‘РЎвЂљРЎРЉ Payload API. Р С›РЎвЂЎР С‘РЎРѓРЎвЂљР С”Р В° РЎРѓР ВµРЎРѓРЎРѓР С‘Р С‘ Р Т‘Р В»РЎРЏ Р С—Р ВµРЎР‚Р ВµР С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘РЎРЏ.');
      clearCalendarPayloadCache(urlKey, 'payload missing');
      return { status: 'error', reason: 'payload_missing' };
    }
  }
  resetPayloadMissCount();

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р С™Р В°Р В¶Р Т‘РЎвЂ№Р в„– 48-Р в„– Р В·Р В°Р С—РЎР‚Р С•РЎРѓ РІР‚вЂќ Р С—РЎР‚Р С‘Р Р…РЎС“Р Т‘Р С‘РЎвЂљР ВµР В»РЎРЉР Р…Р В°РЎРЏ Р С—Р В°РЎС“Р В·Р В° 3 Р СР С‘Р Р…РЎС“РЎвЂљРЎвЂ№ РІвЂўС’РІвЂўС’РІвЂўС’
  calendarRequestCount++;
  if (calendarRequestCount % CALENDAR_EVERY_NTH === 0) {
    const pauseMs = CALENDAR_NTH_DELAY_MIN_MS + Math.random() * (CALENDAR_NTH_DELAY_MAX_MS - CALENDAR_NTH_DELAY_MIN_MS);
    log('РІРЏС‘РїС‘РЏ', `Р С™Р В°Р В¶Р Т‘РЎвЂ№Р в„– ${CALENDAR_EVERY_NTH}-Р в„– Р В·Р В°Р С—РЎР‚Р С•РЎРѓ (#${calendarRequestCount}), Р С—Р В°РЎС“Р В·Р В° ${(pauseMs / 1000).toFixed(0)}РЎРѓ`);
    saveBanState();
    await sleep(pauseMs);
  } else if (calendarRequestCount % 10 === 0) {
    saveBanState();
  }

  await performWarmup(page);

  log('SCHEDULER', isTestProbe
    ? '[SCHEDULER] proxy_probe calendar_api allowed_outside_grid=true'
    : '[SCHEDULER] strict_grid calendar_api allowed_by_slot=true');
  logProxyContext('calendar_api', page, `targetType=${target?.type || 'unknown'}`);

  let allSlots = [];

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р Р€Р Р…Р С‘Р Р†Р ВµРЎР‚РЎРѓР В°Р В»РЎРЉР Р…РЎвЂ№Р в„– multi-month Р В·Р В°Р С—РЎР‚Р С•РЎРѓ (Р Т‘Р В»РЎРЏ Р вЂ™Р РЋР вЂўР Тђ РЎвЂљР С‘Р С—Р С•Р Р†: group, underground, individual) РІвЂўС’РІвЂўС’РІвЂўС’
  let monthsToCheck = [];

  if (target.target_datetime_start || target.target_datetime_end) {
    monthsToCheck = getMonthsForLocalDateRange(
      target.target_datetime_start || target.target_datetime_end,
      target.target_datetime_end || target.target_datetime_start
    );
  } else if (target.target_date) {
    const td = new Date(target.target_date + 'T12:00:00Z');
    monthsToCheck = [{ year: td.getUTCFullYear(), month: td.getUTCMonth() + 1 }];
  } else if (target.target_date_start && target.target_date_end) {
    monthsToCheck = getMonthsForLocalDateRange(target.target_date_start, target.target_date_end);
  } else if (target.min_days_ahead) {
    const minDays = target.min_days_ahead;
    const maxDays = target.max_days_ahead || 31;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startDate = new Date(today); startDate.setDate(today.getDate() + minDays);
    const endDate = new Date(today); endDate.setDate(today.getDate() + maxDays);

    monthsToCheck = getMonthsForLocalDateRange(
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10)
    );
  } else {
    // Fallback: РЎвЂљР ВµР С”РЎС“РЎвЂ°Р С‘Р в„– Р СР ВµРЎРѓРЎРЏРЎвЂ 
    const now = new Date();
    monthsToCheck = [{ year: now.getFullYear(), month: now.getMonth() + 1 }];
  }

  log('СЂСџвЂќРЊ', `Р вЂ”Р В°Р С—РЎР‚Р В°РЎв‚¬Р С‘Р Р†Р В°Р ВµР С ${monthsToCheck.length} Р СР ВµРЎРѓ (${target.type}): ${monthsToCheck.map(m => `${m.year}-${String(m.month).padStart(2,'0')}`).join(', ')}`);

  if (domSlots.length > 0) {
    allSlots = allSlots.concat(domSlots);
  } else for (const { year, month } of monthsToCheck) {
    const patchedPayload = payload.replace(/year=\d+/, `year=${year}`).replace(/month=\d+/, `month=${month}`);

    const resp = await page.evaluate(async (pData) => {
      const requestContext = (() => {
        let cookieNames = [];
        let cookieReadError = '';
        try {
          cookieNames = String(document.cookie || '')
            .split(';')
            .map((entry) => entry.split('=')[0].trim())
            .filter(Boolean)
            .sort();
        } catch (error) {
          cookieReadError = String(error && error.message || error || '').substring(0, 180);
        }
        return {
          pageUrl: window.location.href,
          origin: window.location.origin,
          referrer: document.referrer || '',
          readyState: document.readyState || '',
          cookieNames,
          cookieReadError,
          hasPhpSession: cookieNames.some((name) => /^PHPSESSID$/i.test(name)),
          hasOctofenceCookie: cookieNames.some((name) => /octo|fence|clearance/i.test(name))
        };
      })();
      try {
        const res = await fetch('/mtajax/calendars_month', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01' },
          body: pData
        });
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { }
        const textLower = text.toLowerCase();
        const isWaf = res.status === 403 && (textLower.includes('cloudflare') || textLower.includes('octofence') || textLower.includes('cf-ray'));
        const wafHeaders = {
          mslc: res.headers.get('x-octofence-mslc') || '',
          asn: res.headers.get('x-octofence-asn') || '',
          cache: res.headers.get('x-octofence-cache') || ''
        };
        const snippet = text.replace(/\s+/g, ' ').trim().substring(0, 300);
        return { status: res.status, data, isWaf, wafHeaders, requestContext, responseSnippet: (res.status !== 200 || !data) ? snippet : '' };
      } catch (e) { return { status: 500, data: null, isWaf: false, requestContext, responseSnippet: String(e && e.message || e).substring(0, 300) }; }
    }, patchedPayload).catch((e) => ({ status: 500, data: null, isWaf: false, responseSnippet: String(e && e.message || e).substring(0, 300) }));

    // 1. Р Р€РЎРѓР С—Р ВµРЎвЂ¦ -> Р РЋР В±РЎР‚Р В°РЎРѓРЎвЂ№Р Р†Р В°Р ВµР С РЎвЂћР В»Р В°Р С–Р С‘ Р С•РЎв‚¬Р С‘Р В±Р С•Р С”
    if (resp && resp.status === 200) {
      recordCalendarEvent('success');
      hadRateLimit429 = false;
      consecutive403Count = 0;
      internal403Count = 0;
      delete calendar429Streaks[currentProxyIndex];
    }

    // 2. Р С›Р В±РЎР‚Р В°Р В±Р С•РЎвЂљР С”Р В° 429
    if (resp && resp.status === 429) {
      recordCalendarEvent('rate429');
      hadRateLimit429 = true; consecutive403Count = 0; calendar429Count++;
      const proxyIdx = currentProxyIndex;
      const proxyStreak = (calendar429Streaks[proxyIdx] || 0) + 1;
      calendar429Streaks[proxyIdx] = proxyStreak;
      log('СЂСџвЂќвЂ', `429 Р Р…Р В° Р С”Р В°Р В»Р ВµР Р…Р Т‘Р В°РЎР‚Р Вµ (РЎРѓРЎвЂЎРЎвЂРЎвЂљРЎвЂЎР С‘Р С”: ${calendar429Count}/${CALENDAR_429_EVERY_NTH}).`);
      if (proxyStreak >= LEGACY_CALENDAR_429_ROTATE_AFTER) {
        const reason = `calendar_429_x${proxyStreak}`;
        log('WARN', `[CALENDAR] 429 pressure on proxy #${proxyIdx} (${currentProxy ? currentProxy.host : 'direct'}) streak=${proxyStreak}/${LEGACY_CALENDAR_429_ROTATE_AFTER} -> rotate proxy, no proxy ban, next strict-grid cycle`);
        rotateProxyAfterCalendar429Pressure(reason, proxyStreak);
        clearCalendarPayloadCache(urlKey, 'calendar 429 pressure');
        return { status: WAF_PRESSURE_STATUS, reason };
      }
      if (calendar429Count % CALENDAR_429_EVERY_NTH === 0) {
        const pauseMs = CALENDAR_NTH_DELAY_MIN_MS + Math.random() * (CALENDAR_NTH_DELAY_MAX_MS - CALENDAR_NTH_DELAY_MIN_MS);
        await sleep(pauseMs);
      }
      return { status: 'rate_limited' };
    }

    // 3. Р С›Р В±РЎР‚Р В°Р В±Р С•РЎвЂљР С”Р В° 403
    if (resp && resp.status === 403) {
      if (resp.responseSnippet) log('СЂСџвЂњвЂћ', `403 Calendar body: ${resp.responseSnippet.substring(0, 150)}`);
      if (resp.isWaf) {
        recordCalendarEvent('waf403');
        const wafMeta = resp.wafHeaders
          ? ` mslc=${resp.wafHeaders.mslc || 'n/a'} asn=${resp.wafHeaders.asn || 'n/a'} cache=${resp.wafHeaders.cache || 'n/a'}`
          : '';
        const requestDiag = formatCalendarRequestContext(resp.requestContext);
        log('WARN', `[CALENDAR] WAF 403 ${formatProxyContext(getPageProxyContext(page))}${wafMeta}${requestDiag} -> cooldown proxy, rotate, next strict-grid cycle`);
        rotateProxyAfterCalendarWaf403('calendar_waf_403', {
          mslc: resp.wafHeaders?.mslc || '',
          asn: resp.wafHeaders?.asn || '',
          cache: resp.wafHeaders?.cache || '',
          requestContext: resp.requestContext || null
        });
        clearCalendarPayloadCache(urlKey, 'calendar waf 403 pressure');
        return { status: WAF_PRESSURE_STATUS, reason: 'calendar_waf_403' };
      }
      internal403Count++;
      recordCalendarEvent('other_fail');
      if (internal403Count >= 3) {
        log('WARN', `[CALENDAR] Internal 403 x${internal403Count} on proxy #${currentProxyIndex} -> rotate proxy, no proxy ban, next strict-grid cycle`);
        internal403Count = 0;
        rotateProxyAfterWafPressure('calendar_internal_403_x3');
        clearCalendarPayloadCache(urlKey, 'calendar internal 403 pressure');
        return { status: WAF_PRESSURE_STATUS, reason: 'calendar_internal_403_x3' };
      } else {
        log('РІС™В РїС‘РЏ', `Р вЂ™Р Р…РЎС“РЎвЂљРЎР‚Р ВµР Р…Р Р…Р С‘Р в„– 403 Р С•РЎвЂљ API Р С”Р В°Р В»Р ВµР Р…Р Т‘Р В°РЎР‚РЎРЏ (${internal403Count}/3). Р РЋР В±РЎР‚Р С•РЎРѓ РЎРѓР ВµРЎРѓРЎРѓР С‘Р С‘, Р С•РЎРѓРЎвЂљР В°РЎвЂР СРЎРѓРЎРЏ Р Р…Р В° Р С—РЎР‚Р С•Р С”РЎРѓР С‘.`);
        clearCalendarPayloadCache(urlKey, 'calendar internal 403');
        return { status: 'error' };
      }
    }

    if (!resp || !resp.data) {
      const status = resp && resp.status ? resp.status : 'none';
      const snippet = resp && resp.responseSnippet ? resp.responseSnippet : 'empty';
      const staticReason = String(interceptedCalendars[urlKey + '_staticReason'] || '');
      if (
        status === 500
        && /waf|block/i.test(staticReason)
        && /failed to fetch|securityerror|access is denied|chrome-error|forbidden|blocked/i.test(snippet)
      ) {
        recordCalendarEvent('waf403');
        const requestDiag = formatCalendarRequestContext(resp && resp.requestContext);
        log('WARN', `[CALENDAR] fetch failed after static WAF payload reason=${staticReason} ${formatProxyContext(getPageProxyContext(page))}${requestDiag} -> cooldown proxy, rotate, next strict-grid cycle`);
        rotateProxyAfterCalendarWaf403('calendar_fetch_failed_after_page_waf', { fetchError: snippet, staticReason, requestContext: resp && resp.requestContext || null });
        clearCalendarPayloadCache(urlKey, 'calendar fetch failed after page waf');
        return { status: WAF_PRESSURE_STATUS, reason: 'calendar_fetch_failed_after_page_waf' };
      }
      log('WARN', `[CALENDAR] empty/unparseable calendar response month=${year}-${String(month).padStart(2, '0')} status=${status} snippet=${snippet}`);
      recordCalendarEvent('other_fail');
      clearCalendarPayloadCache(urlKey, `empty calendar response status=${status}`);
      log('РІСњРЉ', `Р С›РЎвЂљР Р†Р ВµРЎвЂљ Р С”Р В°Р В»Р ВµР Р…Р Т‘Р В°РЎР‚РЎРЏ Р С—РЎС“РЎРѓРЎвЂљ (${year}-${String(month).padStart(2,'0')}).`);
      return { status: 'error', reason: 'calendar_empty_response' };
    }

    const monthSlots = Array.isArray(resp.data) ? resp.data : Object.values(resp.data).flat();
    allSlots = allSlots.concat(monthSlots);

    if (monthsToCheck.length > 1) await new Promise(r => setTimeout(r, 800 + Math.random() * 700));
  }

  const slots = allSlots;
  const ticketStrategy = getTicketStrategy(target);
  const totalNeeded = ticketStrategy.maxTotalQty;
  const guideNeeded = ticketStrategy.guideQty;
  const paidNeeded = ticketStrategy.maxPaidQty;
  const minTotalNeeded = ticketStrategy.minTotalQty;
  const minPaidNeeded = ticketStrategy.minPaidQty;

  if (!slots || slots.length === 0) { log('СЂСџС™В«', `Р РЋР В»Р С•РЎвЂљР С•Р Р† Р Р…Р ВµРЎвЂљ.`); return { status: 'no_slots' }; }

  const candidateSlots = slots.filter(s => {
    if (s.soldout === true || s.sold_out === true) return false;
    if (!s.period_id || !s.startDateTime) return false;
    return true;
  });

  if (candidateSlots.length > 0) {
    const parseTime = (timeStr) => {
      if (!timeStr) return 0; let [time, mod] = timeStr.split(' '); let [h, m] = time.split(':').map(Number);
      if (mod === 'PM' && h !== 12) h += 12; if (mod === 'AM' && h === 12) h = 0; return h * 60 + m;
    };

    let startMin = 0, endMin = 1440;
    if (target.time_range) { startMin = parseTime(target.time_range.start); endMin = parseTime(target.time_range.end); }

    const matchesTargetWindow = (s, options = {}) => {
      const { ignoreAttempts = false, ignoreCapacity = false } = options;
      if (!s.startDateTime) return false;
      if (!ignoreAttempts) {
        const attemptState = slotAttempts[s.startDateTime];
        if (attemptState) {
          if (attemptState.attempts >= MAX_ATTEMPTS_PER_SLOT) {
            if (Date.now() - attemptState.lastAttempt < SLOT_COOLDOWN_MS) return false;
            else slotAttempts[s.startDateTime] = { attempts: 0, lastAttempt: 0 };
          }
        }
      }

      const d = new Date(s.startDateTime);
      const cap = getSlotCapacityValue(s);
      const slotRomeDateTime = formatRomeDateTime(d);
      const slotPlan = buildTicketPlan(target, cap);

      if (target.type === 'underground') {
        if (target.target_datetime_start || target.target_datetime_end) {
          if (target.target_datetime_start && slotRomeDateTime < target.target_datetime_start) return false;
          if (target.target_datetime_end && slotRomeDateTime > target.target_datetime_end) return false;
          return ignoreCapacity ? true : slotPlan.ok;
        }
        if (target.target_date || target.target_date_start) {
          const dateStringYMD = d.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).split(' ')[0];
          // Р СџР С•Р Т‘Р Т‘Р ВµРЎР‚Р В¶Р С”Р В° Р Т‘Р С‘Р В°Р С—Р В°Р В·Р С•Р Р…Р В° Р Т‘Р В°РЎвЂљ
          if (target.target_date_start && target.target_date_end) {
            if (dateStringYMD < target.target_date_start || dateStringYMD > target.target_date_end) return false;
          } else if (target.target_date) {
            if (dateStringYMD !== target.target_date) return false;
          }
          if (target.time_range) {
            const tStr = d.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
            const [h, m] = tStr.split(':').map(Number); const hm = (h === 24 ? 0 : h) * 60 + m;
            if (hm < startMin || hm > endMin) return false;
          }
          return ignoreCapacity ? true : slotPlan.ok;
        } else {
          const minDays = target.min_days_ahead || 14; const today = new Date(); today.setHours(0, 0, 0, 0);
          const minDate = new Date(today.getTime() + minDays * 86400000);
          return d >= minDate && (ignoreCapacity ? true : slotPlan.ok);
        }
      }

      if (target.target_datetime_start || target.target_datetime_end) {
        if (target.target_datetime_start && slotRomeDateTime < target.target_datetime_start) return false;
        if (target.target_datetime_end && slotRomeDateTime > target.target_datetime_end) return false;
        return ignoreCapacity ? true : slotPlan.ok;
      }

      const dateStringYMD = d.toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).split(' ')[0];
      // Р СџР С•Р Т‘Р Т‘Р ВµРЎР‚Р В¶Р С”Р В° Р Т‘Р С‘Р В°Р С—Р В°Р В·Р С•Р Р…Р В° Р Т‘Р В°РЎвЂљ
      if (target.target_date_start && target.target_date_end) {
        if (dateStringYMD < target.target_date_start || dateStringYMD > target.target_date_end) return false;
      } else if (target.target_date && dateStringYMD !== target.target_date) return false;
      const timeString = d.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false });
      const [rHour, rMin] = timeString.split(':').map(Number);
      const hm = (rHour === 24 ? 0 : rHour) * 60 + rMin;
      return hm >= startMin && hm <= endMin && (ignoreCapacity ? true : slotPlan.ok);
    };

    const originalSupplySignals = slots.filter(s => {
      if (!s.period_id || !s.startDateTime) return false;
      if (!matchesTargetWindow(s, { ignoreAttempts: true, ignoreCapacity: true })) return false;
      const capacity = getSlotCapacityValue(s, '0');
      const originalCapacity = getSlotOriginalCapacityValue(s, null);
      return originalCapacity !== null && originalCapacity > 0 && capacity <= 0;
    });

    const loggedOriginalSignals = originalSupplySignals.filter(s => shouldLogSupplySignal(s, 'originalCapacity'));

    if (loggedOriginalSignals.length > 0) {
      for (const s of loggedOriginalSignals.slice(0, 3)) {
        log('SUPPLY', `[CAPACITY] release signal only: slot=${s.startDateTime}, ${formatSlotCapacityMeta(s)}; scheduler=log_only`);
      }
    }

    const positiveCapacitySignals = candidateSlots.filter(s => {
      if (!matchesTargetWindow(s, { ignoreAttempts: true, ignoreCapacity: true })) return false;
      return getSlotCapacityValue(s, '0') > 0;
    });

    const loggedCapacitySignals = positiveCapacitySignals.filter(s => shouldLogSupplySignal(s, 'capacity'));

    if (loggedCapacitySignals.length > 0) {
      for (const s of loggedCapacitySignals.slice(0, 3)) {
        log('SUPPLY', `[CAPACITY] positive signal: slot=${s.startDateTime}, ${formatSlotCapacityMeta(s)}; scheduler=log_only`);
      }
    }

    armSupplySignalBaseline();

    const validSlots = candidateSlots
      .filter(s => matchesTargetWindow(s))
      .map(s => {
        const bookingPlan = buildTicketPlan(target, getSlotCapacityValue(s, '0'));
        return bookingPlan.ok ? { ...s, bookingPlan } : null;
      })
      .filter(Boolean);

    const insufficientSlots = candidateSlots.filter(s => {
      if (!matchesTargetWindow(s, { ignoreAttempts: true, ignoreCapacity: true })) return false;
      const cap = getSlotCapacityValue(s, '0');
      return cap > 0 && !buildTicketPlan(target, cap).ok;
    });

    const outsideWindowSlots = candidateSlots.filter(s => {
      if (matchesTargetWindow(s, { ignoreAttempts: true, ignoreCapacity: true })) return false;
      const cap = getSlotCapacityValue(s, '0');
      return buildTicketPlan(target, cap).ok;
    });

    if (insufficientSlots.length > 0) {
      for (const s of insufficientSlots.slice(0, 3)) {
        const cap = getSlotCapacityValue(s, '0');
        log('SUPPLY', `[CAPACITY] insufficient slot=${s.startDateTime}, ${formatSlotCapacityMeta(s)}, need=${totalNeeded}, min=${minTotalNeeded}`);
        log('Р Р†РІР‚С›РІвЂћвЂ“Р С—РЎвЂР РЏ', `[RANGE] Р В РЎС™Р В РЎвЂР В Р вЂ¦Р В РЎвЂР В РЎВР РЋРЎвЂњР В РЎВ ${minTotalNeeded} (${minPaidNeeded} + ${guideNeeded}), Р В РЎВР В Р’В°Р В РЎвЂќР РЋР С“Р В РЎвЂР В РЎВР РЋРЎвЂњР В РЎВ ${totalNeeded} (${paidNeeded} + ${guideNeeded})`);
        log('РІС™В РїС‘РЏ', `Р РЋР В»Р С•РЎвЂљ ${s.startDateTime}: Р ВµРЎРѓРЎвЂљРЎРЉ ${cap} Р СР ВµРЎРѓРЎвЂљ Р Р† Р С•Р С”Р Р…Р Вµ, Р Р…РЎС“Р В¶Р Р…Р С• ${totalNeeded} (${paidNeeded} Р С—Р В»Р В°РЎвЂљР Р…РЎвЂ№РЎвЂ¦ + ${guideNeeded} Р С–Р С‘Р Т‘) РІР‚вЂќ Р Р…Р Вµ Р С—РЎвЂ№РЎвЂљР В°Р ВµР СРЎРѓРЎРЏ`);
      }
    }

    if (validSlots.length === 0 && outsideWindowSlots.length > 0) {
      for (const s of outsideWindowSlots.slice(0, 3)) {
        const cap = getSlotCapacityValue(s, '0');
        const plan = buildTicketPlan(target, cap);
        const slotRomeDateTime = formatRomeDateTime(new Date(s.startDateTime));
        log('Р Р†РІР‚С›РІвЂћвЂ“Р С—РЎвЂР РЏ', `[RANGE] Р В РІР‚в„ўР В Р вЂ¦Р В Р’Вµ Р В РЎвЂўР В РЎвЂќР В Р вЂ¦Р В Р’В° Р В РЎВР В РЎвЂўР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р В Р вЂ Р В Р’В·Р РЋР РЏР РЋРІР‚С™Р РЋР Р‰ ${plan.ticketInfo}`);
        log('СЂСџвЂўвЂ™', `Р РЋР В»Р С•РЎвЂљ Р Р†Р Р…Р Вµ Р С•Р С”Р Р…Р В°: ${s.startDateTime} (${slotRomeDateTime} Europe/Rome), Р СР ВµРЎРѓРЎвЂљ ${cap}. Р СћР ВµР С”РЎС“РЎвЂ°Р ВµР Вµ Р С•Р С”Р Р…Р С•: ${formatTargetWindowForLog(target)}`);
      }
    }

    if (validSlots.length > 0) {
      const bestCap = getSlotCapacityValue(validSlots[0], '?');
      const bestPlan = validSlots[0].bookingPlan;
      log('SUPPLY', `[CAPACITY] actionable slot=${validSlots[0].startDateTime}, ${formatSlotCapacityMeta(validSlots[0])}, plan=${bestPlan ? bestPlan.ticketInfo : 'n/a'}`);
      log('СЂСџР‹СџРїС‘РЏ', `Р СњР В°Р в„–Р Т‘Р ВµР Р…Р С• ${validSlots.length} Р С—Р С•Р Т‘РЎвЂ¦Р С•Р Т‘РЎРЏРЎвЂ°Р С‘РЎвЂ¦ РЎРѓР В»Р С•РЎвЂљР С•Р Р†! Р вЂєРЎС“РЎвЂЎРЎв‚¬Р С‘Р в„–: ${validSlots[0].startDateTime} (Р Р†Р СР ВµРЎРѓРЎвЂљР С‘Р СР С•РЎРѓРЎвЂљРЎРЉ: ${bestCap}, Р Р…РЎС“Р В¶Р Р…Р С•: ${totalNeeded})`);
      if (bestPlan) {
        log('РЎР‚РЎСџР вЂ№Р’В«', `[RANGE] Р В РІР‚в„ў Р РЋР РЉР РЋРІР‚С™Р В РЎвЂўР РЋРІР‚С™ Р РЋР С“Р В Р’В»Р В РЎвЂўР РЋРІР‚С™ Р В Р’В±Р В Р’ВµР РЋР вЂљР В Р’ВµР В РЎВ ${bestPlan.ticketInfo}`);
      }
      reportProxyLeaseEvent('calendar_ok', 'calendar_available');
      return { status: 'available', slots: validSlots, bestSlot: validSlots[0] };
    }
  }

  log('РІвЂћв„–РїС‘РЏ', `Р вЂ”Р В° Р Р…Р В°РЎв‚¬ Р С—РЎР‚Р С•Р СР ВµР В¶РЎС“РЎвЂљР С•Р С” Р Р†РЎР‚Р ВµР СР ВµР Р…Р С‘ Р В±Р С‘Р В»Р ВµРЎвЂљР С•Р Р† Р Р…Р ВµРЎвЂљ.`);
  reportProxyLeaseEvent('calendar_ok', 'calendar_unavailable');
  return { status: 'unavailable' };
}
async function addToCart(page, slot, target, payload) {
  log('СЂСџвЂєвЂ™', `API Р вЂ”Р В°Р С—РЎР‚Р С•РЎРѓ РЎвЂљР В°РЎР‚Р С‘РЎвЂћР С•Р Р† Р Т‘Р В»РЎРЏ ${slot.startDateTime}...`);
  logProxyContext('tariffs_prepare', page, `slot=${slot.startDateTime} targetType=${target?.type || 'unknown'}`);
  const urlKey = target.url.split('?')[0];
  const slotCapacity = getSlotCapacityValue(slot, '0');
  const bookingPlan = slot.bookingPlan || buildTicketPlan(target, slotCapacity);

  if (!bookingPlan.ok) {
    log('WARN', `Slot ${slot.startDateTime} no longer fits booking range (capacity ${slotCapacity}, min ${bookingPlan.minTotalQty})`);
    return false;
  }

  log('PLAN', `[RANGE] Slot ${slot.startDateTime}: ${bookingPlan.ticketInfo}`);
  const pageMatch = payload ? payload.match(/page=(\d+)/) : null;
  let pageId = pageMatch ? pageMatch[1] : '';
  if (!pageId) {
    pageId = await getPageIdFromDom(page);
  }

  await performWarmup(page);
  let preTariffDelay = 0;
  log('РІРЏС–', `(Behavioral) Р вЂ“Р Т‘Р ВµР С ${(preTariffDelay / 1000).toFixed(1)}РЎРѓ Р С—Р ВµРЎР‚Р ВµР Т‘ /tariffs...`);
  await sleep(preTariffDelay);
  logProxyContext('tariffs_api', page, `slot=${slot.startDateTime}`);

  // 1. Р вЂќР С•Р В±Р В°Р Р†Р В»Р ВµР Р…РЎвЂ№ Р В°Р Р…РЎвЂљР С‘-CSRF Р В·Р В°Р С–Р С•Р В»Р С•Р Р†Р С”Р С‘ Origin Р С‘ Referer Р Т‘Р В»РЎРЏ Р С—РЎР‚Р С•РЎвЂ¦Р С•Р Т‘Р В° WAF
  const tariffsResponse = await page.evaluate(async (pId, sTime) => {
    const pData = `action=midaabc_tariffs&period_id=${encodeURIComponent(pId)}&start_time=${encodeURIComponent(sTime)}`;
    try {
      const res = await fetch('/mtajax/tariffs', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Origin': window.location.origin,
          'Referer': window.location.href
        },
        body: pData
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { }
      const textLower = text.toLowerCase();
      const isWaf = res.status === 403 && (textLower.includes('cloudflare') || textLower.includes('octofence') || textLower.includes('cf-ray') || textLower.includes('block_style'));
      return { status: res.status, data, isWaf, responseSnippet: (res.status !== 200 || !data) ? text.substring(0, 300) : '' };
    } catch (e) {
      return { status: 500, data: null, isWaf: false, responseSnippet: String(e && e.message || e).substring(0, 300) };
    }
  }, slot.period_id, slot.startDateTime).catch(e => null);

  if (!tariffsResponse) {
    log('WARN', '[CART] tariffs request failed before addtocart -> recreate browser next cycle');
    return { status: 'error', reason: 'tariffs_request_failed' };
  }
  if (tariffsResponse.status === 429) {
    log('WARN', `[CART] tariffs 429 ${formatProxyContext(getPageProxyContext(page))} -> rotate proxy, no local proxy ban, next strict-grid cycle`);
    rotateProxyAfterWafPressure('tariffs_429');
    return { status: WAF_PRESSURE_STATUS, reason: 'tariffs_429' };
  }
  if (tariffsResponse.status === 403 && tariffsResponse.isWaf) {
    if (tariffsResponse.responseSnippet) log('РЎР‚РЎСџРІР‚СљРІР‚С›', `403 Tariffs body: ${tariffsResponse.responseSnippet.substring(0, 200)}`);
    log('WARN', `[CART] WAF 403 on tariffs ${formatProxyContext(getPageProxyContext(page))} -> rotate proxy, no local proxy ban, next strict-grid cycle`);
    rotateProxyAfterWafPressure('tariffs_waf_403');
    return { status: WAF_PRESSURE_STATUS, reason: 'tariffs_waf_403' };
  }

  const tariffsPayload = tariffsResponse.data;
  if (!tariffsPayload || !tariffsPayload.data) {
    log('РІСњРЉ', 'API Р СћР В°РЎР‚Р С‘РЎвЂћР С•Р Р† Р Р…Р Вµ Р Р†Р ВµРЎР‚Р Р…РЎС“Р В» Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ (Р Р†Р С•Р В·Р СР С•Р В¶Р Р…Р С• РЎРѓР В»Р С•РЎвЂљ РЎС“Р В¶Р Вµ РЎС“РЎв‚¬Р ВµР В»).');
    return false;
  }

  const allTariffs = Array.isArray(tariffsPayload.data) ? tariffsPayload.data : Object.values(tariffsPayload.data).flat();

  const availableLabels = allTariffs.map(t => t.label || t.Label).join(' | ');
  log('СЂСџвЂњвЂ№', `Р вЂќР С•РЎРѓРЎвЂљРЎС“Р С—Р Р…РЎвЂ№Р Вµ РЎвЂљР В°РЎР‚Р С‘РЎвЂћРЎвЂ№ API: ${availableLabels}`);

  const itemsToCart = [];
  const missingTariffs = [];
  for (const ticket of bookingPlan.tickets) {
    if (!ticket.quantity || ticket.quantity <= 0) continue;

    const configuredObjectGuid = ticket.object_guid || ticket.objectGuid || ticket.guid || null;
    if (configuredObjectGuid) {
      itemsToCart.push({
        object_guid: configuredObjectGuid,
        object_tablename: ticket.object_tablename || ticket.objectTablename || 'packetTypes',
        quantity: ticket.quantity,
        label: ticket.label,
        matchedLabel: ticket.label,
        isAdult: isAdultTicketLabel(ticket.label),
        isChild: isChildTicketLabel(ticket.label),
        isGuide: isGuideTicketLabel(ticket.label)
      });
      continue;
    }

    const t = findTariffForTicket(allTariffs, ticket.label);
    if (!t || !t.object_guid) {
      missingTariffs.push(ticket.label);
      log('WARN', `[CART] tariff not found requested="${ticket.label}" available="${availableLabels}"`);
      continue;
    }

    itemsToCart.push({
      object_guid: t.object_guid,
      object_tablename: getTariffObjectTablename(t),
      quantity: ticket.quantity,
      label: ticket.label,
      matchedLabel: getTariffLabel(t),
      isAdult: isAdultTicketLabel(ticket.label),
      isChild: isChildTicketLabel(ticket.label),
      isGuide: isGuideTicketLabel(ticket.label)
    });
  }

  if (missingTariffs.length > 0) {
    log('WARN', `[CART] required tariffs missing: ${missingTariffs.join(', ')}; available=${availableLabels}`);
    return { success: false, status: 'tariff_missing', missingTariffs, bookingPlan, ticketInfo: bookingPlan.ticketInfo };
  }

  if (itemsToCart.length === 0) return false;

  log('  ', `API POST /addtocart: ` + itemsToCart.map(i => `${i.quantity}x "${i.label}"`).join(' + '));

  await performWarmup(page);

  const isUnderground = target.type === 'underground';

  // Р вЂ”Р В°Р Т‘Р ВµРЎР‚Р В¶Р С”Р В° 1.5 - 3.5 РЎРѓР ВµР С”РЎС“Р Р…Р Т‘РЎвЂ№ Р С—Р ВµРЎР‚Р ВµР Т‘ Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р С•Р в„–
  let preCartDelay = 50 + Math.random() * 100;
  log('РІС™РЋ', `(Р РЋР Р…Р В°Р в„–Р С—Р ВµРЎР‚) Р вЂ™Р Р†Р С•Р Т‘Р С‘Р С Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ Р С‘ Р В¶Р Т‘Р ВµР С ${(preCartDelay / 1000).toFixed(1)}РЎРѓ Р С—Р ВµРЎР‚Р ВµР Т‘ /addtocart...`);
  await sleep(preCartDelay);
  logProxyContext('addtocart_api', page, `slot=${slot.startDateTime}`);

  const cartRes = await page.evaluate(async (pId, sTime, eTime, pageId, items, underground) => {

    // Р вЂ™РЎРѓР С—Р С•Р СР С•Р С–Р В°РЎвЂљР ВµР В»РЎРЉР Р…Р В°РЎРЏ РЎвЂћРЎС“Р Р…Р С”РЎвЂ Р С‘РЎРЏ РЎРѓ РЎС“Р СР Р…РЎвЂ№Р С Р С•Р С—РЎР‚Р ВµР Т‘Р ВµР В»Р ВµР Р…Р С‘Р ВµР С WAF (РЎвЂЎР С‘РЎвЂљР В°Р ВµРЎвЂљ РЎвЂљР ВµР С”РЎРѓРЎвЂљ Р С•РЎвЂљР Р†Р ВµРЎвЂљР В°)
    async function executeCartFetch(bodyParts) {
      try {
        const res = await fetch('/mtajax/addtocart', {
          method: 'POST', credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'Origin': window.location.origin,
            'Referer': window.location.href
          },
          body: bodyParts.join('&')
        });

        // Р В§Р С‘РЎвЂљР В°Р ВµР С РЎвЂљР ВµР С”РЎРѓРЎвЂљ Р С•РЎвЂљР Р†Р ВµРЎвЂљР В°, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р Т‘Р С•Р С”Р В°Р В·Р В°РЎвЂљРЎРЉ: РЎРЊРЎвЂљР С• WAF Р С‘Р В»Р С‘ Р С—РЎР‚Р С•РЎРѓРЎвЂљР С• Р С•РЎв‚¬Р С‘Р В±Р С”Р В° Р СљР С‘Р Т‘РЎвЂ№?
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { }

        const textLower = text.toLowerCase();
        const isWaf = res.status === 403 && (textLower.includes('cloudflare') || textLower.includes('octofence') || textLower.includes('cf-ray'));

        return { status: res.status, data, isWaf, responseSnippet: res.status !== 200 ? text.substring(0, 300) : '' };
      } catch (e) { return { status: 500, data: null, isWaf: false, responseSnippet: '' }; }
    }

    async function postAllItemsUnderground(allItems) {
      // Р СџР С•Р В»РЎС“РЎвЂЎР В°Р ВµР С Р В°Р С”РЎвЂљРЎС“Р В°Р В»РЎРЉР Р…РЎвЂ№Р в„– page-id Р С‘Р В· DOM, Р В° Р Р…Р Вµ Р С‘Р В· Р С—Р ВµРЎР‚Р ВµРЎвЂ¦Р Р†Р В°РЎвЂЎР ВµР Р…Р Р…Р С•Р С–Р С• API
      let actualPageId = '0';
      const meta = document.querySelector('meta[name="page-id"]');
      if (meta) actualPageId = meta.content;
      else {
        const bodyId = document.body?.dataset?.pageId;
        if (bodyId) actualPageId = bodyId;
        else {
          const match = document.body?.innerHTML?.match(/page["\s]*[:=]\s*["']?(\d+)/i);
          if (match) actualPageId = match[1];
        }
      }

      let bodyParts = [`action=midaabc_addtocart`];
      for (let i = 0; i < allItems.length; i++) {
        const item = allItems[i];
        const p = `items%5B${i}%5D`;
        if (item.is_entrance) {
          // Entrance (activities) - РЎвЂљР С•РЎвЂЎР Р…Р С• Р С—Р С• РЎРѓР С”РЎР‚Р С‘Р Р…РЎв‚¬Р С•РЎвЂљРЎС“: РЎвЂљР С•Р В»РЎРЉР С”Р С• Р Р…РЎС“Р В¶Р Р…РЎвЂ№Р Вµ Р С—Р С•Р В»РЎРЏ, Р В±Р ВµР В· Р С—РЎС“РЎРѓРЎвЂљРЎвЂ№РЎвЂ¦
          bodyParts.push(`${p}%5Bperiod_id%5D=${encodeURIComponent(pId)}`);
          bodyParts.push(`${p}%5Bstart_time%5D=${encodeURIComponent(sTime)}`);
          bodyParts.push(`${p}%5Bend_time%5D=${encodeURIComponent(eTime)}`);
          bodyParts.push(`${p}%5Bobject_guid%5D=${encodeURIComponent(item.object_guid)}`);
          bodyParts.push(`${p}%5Bobject_tablename%5D=${encodeURIComponent(item.object_tablename)}`);
          bodyParts.push(`${p}%5Bquantity%5D=${item.quantity}`);
        } else {
          // Tickets (packetTypes) - РЎвЂљР С•РЎвЂЎР Р…Р С• Р С—Р С• РЎРѓР С”РЎР‚Р С‘Р Р…РЎв‚¬Р С•РЎвЂљРЎС“: РЎвЂљР С•Р В»РЎРЉР С”Р С• Р Р…РЎС“Р В¶Р Р…РЎвЂ№Р Вµ Р С—Р С•Р В»РЎРЏ, Р В±Р ВµР В· Р С—РЎС“РЎРѓРЎвЂљРЎвЂ№РЎвЂ¦
          bodyParts.push(`${p}%5Bdetail_guid%5D=_draft_0`);
          bodyParts.push(`${p}%5Bperiod_id%5D=${encodeURIComponent(pId)}`);
          bodyParts.push(`${p}%5Bstart_time%5D=${encodeURIComponent(sTime)}`);
          bodyParts.push(`${p}%5Bend_time%5D=${encodeURIComponent(eTime)}`);
          bodyParts.push(`${p}%5Bobject_guid%5D=${encodeURIComponent(item.object_guid)}`);
          bodyParts.push(`${p}%5Bobject_tablename%5D=${encodeURIComponent(item.object_tablename)}`);
          bodyParts.push(`${p}%5Bquantity%5D=${item.quantity}`);
          bodyParts.push(`${p}%5BactivityPerPerson%5D=true`);
        }
      }
      bodyParts.push(`page=${actualPageId || pageId}`);
      return await executeCartFetch(bodyParts);
    }

    async function postOneItem(item, index) {
      let bodyParts = [
        `action=midaabc_addtocart`,
        `items%5B0%5D%5Bdetail_guid%5D=_draft_0`,
        `items%5B0%5D%5Bperiod_id%5D=${encodeURIComponent(pId)}`,
        `items%5B0%5D%5Bstart_time%5D=${encodeURIComponent(sTime)}`,
        `items%5B0%5D%5Bend_time%5D=${encodeURIComponent(eTime)}`,
        `items%5B0%5D%5Bobject_guid%5D=${encodeURIComponent(item.object_guid)}`,
        `items%5B0%5D%5Bobject_tablename%5D=${encodeURIComponent(item.object_tablename)}`,
        `items%5B0%5D%5Bquantity%5D=${item.quantity}`
      ];
      if (item.isChild) {
        bodyParts.push(`items%5B0%5D%5BactivityPerPerson%5D=true`);
      }
      bodyParts.push(
        `items%5B0%5D%5Bconvention_guid%5D=`,
        `items%5B0%5D%5Bconvention_text%5D=`,
        `items%5B0%5D%5Bgroup_guid%5D=`,
        `page=${pageId}`
      );
      return await executeCartFetch(bodyParts);
    }

    let lastRes = null;
    let firstItemDetailGuid = null;  // detail_guid Р С—Р ВµРЎР‚Р Р†Р С•Р С–Р С• РЎРЊР В»Р ВµР СР ВµР Р…РЎвЂљР В° (Intero)
    let allItemDetailGuids = [];
    if (underground) {
      lastRes = await postAllItemsUnderground(items);
      if (lastRes && lastRes.data && lastRes.data.data && Array.isArray(lastRes.data.data.items)) {
        allItemDetailGuids = lastRes.data.data.items.filter(Boolean);
      }
    } else {
      for (let i = 0; i < items.length; i++) {
        if (i > 0) {
          await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
        }
        lastRes = await postOneItem(items[i], i);
        if (lastRes && lastRes.data && lastRes.data.data && Array.isArray(lastRes.data.data.items)) {
          allItemDetailGuids.push(...lastRes.data.data.items.filter(Boolean));
        }
        // Р вЂ”Р В°РЎвЂ¦Р Р†Р В°РЎвЂљРЎвЂ№Р Р†Р В°Р ВµР С detail_guid Р С—Р ВµРЎР‚Р Р†Р С•Р С–Р С• РЎРЊР В»Р ВµР СР ВµР Р…РЎвЂљР В° (Intero)
        if (i === 0 && lastRes && lastRes.data && lastRes.data.data && lastRes.data.data.items) {
          firstItemDetailGuid = lastRes.data.data.items[0] || null;
        }
        if (!lastRes || lastRes.status !== 200 || !lastRes.data || lastRes.data.success !== true) {
          return lastRes || { status: 500, data: null, isWaf: false };
        }
      }
    }

    // Р СџРЎР‚Р С‘Р С”РЎР‚Р ВµР С—Р В»РЎРЏР ВµР С Intero detail_guid Р С” Р С•РЎвЂљР Р†Р ВµРЎвЂљРЎС“
    if (lastRes && firstItemDetailGuid) {
      lastRes.interoDetailGuid = firstItemDetailGuid;
    }
    if (lastRes && allItemDetailGuids.length > 0) {
      lastRes.allDetailGuids = allItemDetailGuids;
    }

    return lastRes;
  }, slot.period_id, slot.startDateTime, slot.endDateTime || slot.startDateTime, pageId, itemsToCart, isUnderground).catch(e => ({ status: 500, data: null, isWaf: false, responseSnippet: '' }));

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р Р€Р РЋР СџР вЂўР Тђ: РЎРѓР В±РЎР‚Р В°РЎРѓРЎвЂ№Р Р†Р В°Р ВµР С РЎвЂћР В»Р В°Р С–Р С‘ Р С—РЎР‚Р С‘ РЎС“РЎРѓР С—Р ВµРЎв‚¬Р Р…Р С•Р С Р В·Р В°Р С—РЎР‚Р С•РЎРѓР Вµ Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎС“ РІвЂўС’РІвЂўС’РІвЂўС’
  if (cartRes && cartRes.status === 200 && cartRes.data && cartRes.data.success === true) {
    hadRateLimit429 = false;
    consecutive403Count = 0;
    internal403Count = 0;
  }

  // РІвЂўС’РІвЂўС’РІвЂўС’ Handling Rate Limit (429) РІвЂўС’РІвЂўС’РІвЂўС’
  if (cartRes && cartRes.status === 429) {
    hadRateLimit429 = true;
    consecutive403Count = 0;
    reportProxyLeaseEvent('cart_pressure', 'addtocart_429', { httpCode: 429 });
    if (isCurrentProxyBanned()) {
      clearProxyBan(currentProxyIndex);
      log('СЂСџР‹вЂ°', `Р вЂР В°Р Р… Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex} Р РЋР вЂєР вЂўР СћР вЂўР вЂє! Р СџР С•Р В»РЎС“РЎвЂЎР ВµР Р… 429. Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµР СРЎРѓРЎРЏ Р Р† РЎРѓРЎвЂљРЎР‚Р С•Р в„–.`);
    }
    log('СЂСџвЂќвЂ', `429 Р С•РЎвЂљ Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎвЂ№. Р СџРЎР‚Р С•Р С—РЎС“РЎРѓР С”Р В°Р ВµР С, РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р С‘Р в„– РЎвЂ Р С‘Р С”Р В» strict_grid.`);
    rotateProxyAfterWafPressure('cart_429');
    return { status: WAF_PRESSURE_STATUS, reason: 'cart_429' };
  }

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р Р€Р СљР СњР С’Р Р‡ Р С›Р вЂР В Р С’Р вЂР С›Р СћР С™Р С’ 403 Р СњР С’ Р С™Р С›Р В Р вЂ”Р ВР СњР вЂў РІвЂўС’РІвЂўС’РІвЂўС’
  if (cartRes && cartRes.status === 403) {
    if (cartRes.responseSnippet) log('СЂСџвЂњвЂћ', `403 Cart body: ${cartRes.responseSnippet.substring(0, 200)}`);
    if (cartRes.isWaf) {
      const reason = hadRateLimit429 ? 'cart_waf_403_after_429' : 'cart_waf_403';
      log('WARN', `[CART] WAF 403 on addtocart ${formatProxyContext(getPageProxyContext(page))} -> rotate proxy, no proxy ban, next strict-grid cycle`);
      rotateProxyAfterWafPressure(reason);
      if (slot && slot.startDateTime) {
        if (!slotAttempts[slot.startDateTime]) slotAttempts[slot.startDateTime] = { attempts: 0, lastAttempt: 0 };
        slotAttempts[slot.startDateTime].attempts = MAX_ATTEMPTS_PER_SLOT;
        slotAttempts[slot.startDateTime].lastAttempt = Date.now();
      }
      return { status: WAF_PRESSURE_STATUS, reason };
    } else {
      // Р вЂ™Р Р…РЎС“РЎвЂљРЎР‚Р ВµР Р…Р Р…Р С‘Р в„– 403 (Р СњР вЂў WAF) РІР‚вЂќ 3-strike РЎРѓР С‘РЎРѓРЎвЂљР ВµР СР В°
      internal403Count++;
      if (internal403Count >= 3) {
        log('WARN', `[CART] Internal 403 x${internal403Count} on proxy #${currentProxyIndex} -> rotate proxy, no proxy ban, next strict-grid cycle`);
        internal403Count = 0;
        rotateProxyAfterWafPressure('cart_internal_403_x3');
        if (slot && slot.startDateTime) {
          if (!slotAttempts[slot.startDateTime]) slotAttempts[slot.startDateTime] = { attempts: 0, lastAttempt: 0 };
          slotAttempts[slot.startDateTime].attempts = MAX_ATTEMPTS_PER_SLOT;
          slotAttempts[slot.startDateTime].lastAttempt = Date.now();
        }
        delete interceptedCalendars[urlKey];
        return { status: WAF_PRESSURE_STATUS, reason: 'cart_internal_403_x3' };
      } else {
        log('СЂСџвЂќвЂћ', `Р вЂ™Р Р…РЎС“РЎвЂљРЎР‚Р ВµР Р…Р Р…Р С‘Р в„– 403 Р Р…Р В° Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ (#${internal403Count}/3). Р РЋР В±РЎР‚Р С•РЎРѓ РЎРѓР ВµРЎРѓРЎРѓР С‘Р С‘, Р С•РЎРѓРЎвЂљР В°РЎвЂР СРЎРѓРЎРЏ Р Р…Р В° Р С—РЎР‚Р С•Р С”РЎРѓР С‘.`);

        // Р вЂР В»Р С•Р С”Р С‘РЎР‚РЎС“Р ВµР С РЎРѓР В»Р С•РЎвЂљ Р В»Р С•Р С”Р В°Р В»РЎРЉР Р…Р С•
        if (slot && slot.startDateTime) {
          if (!slotAttempts[slot.startDateTime]) slotAttempts[slot.startDateTime] = { attempts: 0, lastAttempt: 0 };
          slotAttempts[slot.startDateTime].attempts = MAX_ATTEMPTS_PER_SLOT;
          slotAttempts[slot.startDateTime].lastAttempt = Date.now();
        }

        delete interceptedCalendars[urlKey];
        return false;
      }
    }
  }

  // РІвЂўС’РІвЂўС’РІвЂўС’ Lock cart РІвЂўС’РІвЂўС’РІвЂўС’
  if (cartRes && cartRes.data && cartRes.data.success === true) {
    await page.evaluate(async (pgId) => {
      for (let i = 0; i < 3; i++) {
        const lockRes = await fetch('/mtajax/check_cart', {
          method: 'POST', credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': window.location.origin,
            'Referer': window.location.href
          },
          body: `action=midaabc_check_cart&lock=true&page=${pgId}`
        }).catch(() => null);
        if (lockRes && lockRes.status === 200) { console.log('СЂСџвЂќвЂ™ Р С™Р С•РЎР‚Р В·Р С‘Р Р…Р В° Р В·Р В°Р В±Р В»Р С•Р С”Р С‘РЎР‚Р С•Р Р†Р В°Р Р…Р В°!'); break; }
        await new Promise(r => setTimeout(r, 2000));
      }
    }, pageId).catch(() => { });
  }

  log('СЂСџвЂќР‹', `addtocart raw: status=${cartRes ? cartRes.status : '?'} success=${cartRes && cartRes.data ? cartRes.data.success : '?'} isWaf=${cartRes ? cartRes.isWaf : 'false'}`);
  // Р вЂєР С•Р С–Р С‘РЎР‚РЎС“Р ВµР С РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ Р С•Р В± Р С•РЎв‚¬Р С‘Р В±Р С”Р Вµ Р С•РЎвЂљ Р СљР С‘Р Т‘РЎвЂ№ Р С—РЎР‚Р С‘ success=false
  if (cartRes && cartRes.data && cartRes.data.success === false) {
    const errMsg = cartRes.data.message || cartRes.data.error || cartRes.data.msg || JSON.stringify(cartRes.data).substring(0, 200);
    log('РІСњРЉ', `Mida error: ${errMsg}`);
  }
  // РІвЂўС’РІвЂўС’РІвЂўС’ Р Р€Р РЋР СџР вЂўР Тђ РІР‚вЂќ Р Р†Р ВµРЎР‚Р С‘РЎвЂћР С‘Р С”Р В°РЎвЂ Р С‘РЎРЏ Р С—Р С• API Р С•РЎвЂљР Р†Р ВµРЎвЂљРЎС“ РІвЂўС’РІвЂўС’РІвЂўС’
  if (cartRes && cartRes.data && cartRes.data.success === true) {
    const itemUuids = cartRes.data.data?.items;
    const isRealBackend = Array.isArray(itemUuids) && itemUuids.length > 0;

    if (isRealBackend) {
      log('РІСљвЂ¦', `Р В Р вЂўР С’Р вЂєР В¬Р СњР В«Р в„ў Р Р€Р РЋР СџР вЂўР Тђ (UUID Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ: ${itemUuids[0]})`);
    } else {
      log('РІС™В РїС‘РЏ', `success=true Р Р…Р С• items UUID Р С•РЎвЂљРЎРѓРЎС“РЎвЂљРЎРѓРЎвЂљР Р†РЎС“Р ВµРЎвЂљ РІР‚вЂќ РЎРѓРЎвЂЎР С‘РЎвЂљР В°Р ВµР С РЎС“РЎРѓР С—Р ВµРЎвЂ¦Р С•Р С, РЎРѓР ВµРЎРѓРЎРѓР С‘РЎР‹ Р Р…Р Вµ Р С—Р С•Р Р†РЎвЂљР С•РЎР‚РЎРЏР ВµР С.`);
    }

    // РІвЂўС’РІвЂўС’РІвЂўС’ Р РЋР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎРЏР ВµР С cart items info Р Т‘Р В»РЎРЏ editcart РІвЂўС’РІвЂўС’РІвЂўС’
    try {
      const cartData = cartRes.data.data;
      const composition = getTicketCompositionFromTickets(bookingPlan.tickets);
      const orderedDetailGuids = (Array.isArray(cartRes.allDetailGuids) && cartRes.allDetailGuids.length > 0)
        ? cartRes.allDetailGuids.filter(Boolean)
        : (Array.isArray(itemUuids) ? itemUuids.filter(Boolean) : []);
      const adultItem = itemsToCart.find(i => i.isAdult);
      const childItem = itemsToCart.find(i => i.isChild);
      const guideItem = itemsToCart.find(i => i.isGuide);
      const adultDetailGuids = orderedDetailGuids.slice(0, composition.adults);
      const childDetailGuids = orderedDetailGuids.slice(composition.adults, composition.adults + composition.children);
      const guideDetailGuids = orderedDetailGuids.slice(
        composition.adults + composition.children,
        composition.adults + composition.children + Math.max(0, composition.guide || 0)
      );
      const nextCartItemsInfo = {
        interoDetailGuid: adultDetailGuids[0] || cartRes.interoDetailGuid || null,
        interoObjectGuid: adultItem?.object_guid || null,
        interoQty: composition.adults,
        adultQty: composition.adults,
        childQty: composition.children,
        guideQty: Math.max(0, composition.guide || 0),
        adultDetailGuids,
        childDetailGuids,
        guideDetailGuids,
        guideDetailGuid: guideDetailGuids[0] || null,
        childObjectGuid: childItem?.object_guid || null,
        childObjectTablename: childItem?.object_tablename || null,
        guideObjectGuid: guideItem?.object_guid || null,
        detailGuids: orderedDetailGuids,
        cartUuid: isRealBackend ? orderedDetailGuids[0] || itemUuids[0] : null,
        savedAt: new Date().toISOString()
      };
      if (cartData && cartData.details && Array.isArray(cartData.details)) {
        for (const detail of cartData.details) {
          const label = detail.label || detail.tariff_label || detail.name || '';
          if (isAdultTicketLabel(label)) {
            nextCartItemsInfo.interoDetailGuid = nextCartItemsInfo.interoDetailGuid || detail.detail_guid || detail.guid;
            nextCartItemsInfo.interoObjectGuid = nextCartItemsInfo.interoObjectGuid || detail.object_guid;
            nextCartItemsInfo.interoQty = Number(detail.quantity || detail.actualQuantity || detail.qty || nextCartItemsInfo.interoQty || 0) || nextCartItemsInfo.interoQty;
            nextCartItemsInfo.adultQty = nextCartItemsInfo.interoQty;
          } else if (isChildTicketLabel(label)) {
            nextCartItemsInfo.childQty = Number(detail.quantity || detail.actualQuantity || detail.qty || nextCartItemsInfo.childQty || 0) || nextCartItemsInfo.childQty;
            nextCartItemsInfo.childObjectGuid = nextCartItemsInfo.childObjectGuid || detail.object_guid || null;
          } else if (isGuideTicketLabel(label)) {
            nextCartItemsInfo.guideQty = Number(detail.quantity || detail.actualQuantity || detail.qty || nextCartItemsInfo.guideQty || 0) || nextCartItemsInfo.guideQty;
            nextCartItemsInfo.guideDetailGuid = nextCartItemsInfo.guideDetailGuid || detail.detail_guid || detail.guid || null;
            nextCartItemsInfo.guideObjectGuid = nextCartItemsInfo.guideObjectGuid || detail.object_guid || null;
          }
        }
      }
      // Fallback: РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎРЏР ВµР С Р С‘Р В· itemsToCart + interoDetailGuid Р С‘Р В· Р С—Р ВµРЎР‚Р Р†Р С•Р С–Р С• Р С•РЎвЂљР Р†Р ВµРЎвЂљР В°
      cartItemsInfo = nextCartItemsInfo;
      if (cartItemsInfo) {
        log('СЂСџвЂњВ¦', `[DEBUG] detailGuids source: interoDetailGuid=${cartItemsInfo.interoDetailGuid || 'null'}, itemUuids=${JSON.stringify(itemUuids)}, allDetailGuids=${JSON.stringify(orderedDetailGuids)}`);
        log('СЂСџвЂњВ¦', `Cart item saved: ${cartItemsInfo.adultQty || 0}x Intero, ${cartItemsInfo.childQty || 0}x Under18, ${getCartItemsGuideQty(cartItemsInfo)}x Guide (total ${getCartItemsNonGuideQty(cartItemsInfo) + getCartItemsGuideQty(cartItemsInfo)}); Intero qty=${cartItemsInfo.interoQty || 0}; Under18 qty=${cartItemsInfo.childQty || 0}; Guide qty=${getCartItemsGuideQty(cartItemsInfo)}; detail_guid=${cartItemsInfo.interoDetailGuid || '?'}, object_guid=${cartItemsInfo.interoObjectGuid || '?'}`);
      }
    } catch (e) {
      log('РІС™В РїС‘РЏ', `Р СњР Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…Р С‘РЎвЂљРЎРЉ cart items: ${e.message}`);
    }

    consecutive403Count = 0;
    hadRateLimit429 = false;
    internal403Count = 0;
    clearProxyBan(currentProxyIndex);
    log('РІСљвЂ¦', `Р вЂќР С›Р вЂР С’Р вЂ™Р вЂєР вЂўР СњР В« Р вЂ™ Р С™Р С›Р В Р вЂ”Р ВР СњР Р€: ` + itemsToCart.map(i => `${i.quantity}x ${i.label}`).join(', '));
    return {
      success: true,
      status: 'success',
      bookingPlan,
      ticketInfo: bookingPlan.ticketInfo,
      detailGuids: Array.isArray(itemUuids) ? itemUuids : [],
      raw: cartRes.data
    };
  }

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р С›РЎвЂљР С”Р В»Р С•Р Р…Р ВµР Р…Р С‘Р Вµ (409 / success=false) РІвЂўС’РІвЂўС’РІвЂўС’
  let isRejected = (cartRes && cartRes.status === 409);
  if (cartRes && cartRes.data && cartRes.data.success === false) isRejected = true;
  if (isRejected) {
    if (!slotAttempts[slot.startDateTime]) slotAttempts[slot.startDateTime] = { attempts: 0, lastAttempt: 0 };
    slotAttempts[slot.startDateTime].attempts++;
    slotAttempts[slot.startDateTime].lastAttempt = Date.now();
    const attemptsHit = slotAttempts[slot.startDateTime].attempts;
    if (attemptsHit >= MAX_ATTEMPTS_PER_SLOT) {
      log('РІСњРЉ', `Р РЋР В»Р С•РЎвЂљ ${slot.startDateTime} Р С•РЎвЂљР С”Р В»Р С•Р Р…РЎвЂР Р… ${attemptsHit} РЎР‚Р В°Р В·(Р В°). Р вЂ”Р В°Р В±Р В°Р Р…Р ВµР Р… Р Р…Р В° ${SLOT_COOLDOWN_MS / 60000} Р СР С‘Р Р…!`);
    } else {
      log('РІСњРЉ', `Р РЋР В»Р С•РЎвЂљ ${slot.startDateTime} Р С•РЎвЂљР С”Р В»Р С•Р Р…РЎвЂР Р… (${attemptsHit}/${MAX_ATTEMPTS_PER_SLOT}).`);
    }
    return {
      success: false,
      status: 'rejected',
      code: cartRes?.status || 409,
      rejected: true,
      slot: slot.startDateTime,
      bookingPlan,
      ticketInfo: bookingPlan.ticketInfo
    };
  }

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р вЂќРЎР‚РЎС“Р С–Р В°РЎРЏ Р С•РЎв‚¬Р С‘Р В±Р С”Р В° РІвЂўС’РІвЂўС’РІвЂўС’
  log('РІС™В РїС‘РЏ', `addToCart Р С•РЎв‚¬Р С‘Р В±Р С”Р В°: HTTP ${cartRes ? cartRes.status : '?'}`);
  return false;
}

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  EDITCART: Р С‘Р В·Р СР ВµР Р…Р ВµР Р…Р С‘Р Вµ Р С”Р С•Р В»Р С‘РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р В° Р В±Р С‘Р В»Р ВµРЎвЂљР С•Р Р† Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
async function editCart(page, detailGuid, objectGuid, newQuantity) {
  log('СЂСџвЂќВ§', `[EDITCART] detail_guid=${detailGuid}, object_guid=${objectGuid}, quantity=${newQuantity}`);

  const result = await page.evaluate(async (dGuid, oGuid, qty) => {
    try {
      const res = await fetch('/mtajax/editcart', {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': window.location.origin,
          'Referer': window.location.href
        },
        body: `action=midaabc_editcart&detail_guid=${encodeURIComponent(dGuid)}&quantity=${qty}&object_guid=${encodeURIComponent(oGuid)}`
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { }
      return { status: res.status, data, text: text.substring(0, 300) };
    } catch (e) {
      return { status: 500, data: null, text: e.message };
    }
  }, detailGuid, objectGuid, newQuantity).catch(e => ({ status: 500, data: null, text: e.message }));

  log('СЂСџвЂќВ§', `[EDITCART] HTTP ${result.status}, success=${result.data?.success}`);
  if (result.status === 200 && result.data && result.data.success === true) {
    return { success: true };
  }

  if (result.status === 403) {
    log('WARN', `[EDITCART] WAF 403 on editcart proxy #${currentProxyIndex} -> rotate proxy, no proxy ban`);
    if (typeof rotateProxyAfterWafPressure === 'function') {
      rotateProxyAfterWafPressure('editcart_waf_403');
    }
  }

  return {
    success: false,
    status: result.status,
    text: result.text,
    retryable: isRetryableCartMutation(result.status, result.text),
    error: `HTTP ${result.status}: ${result.text}`
  };
}

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  MODIFY CART: Р В±Р ВµР В·Р С•Р С—Р В°РЎРѓР Р…Р В°РЎРЏ Р СР С•Р Т‘Р С‘РЎвЂћР С‘Р С”Р В°РЎвЂ Р С‘РЎРЏ Р Т‘Р В»РЎРЏ /pay
//  1) editcart(Intero: current РІвЂ вЂ™ current - children) РІР‚вЂќ Р С•РЎРѓР Р†Р С•Р В±Р С•Р Т‘Р С‘РЎвЂљРЎРЉ РЎРѓР В»Р С•РЎвЂљРЎвЂ№ Р Т‘Р В»РЎРЏ Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦
//  2) addtocart(children x Under18) РІР‚вЂќ Р В·Р В°Р Р…РЎРЏРЎвЂљРЎРЉ Р С•РЎРѓР Р†Р С•Р В±Р С•Р В¶Р Т‘РЎвЂР Р…Р Р…РЎвЂ№Р Вµ РЎРѓР В»Р С•РЎвЂљРЎвЂ№
//  3) editcart(Intero: current - children РІвЂ вЂ™ desiredAdults) РІР‚вЂќ РЎС“Р В±РЎР‚Р В°РЎвЂљРЎРЉ Р В»Р С‘РЎв‚¬Р Р…Р С‘Р Вµ
//  Rollback Р С—РЎР‚Р С‘ Р С•РЎв‚¬Р С‘Р В±Р С”Р Вµ РЎв‚¬Р В°Р С–Р В° 2
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
async function verifyHeldCart(page) {
  if (!page || page.isClosed?.()) {
    return { alive: false, reason: 'page_closed', adults: 0, children: 0, guide: 0, total: 0 };
  }

  const result = await page.evaluate(async () => {
    try {
      const meta = document.querySelector('meta[name="page-id"]');
      const bodyId = document.body?.dataset?.pageId;
      const pageId = meta?.content || bodyId || '0';
      const res = await fetch('/mtajax/check_cart', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Origin': window.location.origin,
          'Referer': window.location.href
        },
        body: `action=midaabc_check_cart&page=${encodeURIComponent(pageId)}`
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}
      const expirationMatch = document.cookie.match(/(?:^|;\s*)expiration_date=([^;]+)/);
      return {
        status: res.status,
        data,
        text: text.substring(0, 300),
        expirationDate: expirationMatch ? decodeURIComponent(expirationMatch[1]) : ''
      };
    } catch (error) {
      return { status: 0, data: null, text: error.message, expirationDate: '' };
    }
  }).catch(error => ({ status: 0, data: null, text: error.message, expirationDate: '' }));

  if ([0, 403, 429, 500, 502, 503, 504].includes(result.status)) {
    return { alive: null, reason: `transient_http_${result.status}`, raw: result.text || '' };
  }

  const data = result.data || {};
  const failureCode = Array.isArray(data.data) ? data.data[0]?.code : data.data?.code;
  if (result.status === 410 || failureCode === 410 || data.success === false) {
    return { alive: false, reason: `released_${failureCode || result.status}`, adults: 0, children: 0, guide: 0, total: 0 };
  }

  const payload = data.data || data;
  const items = Array.isArray(payload.items)
    ? payload.items
    : (Array.isArray(payload.details) ? payload.details : []);
  const totalFromItems = items.reduce((sum, item) => {
    if (typeof item === 'string') return sum + 1;
    const qty = Number(item.actualQuantity ?? item.quantity ?? item.qty ?? 1);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);

  if (items.length === 0 || totalFromItems <= 0) {
    return { alive: false, reason: 'empty_cart', adults: 0, children: 0, guide: 0, total: 0 };
  }

  const expirationMissing = !result.expirationDate;
  if (expirationMissing) {
    log('HOLD', '[HOLD] cart_expiration_cookie_missing but check_cart has items; keeping cart alive');
  }

  let adults = 0;
  let children = 0;
  let guide = 0;
  for (const item of items) {
    if (!item || typeof item === 'string') continue;
    const qty = Number(item.actualQuantity ?? item.quantity ?? item.qty ?? 1) || 1;
    const label = String(item.label || item.tariff_label || item.name || item.title || '').toLowerCase();
    if (isGuideTicketLabel(label)) guide += qty;
    else if (isChildTicketLabel(label)) children += qty;
    else if (isAdultTicketLabel(label)) adults += qty;
  }

  if (adults === 0 && children === 0 && guide === 0) {
    adults = getCartItemsAdultQty(cartItemsInfo);
    children = getCartItemsChildQty(cartItemsInfo);
    guide = getCartItemsGuideQty(cartItemsInfo);
  }
  const total = adults + children + guide || totalFromItems;

  return {
    alive: true,
    reason: expirationMissing ? 'ok_missing_expiration_cookie' : 'ok',
    adults,
    children,
    guide,
    total: total || totalFromItems,
    expirationDate: result.expirationDate
  };
}

function markHeldCartReleased(reason) {
  log('HOLD', `[HOLD] cart_released reason=${reason}`);
  holdModeActive = false;
  holdModeSlotInfo = null;
  cartItemsInfo = null;
  payDialogActive = false;
  payDialogOwnerId = null;
  payDialogStartedAtMs = 0;
  paymentModifyInFlight = false;
  clearPaymentModifyRetryWindow();
  payCommandReceived = false;
  payDesiredAdults = 0;
  payDesiredChildren = 0;
  payCheckoutOnly = false;
  payPassengerDetails = null;
}

async function modifyCartForCheckout(page, desiredAdults, desiredChildren, itemsInfo, slot, target) {
  if (!itemsInfo || typeof itemsInfo !== 'object') {
    return {
      success: false,
      error: 'Missing active cart item state; cannot modify held cart safely',
      currentAdults: 0,
      retryable: false,
      retryReason: 'missing_cart_items_info'
    };
  }
  const currentIntero = Number(itemsInfo.interoQty || 0);
  const currentChildren = getCartItemsChildQty(itemsInfo);
  const currentGuide = getCartItemsGuideQty(itemsInfo);
  const detailGuid = itemsInfo.interoDetailGuid;
  const objectGuid = itemsInfo.interoObjectGuid;
  const originalDetailGuids = Array.isArray(itemsInfo.detailGuids) ? itemsInfo.detailGuids.filter(Boolean) : [];
  const originalAdultDetailGuids = Array.isArray(itemsInfo.adultDetailGuids) && itemsInfo.adultDetailGuids.length > 0
    ? itemsInfo.adultDetailGuids.filter(Boolean)
    : originalDetailGuids.slice(0, currentIntero);
  const originalChildDetailGuids = Array.isArray(itemsInfo.childDetailGuids) && itemsInfo.childDetailGuids.length > 0
    ? itemsInfo.childDetailGuids.filter(Boolean)
    : originalDetailGuids.slice(currentIntero, currentIntero + currentChildren);
  const originalGuideDetailGuids = Array.isArray(itemsInfo.guideDetailGuids) && itemsInfo.guideDetailGuids.length > 0
    ? itemsInfo.guideDetailGuids.filter(Boolean)
    : (itemsInfo.guideDetailGuid ? [itemsInfo.guideDetailGuid] : originalDetailGuids.slice(currentIntero + currentChildren, currentIntero + currentChildren + currentGuide));
  const guideDetailGuid = originalGuideDetailGuids[0] || (originalDetailGuids.length > currentIntero + currentChildren ? originalDetailGuids[originalDetailGuids.length - 1] : null);
  const buildFinalDetailGuids = (newChildDetailGuids = []) => {
    const guideGuids = originalGuideDetailGuids.length > 0 ? originalGuideDetailGuids : [guideDetailGuid];
    return [
      ...originalAdultDetailGuids.slice(0, desiredAdults),
      ...originalChildDetailGuids.slice(0, Math.min(currentChildren, desiredChildren)),
      ...newChildDetailGuids.slice(0, Math.max(0, desiredChildren - currentChildren)),
      ...guideGuids.slice(0, currentGuide)
    ].filter(Boolean);
  };
  const clearCartStateUncertain = () => {
    if (!cartItemsInfo) return;
    delete cartItemsInfo.cartStateUncertain;
    delete cartItemsInfo.cartStateUncertainReason;
  };
  const setKnownInteroQty = (qty, options = {}) => {
    if (!cartItemsInfo) return;
    const knownQty = Math.max(0, Number(qty) || 0);
    cartItemsInfo.interoQty = knownQty;
    cartItemsInfo.adultQty = knownQty;
    const knownDetailGuids = [
      ...originalAdultDetailGuids.slice(0, knownQty),
      ...originalChildDetailGuids,
      ...originalGuideDetailGuids
    ].filter(Boolean);
    if (knownDetailGuids.length > 0) cartItemsInfo.detailGuids = knownDetailGuids;
    cartItemsInfo.adultDetailGuids = originalAdultDetailGuids.slice(0, knownQty);
    cartItemsInfo.childDetailGuids = originalChildDetailGuids;
    cartItemsInfo.guideDetailGuids = originalGuideDetailGuids;
    if (options.uncertainReason) {
      cartItemsInfo.cartStateUncertain = true;
      cartItemsInfo.cartStateUncertainReason = options.uncertainReason;
    } else {
      clearCartStateUncertain();
    }
  };
  const getKnownInteroQty = () => {
    const knownQty = Number(cartItemsInfo?.interoQty);
    return Number.isFinite(knownQty) && knownQty >= 0 ? knownQty : currentIntero;
  };
  const buildModifyFailure = (error, currentAdults, options = {}) => {
    const status = Number(options.status || 0) || 0;
    const retryableStatus = [403, 429, 500, 502, 503, 504].includes(status);
    const retryableText = /HTTP\s+(0|403|429|500|502|503|504)\b|octofence|rate limit|block_style|too many requests/i.test(String(error || ''));
    const noAutoRetry = Boolean(options.noAutoRetry);
    return {
      success: false,
      error,
      currentAdults,
      retryable: !noAutoRetry && (Boolean(options.retryable) || retryableStatus || retryableText),
      retryReason: options.retryReason || (status ? `cart_modify_http_${status}` : 'cart_modify_failed'),
      status,
      cartStateUncertain: Boolean(options.cartStateUncertain),
      noAutoRetry
    };
  };
  const rollbackIntero = async (reason, fallbackAdults = getKnownInteroQty()) => {
    const rollback = await editCart(page, detailGuid, objectGuid, currentIntero);
    if (rollback.success) {
      setKnownInteroQty(currentIntero);
      log('PAYMENT', `[PAYMENT] cart_rollback_restored reason=${reason} adults=${currentIntero}`);
      return { success: true, currentAdults: currentIntero };
    }

    const knownAdults = Number.isFinite(Number(fallbackAdults)) ? Number(fallbackAdults) : getKnownInteroQty();
    setKnownInteroQty(knownAdults, { uncertainReason: reason });
    log('WARN', `[PAYMENT] cart_state_uncertain reason=${reason} adults=${knownAdults} wantedRestore=${currentIntero} rollbackError="${rollback.error || 'unknown'}"`);
    return {
      success: false,
      currentAdults: knownAdults,
      error: rollback.error || 'rollback failed',
      status: rollback.status || 0,
      retryable: Boolean(rollback.retryable) || isRetryableCartMutation(rollback.status, rollback.error || '')
    };
  };

  if (cartMatchesRequestedComposition(itemsInfo, desiredAdults, desiredChildren, currentGuide)) {
    const finalDetailGuids = buildFinalDetailGuids([]);
    if (cartItemsInfo) {
      cartItemsInfo.detailGuids = finalDetailGuids;
      cartItemsInfo.adultQty = desiredAdults;
      cartItemsInfo.interoQty = desiredAdults;
      cartItemsInfo.childQty = desiredChildren;
      cartItemsInfo.guideQty = currentGuide;
    }
    log('PAYMENT', `[PAYMENT] cart_modify_skipped reason=already_matches adults=${desiredAdults} children=${desiredChildren} guide=${currentGuide}`);
    return { success: true, detailGuids: finalDetailGuids, skipped: true };
  }

  if (currentChildren > desiredChildren) {
    return {
      success: false,
      error: `cart already has more Under18 (${currentChildren}) than requested (${desiredChildren}); reducing child tickets is not supported safely`,
      currentAdults: currentIntero,
      retryable: false,
      retryReason: 'mixed_cart_reduce_children_unsupported',
      noAutoRetry: true
    };
  }

  if (!detailGuid || !objectGuid) {
    return { success: false, error: 'Р СњР ВµРЎвЂљ detail_guid/object_guid Р Т‘Р В»РЎРЏ Intero', currentAdults: currentIntero };
  }

  const additionalChildrenNeeded = Math.max(0, desiredChildren - currentChildren);

  log('СЂСџвЂќВ§', `[MODIFY] Р СњР В°РЎвЂЎР С‘Р Р…Р В°Р ВµР С: ${currentIntero} Intero + ${currentChildren} Under18 РІвЂ вЂ™ ${desiredAdults} Intero + ${desiredChildren} Under18`);

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р вЂўРЎРѓР В»Р С‘ РЎвЂљР С•Р В»РЎРЉР С”Р С• РЎС“Р СР ВµР Р…РЎРЉРЎв‚¬Р ВµР Р…Р С‘Р Вµ (Р В±Р ВµР В· Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦) РІвЂўС’РІвЂўС’РІвЂўС’
  if (desiredChildren === 0) {
    if (desiredAdults < currentIntero) {
      log('СЂСџвЂќВ§', `[MODIFY] Р Р€Р СР ВµР Р…РЎРЉРЎв‚¬Р ВµР Р…Р С‘Р Вµ: ${currentIntero} РІвЂ вЂ™ ${desiredAdults}`);
      const r = await editCart(page, detailGuid, objectGuid, desiredAdults);
      if (!r.success) {
        return {
          success: false,
          error: `editcart failed: ${r.error}`,
          currentAdults: currentIntero,
          retryable: Boolean(r.retryable),
          retryReason: `editcart_${r.status || 'unknown'}`,
          status: r.status || 0
        };
      }
      setKnownInteroQty(desiredAdults);
      log('РІСљвЂ¦', `[MODIFY] Intero: ${currentIntero} РІвЂ вЂ™ ${desiredAdults}`);
    }
    const finalDetailGuids = buildFinalDetailGuids([]);
    if (cartItemsInfo) {
      cartItemsInfo.detailGuids = finalDetailGuids;
      cartItemsInfo.interoQty = desiredAdults;
      cartItemsInfo.adultQty = desiredAdults;
      cartItemsInfo.childQty = 0;
      cartItemsInfo.guideQty = currentGuide;
    }
    return { success: true, detailGuids: finalDetailGuids };
  }

  if (additionalChildrenNeeded === 0) {
    if (currentIntero < desiredAdults) {
      return buildModifyFailure(
        `cart already has fewer Intero (${currentIntero}) than requested adults (${desiredAdults})`,
        currentIntero,
        { retryReason: 'cart_state_below_requested' }
      );
    }
    if (desiredAdults < currentIntero) {
      log('СЂСџвЂќВ§', `[MODIFY] Р Р€Р СР ВµР Р…РЎРЉРЎв‚¬Р ВµР Р…Р С‘Р Вµ: ${currentIntero} РІвЂ вЂ™ ${desiredAdults}; Under18 already=${currentChildren}`);
      const r = await editCart(page, detailGuid, objectGuid, desiredAdults);
      if (!r.success) {
        return buildModifyFailure(`editcart reduce failed: ${r.error}`, currentIntero, {
          retryable: Boolean(r.retryable),
          retryReason: `editcart_${r.status || 'unknown'}`,
          status: r.status || 0
        });
      }
      setKnownInteroQty(desiredAdults);
    }
    const finalDetailGuids = buildFinalDetailGuids([]);
    if (cartItemsInfo) {
      cartItemsInfo.detailGuids = finalDetailGuids;
      cartItemsInfo.childQty = desiredChildren;
      cartItemsInfo.guideQty = currentGuide;
    }
    return { success: true, detailGuids: finalDetailGuids };
  }

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р РЃР С’Р вЂњ 1: Р С›РЎРѓР Р†Р С•Р В±Р С•Р В¶Р Т‘Р В°Р ВµР С РЎР‚Р С•Р Р†Р Р…Р С• N РЎРѓР В»Р С•РЎвЂљР С•Р Р† Р Т‘Р В»РЎРЏ Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦ РІвЂўС’РІвЂўС’РІвЂўС’
  if (currentIntero < desiredAdults) {
    return buildModifyFailure(
      `cart already has fewer Intero (${currentIntero}) than requested adults (${desiredAdults})`,
      currentIntero,
      { retryReason: 'cart_state_below_requested' }
    );
  }

  const seatsToReleaseForChildren = Math.min(additionalChildrenNeeded, Math.max(0, currentIntero - desiredAdults));
  let step1Qty = currentIntero - seatsToReleaseForChildren;
  if (seatsToReleaseForChildren > 0) {
  log('СЂСџвЂќВ§', `[MODIFY] Р РЃР В°Р С– 1: Intero ${currentIntero} РІвЂ вЂ™ ${step1Qty} (Р С•РЎРѓР Р†Р С•Р В±Р С•Р В¶Р Т‘Р В°Р ВµР С ${additionalChildrenNeeded} РЎРѓР В»Р С•РЎвЂљР С•Р Р†)`);
  const step1 = await editCart(page, detailGuid, objectGuid, step1Qty);
  if (!step1.success) {
    return buildModifyFailure(`Step 1 editcart reduce failed: ${step1.error}`, currentIntero, {
      retryable: Boolean(step1.retryable),
      retryReason: `editcart_reduce_${step1.status || 'unknown'}`,
      status: step1.status || 0
    });
  }
  setKnownInteroQty(step1Qty);
  } else {
    log('PAYMENT', `[PAYMENT] cart_modify_skip_initial_reduce adults=${currentIntero} children=${desiredChildren} additionalChildren=${additionalChildrenNeeded} reason=already_reduced`);
  }

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р РЃР С’Р вЂњ 2: Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘Р Вµ Р В±Р С‘Р В»Р ВµРЎвЂљРЎвЂ№ РІвЂўС’РІвЂўС’РІвЂўС’
  await sleep(1500 + Math.random() * 1000);
  log('СЂСџвЂќВ§', `[MODIFY] Р РЃР В°Р С– 2: addtocart ${additionalChildrenNeeded}x "Gratuito - Under 18"`);

  // Р СџР С•Р В»РЎС“РЎвЂЎР В°Р ВµР С РЎвЂљР В°РЎР‚Р С‘РЎвЂћРЎвЂ№ Р Т‘Р В»РЎРЏ Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦
  const tariffsResponse = await page.evaluate(async (pId, sTime) => {
    const pData = `action=midaabc_tariffs&period_id=${encodeURIComponent(pId)}&start_time=${encodeURIComponent(sTime)}`;
    try {
      const res = await fetch('/mtajax/tariffs', {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Origin': window.location.origin,
          'Referer': window.location.href
        },
        body: pData
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}
      const textLower = text.toLowerCase();
      const isWaf = res.status === 403 && (textLower.includes('cloudflare') || textLower.includes('octofence') || textLower.includes('cf-ray') || textLower.includes('block_style'));
      return { status: res.status, data, text: text.substring(0, 500), isWaf };
    } catch (e) { return { status: 500, data: null, text: e.message, isWaf: false }; }
  }, slot.period_id, slot.startDateTime).catch((e) => ({ status: 500, data: null, text: e.message, isWaf: false }));

  if (!tariffsResponse || tariffsResponse.status !== 200 || !tariffsResponse.data) {
    if (tariffsResponse?.status === 429 || tariffsResponse?.isWaf || tariffsResponse?.status === 403) {
      log('WARN', `[MODIFY] Р–РґРµРј 3 СЃРµРєСѓРЅРґС‹ РїРµСЂРµРґ РѕС‚РєР°С‚РѕРј РёР·-Р·Р° 429/403/WAF РЅР° С‚Р°СЂРёС„Р°С…...`);
      await sleep(3000 + Math.random() * 1500);
    }
    const rollback = await rollbackIntero(`under18_tariffs_http_${tariffsResponse?.status || 'unknown'}`, step1Qty);
    const status = Number(tariffsResponse?.status || 0) || 0;
    const body = String(tariffsResponse?.text || '').substring(0, 240);
    return buildModifyFailure(
      rollback.success ? `Under18 tariffs request failed: HTTP ${status} ${body}` : `Under18 tariffs request failed: HTTP ${status} ${body}; rollback failed: ${rollback.error}`,
      rollback.currentAdults,
      {
        retryable: isRetryableCartMutation(status, body) || Boolean(rollback.retryable),
        retryReason: tariffsResponse?.isWaf ? 'under18_tariffs_waf' : `under18_tariffs_${status || 'unknown'}`,
        status: status || rollback.status || 0,
        cartStateUncertain: !rollback.success
      }
    );
  }

  let childTariff = null;
  const tariffsPayload = tariffsResponse.data;
  if (tariffsPayload && tariffsPayload.data) {
    const allTariffs = Array.isArray(tariffsPayload.data) ? tariffsPayload.data : Object.values(tariffsPayload.data).flat();
    childTariff = findTariffForTicket(allTariffs, CHILD_TICKET_LABEL);
  }

  if (!childTariff) {
    const rollback = await rollbackIntero('under18_tariff_missing', step1Qty);
    const baseError = 'Under18 tariff not found';
    return buildModifyFailure(
      rollback.success ? baseError : `${baseError}; rollback failed: ${rollback.error}`,
      rollback.currentAdults,
      {
        retryable: Boolean(rollback.retryable),
        retryReason: rollback.success ? 'under18_tariff_missing' : 'cart_state_uncertain',
        status: rollback.status || 0,
        cartStateUncertain: !rollback.success
      }
    );
    // ROLLBACK: Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р В°Р Р†Р В»Р С‘Р Р†Р В°Р ВµР С Intero
    log('РІС™В РїС‘РЏ', `[MODIFY] Р СћР В°РЎР‚Р С‘РЎвЂћ Under18 Р Р…Р Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…! Р С›РЎвЂљР С”Р В°РЎвЂљ...`);
    await editCart(page, detailGuid, objectGuid, currentIntero);  // Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р В°Р Р†Р В»Р С‘Р Р†Р В°Р ВµР С
    return { success: false, error: 'Р СћР В°РЎР‚Р С‘РЎвЂћ "Gratuito - Under 18" Р Р…Р Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…', currentAdults: currentIntero };
  }

  const childObjectGuid = childTariff.object_guid || childTariff.guid;
  const childTablename = getTariffObjectTablename(childTariff);
  const pageId = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="page-id"]');
    if (meta) return meta.content;
    const bodyId = document.body?.dataset?.pageId;
    if (bodyId) return bodyId;
    const match = document.body?.innerHTML?.match(/page["\s]*[:=]\s*["']?(\d+)/i);
    return match ? match[1] : '0';
  }).catch(() => '0');

  await sleep(1500 + Math.random() * 1000);

  const addUnder18ToCart = async (attemptLabel, qty) => page.evaluate(async (pId, sTime, eTime, pgId, oGuid, oTable, qty, label) => {
    try {
      const bodyParts = [
        `action=midaabc_addtocart`,
        `items%5B0%5D%5Bdetail_guid%5D=_draft_0`,
        `items%5B0%5D%5Bperiod_id%5D=${encodeURIComponent(pId)}`,
        `items%5B0%5D%5Bstart_time%5D=${encodeURIComponent(sTime)}`,
        `items%5B0%5D%5Bend_time%5D=${encodeURIComponent(eTime)}`,
        `items%5B0%5D%5Bobject_guid%5D=${encodeURIComponent(oGuid)}`,
        `items%5B0%5D%5Bobject_tablename%5D=${encodeURIComponent(oTable)}`,
        `items%5B0%5D%5Bquantity%5D=${qty}`,
        `items%5B0%5D%5BactivityPerPerson%5D=true`,
        `items%5B0%5D%5Bconvention_guid%5D=`,
        `items%5B0%5D%5Bconvention_text%5D=`,
        `items%5B0%5D%5Bgroup_guid%5D=`,
        `page=${pgId}`
      ];
      const res = await fetch('/mtajax/addtocart', {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Origin': window.location.origin,
          'Referer': window.location.href
        },
        body: bodyParts.join('&')
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { }
      return { status: res.status, data, text: text.substring(0, 500), attempt: label };
    } catch (e) { return { status: 500, data: null, text: e.message, attempt: label }; }
  }, slot.period_id, slot.startDateTime, slot.endDateTime || slot.startDateTime, pageId, childObjectGuid, childTablename, qty, attemptLabel).catch(e => ({ status: 500, data: null, text: e.message, attempt: attemptLabel }));

  const summarizeChildCartFailure = (result) => {
    const body = result?.data ? JSON.stringify(result.data) : (result?.text || '');
    return `attempt=${result?.attempt || 'n/a'} HTTP ${result?.status || '?'} body=${String(body).substring(0, 240)}`;
  };

  const isChildCartSuccess = (result) => (
    result
    && result.status === 200
    && result.data
    && result.data.success === true
  );
  const childCartFailureBody = (result) => (
    result?.data ? JSON.stringify(result.data) : (result?.text || '')
  );
  const isMidaBusinessChildFailure = (result) => {
    if (!result || result.status !== 200 || !result.data || result.data.success === true) return false;
    const code = String(result.data.code || result.data.errorCode || result.data.status || '');
    const body = childCartFailureBody(result);
    return code === '409' || /\b409\b/.test(body);
  };

  log('PAYMENT', `[PAYMENT] under18_primary_attempt adults=${desiredAdults} children=${desiredChildren} guide=1 current_intero=${currentIntero} step1_intero=${step1Qty}`);
  let childCartRes = await addUnder18ToCart('primary', additionalChildrenNeeded);

  if (!isChildCartSuccess(childCartRes) && isWafOrRateLimitedCartMutation(childCartRes?.status, childCartFailureBody(childCartRes))) {
    const childFailure = summarizeChildCartFailure(childCartRes);
    const childStatus = Number(childCartRes?.status || 0) || 0;
    log('WARN', `[PAYMENT] under18_primary_waf_stop adults=${desiredAdults} children=${desiredChildren} guide=1 ${childFailure}`);
    if (typeof reportProxyLeaseEvent === 'function') {
      reportProxyLeaseEvent('cart_pressure', `under18_primary_${childStatus || 'blocked'}`);
    }
    log('WARN', `[MODIFY] Р–РґРµРј 3 СЃРµРєСѓРЅРґС‹ РїРµСЂРµРґ РѕС‚РєР°С‚РѕРј РёР·-Р·Р° WAF/429 РЅР° primary addtocart...`);
    await sleep(3000 + Math.random() * 1500);
    const rollback = await rollbackIntero('under18_waf_or_rate_limited', step1Qty);
    const rollbackState = rollback.success ? 'restored' : 'uncertain';
    log('PAYMENT', `[PAYMENT] cart_modify_blocked_by_waf adults=${desiredAdults} children=${desiredChildren} guide=1 status=${childStatus || 'unknown'} rollback=${rollbackState}`);
    const error = rollback.success
      ? `addtocart Under18 WAF/rate pressure: ${childFailure}`
      : `addtocart Under18 WAF/rate pressure: ${childFailure}; rollback failed: ${rollback.error}`;
    return buildModifyFailure(error, rollback.currentAdults, {
      retryable: false,
      retryReason: 'cart_modify_blocked_by_waf',
      status: childStatus || rollback.status || 0,
      cartStateUncertain: !rollback.success,
      noAutoRetry: true
    });
  }

  if (!isChildCartSuccess(childCartRes) && step1Qty > desiredAdults && isMidaBusinessChildFailure(childCartRes)) {
    log('WARN', `[MODIFY] Under18 primary business_409 failed: ${summarizeChildCartFailure(childCartRes)}. Retry after reducing Intero to final adults.`);
    log('WARN', `[MODIFY] Р–РґРµРј 2 СЃРµРєСѓРЅРґС‹ РїРµСЂРµРґ final reduce...`);
    await sleep(2000 + Math.random() * 1000);
    const finalReduce = await editCart(page, detailGuid, objectGuid, desiredAdults);
    if (finalReduce.success) {
      setKnownInteroQty(desiredAdults);
      step1Qty = desiredAdults;
      await sleep(2500 + Math.random() * 1500);
      log('PAYMENT', `[PAYMENT] under18_after_final_reduce_attempt adults=${desiredAdults} children=${desiredChildren} guide=1`);
      childCartRes = await addUnder18ToCart('after_final_reduce', additionalChildrenNeeded);
    } else {
      log('WARN', `[MODIFY] Under18 retry skipped: final reduce failed: ${finalReduce.error}`);
    }
  }

  if (!isChildCartSuccess(childCartRes) && isWafOrRateLimitedCartMutation(childCartRes?.status, childCartFailureBody(childCartRes))) {
    const childFailure = summarizeChildCartFailure(childCartRes);
    const childStatus = Number(childCartRes?.status || 0) || 0;
    log('WARN', `[PAYMENT] under18_after_final_reduce_waf_stop adults=${desiredAdults} children=${desiredChildren} guide=1 ${childFailure}`);
    if (typeof reportProxyLeaseEvent === 'function') {
      reportProxyLeaseEvent('cart_pressure', `under18_after_final_reduce_${childStatus || 'blocked'}`);
    }
    log('WARN', `[MODIFY] Р–РґРµРј 3 СЃРµРєСѓРЅРґС‹ РїРµСЂРµРґ РѕС‚РєР°С‚РѕРј РёР·-Р·Р° WAF/429 РЅР° after_final_reduce addtocart...`);
    await sleep(3000 + Math.random() * 1500);
    const rollback = await rollbackIntero('under18_waf_or_rate_limited', getKnownInteroQty());
    const rollbackState = rollback.success ? 'restored' : 'uncertain';
    log('PAYMENT', `[PAYMENT] cart_modify_blocked_by_waf adults=${desiredAdults} children=${desiredChildren} guide=1 status=${childStatus || 'unknown'} rollback=${rollbackState}`);
    const error = rollback.success
      ? `addtocart Under18 WAF/rate pressure: ${childFailure}`
      : `addtocart Under18 WAF/rate pressure: ${childFailure}; rollback failed: ${rollback.error}`;
    return buildModifyFailure(error, rollback.currentAdults, {
      retryable: false,
      retryReason: 'cart_modify_blocked_by_waf',
      status: childStatus || rollback.status || 0,
      cartStateUncertain: !rollback.success,
      noAutoRetry: true
    });
  }

  if (!isChildCartSuccess(childCartRes)) {
    const childFailure = summarizeChildCartFailure(childCartRes);
    const childStatus = Number(childCartRes?.status || 0) || 0;
    const rollback = await rollbackIntero('under18_add_failed', getKnownInteroQty());
    const error = rollback.success
      ? `addtocart Under18 failed: ${childFailure}`
      : `addtocart Under18 failed: ${childFailure}; rollback failed: ${rollback.error}`;
    return buildModifyFailure(error, rollback.currentAdults, {
      retryable: isRetryableCartMutation(childStatus, childFailure) || Boolean(rollback.retryable),
      retryReason: isRetryableCartMutation(childStatus, childFailure)
        ? `add_under18_${childStatus || 'unknown'}`
        : (rollback.success ? 'add_under18_failed' : 'cart_state_uncertain'),
      status: childStatus || rollback.status || 0,
      cartStateUncertain: !rollback.success
    });
    // ROLLBACK: Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р В°Р Р†Р В»Р С‘Р Р†Р В°Р ВµР С Intero Р Т‘Р С• Р С‘РЎРѓРЎвЂ¦Р С•Р Т‘Р Р…Р С•Р С–Р С•
    log('РІС™В РїС‘РЏ', `[MODIFY] Р вЂќР С•Р В±Р В°Р Р†Р В»Р ВµР Р…Р С‘Р Вµ Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦ Р С—РЎР‚Р С•Р Р†Р В°Р В»Р С‘Р В»Р С•РЎРѓРЎРЉ (HTTP ${childCartRes?.status})! Р С›РЎвЂљР С”Р В°РЎвЂљ...`);
    await editCart(page, detailGuid, objectGuid, currentIntero);  // Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р В°Р Р†Р В»Р С‘Р Р†Р В°Р ВµР С Р С‘РЎРѓРЎвЂ¦Р С•Р Т‘Р Р…Р С•Р Вµ
    return { success: false, error: `addtocart Under18 failed: ${summarizeChildCartFailure(childCartRes)}`, currentAdults: currentIntero };
  }

  log('РІСљвЂ¦', `[MODIFY] ${additionalChildrenNeeded}x Under18 Р Т‘Р С•Р В±Р В°Р Р†Р В»Р ВµР Р…РЎвЂ№! target_children=${desiredChildren}`);
  const childDetailGuids = Array.isArray(childCartRes?.data?.data?.items) ? childCartRes.data.data.items.filter(Boolean) : [];

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р РЃР С’Р вЂњ 3: Р Р€Р В±Р С‘РЎР‚Р В°Р ВµР С Р С•РЎРѓРЎвЂљР В°Р Р†РЎв‚¬Р С‘Р ВµРЎРѓРЎРЏ Р В»Р С‘РЎв‚¬Р Р…Р С‘Р Вµ Intero РІвЂўС’РІвЂўС’РІвЂўС’
  if (step1Qty > desiredAdults) {
    await sleep(1000);
    const step3Delta = desiredAdults - step1Qty;  // Р С•РЎвЂљРЎР‚Р С‘РЎвЂ Р В°РЎвЂљР ВµР В»РЎРЉР Р…Р С•Р Вµ
    log('СЂСџвЂќВ§', `[MODIFY] Р РЃР В°Р С– 3: Intero ${step1Qty} РІвЂ вЂ™ ${desiredAdults}`);
    const step3 = await editCart(page, detailGuid, objectGuid, desiredAdults);
    if (!step3.success) {
      log('WARN', `[PAYMENT] final adult reduce failed after children added: ${step3.error}`);
      setKnownInteroQty(step1Qty, { uncertainReason: 'final_reduce_failed_after_children_added' });
      return buildModifyFailure(`Final editcart reduce failed after adding children: ${step3.error}`, step1Qty, {
        retryable: Boolean(step3.retryable),
        retryReason: `final_reduce_${step3.status || 'unknown'}`,
        status: step3.status || 0,
        cartStateUncertain: true
      });
    } else {
      setKnownInteroQty(desiredAdults);
    }
  }

  log('OK', `[MODIFY] Р вЂњР С•РЎвЂљР С•Р Р†Р С•: ${cartItemsInfo?.interoQty ?? desiredAdults} Intero + ${desiredChildren} Under18 + ${currentGuide} Guide`);
  const finalDetailGuids = buildFinalDetailGuids(childDetailGuids);
  if (cartItemsInfo) {
    cartItemsInfo.detailGuids = finalDetailGuids;
    cartItemsInfo.interoQty = desiredAdults;
    cartItemsInfo.adultQty = desiredAdults;
    cartItemsInfo.childQty = desiredChildren;
    cartItemsInfo.guideQty = currentGuide;
    cartItemsInfo.adultDetailGuids = originalAdultDetailGuids.slice(0, desiredAdults);
    cartItemsInfo.childDetailGuids = [
      ...originalChildDetailGuids.slice(0, Math.min(currentChildren, desiredChildren)),
      ...childDetailGuids.slice(0, additionalChildrenNeeded)
    ].filter(Boolean);
    cartItemsInfo.guideDetailGuids = originalGuideDetailGuids;
    if (childObjectGuid) cartItemsInfo.childObjectGuid = childObjectGuid;
    if (childTablename) cartItemsInfo.childObjectTablename = childTablename;
  }
  return { success: true, detailGuids: finalDetailGuids, childDetailGuids };
}

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  Р С’Р вЂ™Р СћР С›-Р вЂ”Р С’Р СџР С›Р вЂєР СњР вЂўР СњР ВР вЂў Р ВР СљР РѓР Сњ: POST /mtajax/set_extradata
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
async function fillParticipantNames(page, detailGuids) {
  const participants = config.participants || [];
  if (participants.length === 0) {
    log('РІС™В РїС‘РЏ', 'Р СњР ВµРЎвЂљ РЎС“РЎвЂЎР В°РЎРѓРЎвЂљР Р…Р С‘Р С”Р С•Р Р† Р Р† config.participants РІР‚вЂќ Р С—РЎР‚Р С•Р С—РЎС“РЎРѓР С”Р В°Р ВµР С Р В·Р В°Р С—Р С•Р В»Р Р…Р ВµР Р…Р С‘Р Вµ Р С‘Р СРЎвЂР Р….');
    return false;
  }

  const data = [];
  for (let i = 0; i < detailGuids.length && i < participants.length; i++) {
    data.push({
      partecipantsData: {
        firstName: participants[i].firstName,
        lastName: participants[i].lastName
      },
      detail_guid: detailGuids[i]
    });
  }

  if (data.length === 0) {
    log('РІС™В РїС‘РЏ', 'Р СњР ВµРЎвЂљ detail_guid Р Т‘Р В»РЎРЏ Р В·Р В°Р С—Р С•Р В»Р Р…Р ВµР Р…Р С‘РЎРЏ Р С‘Р СРЎвЂР Р….');
    return false;
  }

  log('СЂСџвЂВ¤', `Р вЂ”Р В°Р С—Р С•Р В»Р Р…РЎРЏР ВµР С Р С‘Р СР ВµР Р…Р В° ${data.length} РЎС“РЎвЂЎР В°РЎРѓРЎвЂљР Р…Р С‘Р С”Р С•Р Р†...`);

  const result = await page.evaluate(async (jsonData) => {
    try {
      const res = await fetch('/mtajax/set_extradata', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Origin': window.location.origin,
          'Referer': window.location.href
        },
        body: `action=midaabc_set_extradata&data=${encodeURIComponent(JSON.stringify(jsonData))}`
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { }
      return { status: res.status, data: parsed, snippet: text.substring(0, 200) };
    } catch (e) {
      return { status: 500, data: null, snippet: e.message };
    }
  }, data).catch(e => ({ status: 500, data: null, snippet: e.message }));

  if (result && result.status === 200) {
    log('РІСљвЂ¦', `Р ВР СР ВµР Р…Р В° РЎС“РЎРѓР С—Р ВµРЎв‚¬Р Р…Р С• Р В·Р В°Р С—Р С•Р В»Р Р…Р ВµР Р…РЎвЂ№! (${data.length} РЎС“РЎвЂЎР В°РЎРѓРЎвЂљР Р…Р С‘Р С”Р С•Р Р†)`);
    return true;
  } else {
    log('РІС™В РїС‘РЏ', `set_extradata: HTTP ${result.status} РІР‚вЂќ ${result.snippet}`);
    log('РІвЂћв„–РїС‘РЏ', 'Р ВР СР ВµР Р…Р В° Р В±РЎС“Р Т‘РЎС“РЎвЂљ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р Р…РЎвЂ№ Р Т‘Р В»РЎРЏ РЎР‚РЎС“РЎвЂЎР Р…Р С•Р С–Р С• Р Р†Р Р†Р С•Р Т‘Р В° Р С—Р С•РЎРѓР В»Р Вµ Р С•Р С—Р В»Р В°РЎвЂљРЎвЂ№.');
    return false;
  }
}

// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
//  TELEGRAM LISTENER: Р С—РЎР‚Р С‘РЎвЂР С Р С”Р С•Р СР В°Р Р…Р Т‘ /pay, /hold, /status
// РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
function buildPassengerDataForDetails(detailGuids, passengerDetails) {
  const guids = Array.isArray(detailGuids) ? detailGuids.filter(Boolean) : [];
  const details = getPassengerDetailsForFill(passengerDetails, guids);
  const ordered = buildOrderedPassengerPeople(details, guids);

  return guids.slice(0, ordered.length).map((detailGuid, index) => {
    const person = ordered[index] || {};
    const payload = {
      firstName: String(person.firstName || '').trim(),
      lastName: String(person.lastName || '').trim()
    };
    if (person.type === 'guide' && person.licenseNumber) {
      payload.licenseNumber = String(person.licenseNumber).trim();
      payload.cardNumber = payload.licenseNumber;
      payload.tesserino = payload.licenseNumber;
    }
    return {
      partecipantsData: payload,
      detail_guid: detailGuid
    };
  }).filter((row) => row.partecipantsData.firstName && row.partecipantsData.lastName);
}

function getPassengerDetailsForFill(passengerDetails, detailGuids = []) {
  const hasProvidedDetails = passengerDetails && (
    (Array.isArray(passengerDetails.adults) && passengerDetails.adults.length) ||
    (Array.isArray(passengerDetails.children) && passengerDetails.children.length) ||
    passengerDetails.guide
  );
  if (hasProvidedDetails) return passengerDetails;

  const configuredParticipants = Array.isArray(config.participants) ? config.participants : [];
  const configuredAdults = configuredParticipants.filter((entry) => String(entry?.type || 'adult').toLowerCase() === 'adult').length;
  const configuredChildren = configuredParticipants.filter((entry) => String(entry?.type || '').toLowerCase() === 'child').length;
  const fallbackAdults = configuredAdults || Math.max(0, (Array.isArray(detailGuids) ? detailGuids.length : 0) - 1);
  return normalizePaymentPassengerDetails({}, fallbackAdults, configuredChildren);
}

function buildOrderedPassengerPeople(passengerDetails, detailGuids = []) {
  const details = getPassengerDetailsForFill(passengerDetails, detailGuids);
  const ordered = [
    ...(details.adults || []),
    ...(details.children || [])
  ];
  if (details.guide) ordered.push({ ...details.guide, type: 'guide' });
  return ordered.filter((person) => String(person.firstName || '').trim() && String(person.lastName || '').trim());
}

function isExtraDataSuccess(result) {
  if (!result || result.status < 200 || result.status >= 300) return false;
  const data = result.data;
  if (data === true) return true;
  if (data && typeof data === 'object') {
    if (data.success === true || data.status === 'success' || data.result === true) return true;
    if (data.success === false || data.error) return false;
  }
  const text = String(result.text || '').trim();
  if (!text) return false;
  return /"success"\s*:\s*true|success|ok/i.test(text) && !/"success"\s*:\s*false|error/i.test(text);
}

async function extractCheckoutPassengerContext(page) {
  return page.evaluate(() => {
    const uuidPattern = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/ig;
    const detailGuids = [];
    const addDetailGuid = (value) => {
      const text = String(value || '');
      const matches = text.match(uuidPattern) || [];
      for (const match of matches) {
        const guid = match.toLowerCase();
        if (!detailGuids.includes(guid)) detailGuids.push(guid);
      }
    };

    const reservationInput = document.querySelector('[name="reservation_guid"], input[name="reservation_guid"]');
    let reservationGuid = reservationInput?.value || '';
    const html = document.body?.innerHTML || '';
    if (!reservationGuid) {
      const reservationMatch = html.match(/reservation_guid["'\s:=]+([a-f0-9-]{24,})/i);
      reservationGuid = reservationMatch ? reservationMatch[1] : '';
    }

    for (const element of Array.from(document.querySelectorAll('input, textarea, select, [data-detail-guid], [data-guid]'))) {
      const name = element.getAttribute('name') || '';
      const id = element.getAttribute('id') || '';
      const dataDetail = element.getAttribute('data-detail-guid') || '';
      const dataGuid = element.getAttribute('data-guid') || '';
      if (dataDetail) addDetailGuid(dataDetail);
      if (/detail/i.test(`${name} ${id}`)) {
        addDetailGuid(`${name} ${id} ${dataGuid} ${element.value || ''}`);
      }
    }

    let match;
    const detailRegex = /detail_guid["'\]\s:=]+([a-f0-9-]{24,})/ig;
    while ((match = detailRegex.exec(html))) addDetailGuid(match[1]);

    const reservationLower = String(reservationGuid || '').toLowerCase();
    return {
      reservationGuid,
      detailGuids: detailGuids.filter((guid) => guid !== reservationLower)
    };
  }).catch(() => ({ reservationGuid: '', detailGuids: [] }));
}

async function fillVisibleCheckoutPassengerFields(page, detailGuids, passengerDetails) {
  const people = buildOrderedPassengerPeople(passengerDetails, detailGuids);
  if (!people.length) return false;

  const guide = people.find((person) => person.type === 'guide') || {};
  const result = await page.evaluate((rows, guideRow) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const setValue = (input, value) => {
      const proto = input instanceof window.HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    const metadata = (input) => {
      const escapeCss = window.CSS && window.CSS.escape ? window.CSS.escape : (value) => String(value).replace(/"/g, '\\"');
      const label = input.id ? document.querySelector(`label[for="${escapeCss(input.id)}"]`) : null;
      const parentText = input.closest('label, .form-group, .field, .control, .abc-form-row, li, p, div')?.innerText || '';
      return normalize([
        input.getAttribute('name'),
        input.getAttribute('id'),
        input.getAttribute('placeholder'),
        input.getAttribute('aria-label'),
        label?.innerText,
        parentText
      ].filter(Boolean).join(' '));
    };
    const kindOf = (input) => {
      const meta = metadata(input);
      if (/tesserino|licen[sz]a|license|card|numero|number/.test(meta)) return 'licenseNumber';
      if (/cognome|surname|last[\s_-]*name|lastname/.test(meta)) return 'lastName';
      if (/(^|[^a-z])nome([^a-z]|$)|first[\s_-]*name|firstname|nominativo/.test(meta)) return 'firstName';
      return '';
    };

    const inputs = Array.from(document.querySelectorAll('input, textarea'))
      .filter((input) => {
        const type = normalize(input.getAttribute('type') || 'text');
        return isVisible(input) && !['hidden', 'button', 'submit', 'reset', 'checkbox', 'radio'].includes(type);
      });
    let filled = 0;

    const licenseInputs = inputs.filter((input) => kindOf(input) === 'licenseNumber');
    if (guideRow?.licenseNumber) {
      for (const input of licenseInputs) {
        setValue(input, String(guideRow.licenseNumber || ''));
        filled++;
      }
    }

    const namedInputs = inputs.filter((input) => ['firstName', 'lastName'].includes(kindOf(input)));
    if (namedInputs.length >= 2) {
      let personIndex = 0;
      let activeIndex = -1;
      for (const input of namedInputs) {
        const kind = kindOf(input);
        if (personIndex >= rows.length && activeIndex < 0) break;
        if (kind === 'firstName') {
          const person = rows[personIndex];
          if (!person) continue;
          setValue(input, person.firstName);
          activeIndex = personIndex;
          filled++;
        } else if (kind === 'lastName') {
          const index = activeIndex >= 0 ? activeIndex : personIndex;
          const person = rows[index];
          if (!person) continue;
          setValue(input, person.lastName);
          filled++;
          personIndex = index + 1;
          activeIndex = -1;
        }
      }
      return { filled, strategy: 'labeled' };
    }

    const fallbackInputs = inputs.filter((input) => kindOf(input) !== 'licenseNumber');
    for (let i = 0; i < rows.length && i * 2 + 1 < fallbackInputs.length; i++) {
      setValue(fallbackInputs[i * 2], rows[i].firstName);
      setValue(fallbackInputs[i * 2 + 1], rows[i].lastName);
      filled += 2;
    }
    return { filled, strategy: 'paired' };
  }, people, guide).catch((error) => ({ filled: 0, strategy: 'failed', error: error.message }));

  if (result.filled > 0) {
    log('PAYMENT', `[PAYMENT] passenger_dom_fill_done fields=${result.filled} strategy=${result.strategy}`);
    return true;
  }

  log('PAYMENT', `[PAYMENT] passenger_dom_fill_failed strategy=${result.strategy || 'none'} error="${result.error || ''}"`);
  return false;
}

async function fillPaymentPassengerDetails(page, detailGuids, passengerDetails) {
  const checkoutContext = await extractCheckoutPassengerContext(page);
  const inputGuids = Array.isArray(detailGuids) ? detailGuids.filter(Boolean) : [];
  const sourceGuids = checkoutContext.detailGuids.length >= inputGuids.length
    ? checkoutContext.detailGuids
    : inputGuids;
  const data = buildPassengerDataForDetails(sourceGuids, passengerDetails);
  if (!data.length) {
    log('WARN', '[PAYMENT] passenger_fill_skipped reason=no_valid_passenger_data');
    return await fillVisibleCheckoutPassengerFields(page, sourceGuids, passengerDetails);
  }

  log('PAYMENT', `[PAYMENT] passenger_fill_started count=${data.length} reservation=${checkoutContext.reservationGuid ? 'yes' : 'no'} detailGuids=${sourceGuids.length}`);
  const result = await page.evaluate(async (jsonData, knownReservationGuid) => {
    const getReservationGuid = () => {
      const input = document.querySelector('[name="reservation_guid"], input[name="reservation_guid"]');
      if (input && input.value) return input.value;
      const html = document.body?.innerHTML || '';
      const match = html.match(/reservation_guid["'\s:=]+([a-f0-9-]{24,})/i);
      return match ? match[1] : '';
    };

    try {
      const body = new URLSearchParams();
      body.set('action', 'midaabc_set_extradata');
      body.set('data', JSON.stringify(jsonData));
      const reservationGuid = knownReservationGuid || getReservationGuid();
      if (reservationGuid) body.set('reservation_guid', reservationGuid);

      const res = await fetch('/mtajax/set_extradata', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': '*/*',
          'Origin': window.location.origin,
          'Referer': window.location.href
        },
        body: body.toString()
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      return { status: res.status, data: parsed, text: text.substring(0, 500) };
    } catch (error) {
      return { status: 500, data: null, text: error.message };
    }
  }, data, checkoutContext.reservationGuid || '').catch((error) => ({ status: 500, data: null, text: error.message }));

  if (isExtraDataSuccess(result)) {
    log('PAYMENT', `[PAYMENT] passenger_fill_done count=${data.length}`);
    return true;
  }

  log('PAYMENT', `[PAYMENT] passenger_fill_failed status=${result.status} body=${String(result.text || '').substring(0, 240)}`);
  return await fillVisibleCheckoutPassengerFields(page, sourceGuids, passengerDetails);
}

function startTelegramListener() {
  log('INFO', 'Legacy per-node Telegram listener disabled. Use the read-only control-center bot on the coordinator.');
  return;

  const botToken = config.telegram?.tokens?.[NODE_ID];
  const chatId = config.telegram?.chatId !== undefined && config.telegram?.chatId !== null ? String(config.telegram.chatId) : '';
  if (!botToken || !chatId) {
    log('WARN', 'Telegram listener disabled: missing token or chatId');
    return;
  }

  try {
    telegramBotInstance = null;

    telegramBotInstance.on('message', (msg) => {
      if (String(msg.chat?.id || '') !== chatId) return;
      if (msg.from && msg.from.is_bot) return;
      const text = (msg.text || '').trim().toLowerCase();
      const command = text.split(/\s+/)[0].replace(/@[^\s]+$/, '');
      const nodeTag = NODE_ID;  // e.g. "20"
      const acceptPlainPay = process.env.TELEGRAM_ACCEPT_PLAIN_PAY === '1' || config.telegram?.acceptPlainPay === true;

      // /pay{N} or /checkout{N}; plain /pay only when explicitly enabled.
      if (command === `/pay${nodeTag}` || command === `/checkout${nodeTag}` || (acceptPlainPay && command === '/pay')) {
        if (holdModeActive && cartItemsInfo) {
          const qty = getCartItemsNonGuideQty(cartItemsInfo) || '?';
          payDialogActive = true;
          payDialogOwnerId = msg.from?.id || null;
          payDialogStartedAtMs = Date.now();
          log('СЂСџвЂ™С–', `/pay${nodeTag} Р С—Р С•Р В»РЎС“РЎвЂЎР ВµР Р…! Р РЋР С—РЎР‚Р В°РЎв‚¬Р С‘Р Р†Р В°Р ВµР С Р С”Р С•Р В»Р С‘РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С• (${qty} Intero Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ)...`);
          notifyTelegram(`СЂСџР‹В« Р вЂўРЎРѓРЎвЂљРЎРЉ ${qty} Р В±Р С‘Р В»Р ВµРЎвЂљР С•Р Р† + 1 Р С–Р С‘Р Т‘.\nР РЋР С”Р С•Р В»РЎРЉР С”Р С• Р Р…РЎС“Р В¶Р Р…Р С•?\n\nР С›РЎвЂљР Р†Р ВµРЎвЂљРЎРЉРЎвЂљР Вµ: [Р Р†Р В·РЎР‚Р С•РЎРѓР В»РЎвЂ№РЎвЂ¦] + [Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦]\nР СњР В°Р С—РЎР‚Р С‘Р СР ВµРЎР‚: 9 + 3\nР ВР В»Р С‘ Р С—РЎР‚Р С•РЎРѓРЎвЂљР С•: 15`);
          notifyTelegram(`Rule: minimum ${MIN_PAYMENT_PARTICIPANTS + GUIDE_PAYMENT_QTY} tickets total including guide. Adults can be 0+, for example: 1 + 7.`);
        } else if (holdModeActive) {
          payCommandReceived = true;
          log('СЂСџвЂ™С–', `/pay${nodeTag} Р С—Р С•Р В»РЎС“РЎвЂЎР ВµР Р…! Р СџР ВµРЎР‚Р ВµРЎвЂ¦Р С•Р Т‘Р С‘Р С Р С” Р С•Р С—Р В»Р В°РЎвЂљР Вµ (Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ Р С• Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ)...`);
          notifyTelegram('СЂСџвЂ™С– Р СџР ВµРЎР‚Р ВµРЎвЂ¦Р С•Р Т‘Р С‘Р С Р С” Р С•Р С—Р В»Р В°РЎвЂљР Вµ...');
        } else {
          notifyTelegram('РІвЂћв„–РїС‘РЏ Hold Mode Р Р…Р Вµ Р В°Р С”РЎвЂљР С‘Р Р†Р ВµР Р…. Р вЂР С‘Р В»Р ВµРЎвЂљРЎвЂ№ Р ВµРЎвЂ°РЎвЂ Р Р…Р Вµ Р С—Р С•Р в„–Р СР В°Р Р…РЎвЂ№.');
        }
      }

      // РІвЂўС’РІвЂўС’РІвЂўС’ Р С›Р В±РЎР‚Р В°Р В±Р С•РЎвЂљР С”Р В° Р С•РЎвЂљР Р†Р ВµРЎвЂљР В° Р Р…Р В° /pay Р Т‘Р С‘Р В°Р В»Р С•Р С– (РЎвЂћР С•РЎР‚Р СР В°РЎвЂљ: "9 + 3" Р С‘Р В»Р С‘ "15") РІвЂўС’РІвЂўС’РІвЂўС’
      // Р СћР С•Р В»РЎРЉР С”Р С• Р В±Р С•РЎвЂљ РЎРѓ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р С Р Т‘Р С‘Р В°Р В»Р С•Р С–Р С•Р С Р С•Р В±РЎР‚Р В°Р В±Р В°РЎвЂљРЎвЂ№Р Р†Р В°Р ВµРЎвЂљ
      if (payDialogActive && !text.startsWith('/')) {
        if (payDialogOwnerId !== null && msg.from?.id !== payDialogOwnerId) return;
        if (payDialogStartedAtMs && Date.now() - payDialogStartedAtMs > 5 * 60 * 1000) {
          payDialogActive = false;
          payDialogOwnerId = null;
          payDialogStartedAtMs = 0;
          notifyTelegram('Payment dialog expired. Send /pay again.');
          return;
        }
        const match = text.match(/^(\d+)\s*(?:\+\s*(\d+))?$/);
        if (match) {
          const adults = parseInt(match[1]);
          const children = match[2] ? parseInt(match[2]) : 0;
          const currentQty = getCartItemsNonGuideQty(cartItemsInfo);

          const validationError = getPaymentQuantityValidationError(adults, children, currentQty);
          if (validationError) {
            notifyTelegram(`Payment error: ${validationError.message}. Minimum is ${MIN_PAYMENT_PARTICIPANTS + GUIDE_PAYMENT_QTY} tickets total including guide; adults can be 0+.`);
            return;
          }

          if (adults + children > currentQty) {
            notifyTelegram(`РІС™В РїС‘РЏ Р вЂ™РЎРѓР ВµР С–Р С• Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ ${currentQty}. ${adults}+${children}=${adults + children} > ${currentQty}. Р СџР С•Р С—РЎР‚Р С•Р В±РЎС“Р в„–РЎвЂљР Вµ Р ВµРЎвЂ°РЎвЂ РЎР‚Р В°Р В·.`);
            return;
          }

          payDialogActive = false;
          payDialogOwnerId = null;
          payDialogStartedAtMs = 0;
          payDesiredAdults = adults;
          payDesiredChildren = children;
          payCommandReceived = true;

          const summary = children > 0
            ? `СЂСџвЂ™С– Р СџРЎР‚Р С‘Р Р…РЎРЏРЎвЂљР С•: ${adults} Р Р†Р В·РЎР‚Р С•РЎРѓР В»РЎвЂ№РЎвЂ¦ + ${children} Р Т‘Р ВµРЎвЂљРЎРѓР С”Р С‘РЎвЂ¦ + 1 Р С–Р С‘Р Т‘ = ${adults + children + 1} Р В±Р С‘Р В»Р ВµРЎвЂљР С•Р Р†`
            : `СЂСџвЂ™С– Р СџРЎР‚Р С‘Р Р…РЎРЏРЎвЂљР С•: ${adults} Р Р†Р В·РЎР‚Р С•РЎРѓР В»РЎвЂ№РЎвЂ¦ + 1 Р С–Р С‘Р Т‘ = ${adults + 1} Р В±Р С‘Р В»Р ВµРЎвЂљР С•Р Р†`;
          log('СЂСџвЂ™С–', summary);
          notifyTelegram(summary + '\nРІРЏС– Р СљР С•Р Т‘Р С‘РЎвЂћР С‘РЎвЂ Р С‘РЎР‚РЎС“РЎР‹ Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎС“...');
        } else {
          notifyTelegram('РІС™В РїС‘РЏ Р СњР ВµР Р†Р ВµРЎР‚Р Р…РЎвЂ№Р в„– РЎвЂћР С•РЎР‚Р СР В°РЎвЂљ. Р С›РЎвЂљР Р†Р ВµРЎвЂљРЎРЉРЎвЂљР Вµ: 9 + 3 Р С‘Р В»Р С‘ 15');
        }
      }

      // РІвЂўС’РІвЂўС’РІвЂўС’ /hold{N} РІвЂўС’РІвЂўС’РІвЂўС’
      if (text === `/hold${nodeTag}`) {
        if (config.application.holdMode) {
          config.application.holdMode = false;
          log('СЂСџвЂ™С–', `/hold${nodeTag} РІвЂ вЂ™ Hold Mode Р вЂ™Р В«Р С™Р вЂєР В®Р В§Р вЂўР Сњ.`);
          notifyTelegram('СЂСџвЂ™С– Hold Mode Р вЂ™Р В«Р С™Р вЂєР В®Р В§Р вЂўР Сњ. Р РЋР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р С‘Р в„– catch РІвЂ вЂ™ Р С•Р С—Р В»Р В°РЎвЂљР В°.');
        } else {
          config.application.holdMode = true;
          log('СЂСџвЂќвЂћ', `/hold${nodeTag} РІвЂ вЂ™ Hold Mode Р вЂ™Р С™Р вЂєР В®Р В§Р вЂўР Сњ.`);
          notifyTelegram('СЂСџвЂќвЂћ Hold Mode Р вЂ™Р С™Р вЂєР В®Р В§Р вЂўР Сњ. Catch-and-release Р В°Р С”РЎвЂљР С‘Р Р†Р С‘РЎР‚Р С•Р Р†Р В°Р Р….');
        }
      }

      // РІвЂўС’РІвЂўС’РІвЂўС’ /status{N} РІвЂўС’РІвЂўС’РІвЂўС’
      if (text === `/status${nodeTag}`) {
        const proxySt = isCurrentProxyBanned() ? `Р В·Р В°Р В±Р В°Р Р…Р ВµР Р… (${Math.ceil(Math.max(0, getProxyUnavailableUntil(currentProxyIndex, getNodeProxies()[currentProxyIndex]) - Date.now()) / 60000)} Р СР С‘Р Р…)` : 'Р С›Р С™';
        const holdSt = holdModeActive ? 'Р С’Р С™Р СћР ВР вЂ™Р вЂўР Сњ (Р В±Р С‘Р В»Р ВµРЎвЂљРЎвЂ№ Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ)' : (config.application.holdMode ? 'Р С•Р В¶Р С‘Р Т‘Р В°Р ВµРЎвЂљ catch' : 'Р вЂ™Р В«Р С™Р вЂє');
        const pauseSt = pausedUntilMs > Date.now() ? `Р С—Р В°РЎС“Р В·Р В° ${Math.ceil((pausedUntilMs - Date.now()) / 60000)} Р СР С‘Р Р…` : 'РЎР‚Р В°Р В±Р С•РЎвЂљР В°Р ВµРЎвЂљ';
        notifyTelegram(`СЂСџвЂњР‰ Р РЋРЎвЂљР В°РЎвЂљРЎС“РЎРѓ:\nСЂСџРЉС’ Р СџРЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex}: ${proxySt}\nСЂСџвЂќвЂћ Hold: ${holdSt}\nРІРЏВ± Р В¦Р С‘Р С”Р В»: ${pauseSt}\nСЂСџвЂњР‰ Calendar: ${calendarRequestCount}/48`);
      }
    });

    telegramBotInstance.on('polling_error', () => { }); // Р СћР С‘РЎвЂ¦Р С• Р С–Р В»Р С•РЎвЂљР В°Р ВµР С Р С•РЎв‚¬Р С‘Р В±Р С”Р С‘ polling
    log('СЂСџвЂњРЋ', `Telegram listener Р В·Р В°Р С—РЎС“РЎвЂ°Р ВµР Р… (/pay${NODE_ID}, /hold${NODE_ID}, /status${NODE_ID})`);
  } catch (e) {
    log('РІС™В РїС‘РЏ', `Telegram listener Р Р…Р Вµ РЎС“Р Т‘Р В°Р В»Р С•РЎРѓРЎРЉ Р В·Р В°Р С—РЎС“РЎРѓРЎвЂљР С‘РЎвЂљРЎРЉ: ${e.message}`);
  }
}

async function main() {
  registerProxyRelayCleanupHandlers();
  console.log('РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’');
  console.log('  СЂСџРЏвЂєРїС‘РЏ  COLOSSEUM TICKET SNIPER v3.2 (OSPC + WAF Fix)');
  console.log('РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’');
  console.log(`  СЂСџвЂќвЂ” Server Node: ${NODE_ID}`);
  console.log(`  СЂСџР‹Р‡ Targets: ${config.targets.length} url Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р ВµР Р…Р С•.`);
  const startupScheduler = getSchedulerState();
  console.log(`  SCHEDULER: strict_grid cycle=${startupScheduler.cycleMs}ms active=${startupScheduler.slotCount} step=${startupScheduler.slotMs.toFixed(0)}ms node=${startupScheduler.nodeId} slot=${startupScheduler.active ? `${startupScheduler.slotIndex + 1}/${startupScheduler.slotCount}` : 'inactive'} extra_retry=false`);
  console.log('  Browser: persistent proxy profile per proxy');
  console.log(`  Profile root: ${PROXY_PROFILE_ROOT}`);
  console.log(`  429 Calendar: rotate after ${LEGACY_CALENDAR_429_ROTATE_AFTER} consecutive per proxy; local cooldown ${Math.ceil(CALENDAR_429_COOLDOWN_MS / 60000)}m`);
  console.log(`  Page WAF: fail_closed=${PAGE_WAF_FAIL_CLOSED_ENABLED ? 'on' : 'off'} cooldown=${Math.ceil(PAGE_WAF_FAIL_CLOSED_BACKOFF_MS / 60000)}m static_fallback=${STATIC_CALENDAR_PAYLOAD_ENABLED ? 'on' : 'off'}`);
  const nodeProxies = getNodeProxies();
  if (nodeProxies.length > 0) {
    console.log(`  Proxies: ${nodeProxies.length} configured; connect_fail cooldown ${Math.ceil(CONNECT_FAIL_COOLDOWN_MS / 60000)}m`);
    console.log(`  All-proxies fast probe: ${ALL_PROXIES_BANNED_FAST_PROBE_ENABLED ? 'enabled' : 'disabled'}; probe_all=${ALL_PROXIES_BANNED_FAST_PROBE_ALL ? 'yes' : 'no'}`);
    console.log(`  Strategy: calendar_waf_403 -> cooldown ${Math.ceil(CALENDAR_WAF_403_COOLDOWN_MS / 60000)}m; calendar429 -> ${Math.ceil(CALENDAR_429_COOLDOWN_MS / 60000)}m; connect_fail -> ${Math.ceil(CONNECT_FAIL_COOLDOWN_MS / 60000)}m`);
    console.log(`  Checkout: reload_after_manual_login=${CHECKOUT_RELOAD_AFTER_LOGIN_ENABLED ? 'on' : 'off'} manual_timeout=${MANUAL_CHECKOUT_MAX_MINUTES}m`);
  } else {
    console.log(`  СЂСџРЉС’ Р СџРЎР‚Р С•Р С”РЎРѓР С‘: Р СњР вЂўР Сћ (Р С—РЎР‚РЎРЏР СР С•Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘Р Вµ)`);
  }
  console.log('РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’\n');

  // Р вЂ”Р В°Р С–РЎР‚РЎС“Р В¶Р В°Р ВµР С РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎвЂР Р…Р Р…РЎвЂ№Р в„– Р В±Р В°Р Р…-РЎРѓРЎвЂљР ВµР в„–РЎвЂљ РЎРѓ Р Т‘Р С‘РЎРѓР С”Р В° (Р ВµРЎРѓР В»Р С‘ Р В±Р С•РЎвЂљ Р С—Р ВµРЎР‚Р ВµР В·Р В°Р С—РЎС“РЎРѓРЎвЂљР С‘Р В»РЎРѓРЎРЏ Р Р†Р С• Р Р†РЎР‚Р ВµР СРЎРЏ Р В±Р В°Р Р…Р В°)
  if (nodeProxies.length > 0) {
    cleanupAllProxyRelays('startup');
  }

  loadBanState();
  loadProxyReputation();

  // РІвЂўС’РІвЂўС’РІвЂўС’ Р вЂњР С›Р В Р Р‡Р В§Р С’Р Р‡ Р СџР вЂўР В Р вЂўР вЂ”Р С’Р вЂњР В Р Р€Р вЂ”Р С™Р С’ Р С™Р С›Р СњР В¤Р ВР вЂњР С’ (Р С”Р В°Р В¶Р Т‘РЎвЂ№Р Вµ 5 Р СР С‘Р Р…РЎС“РЎвЂљ) РІвЂўС’РІвЂўС’РІвЂўС’
  // Р С›Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµРЎвЂљ target_date, datetime window, time_range, holdMode, nodeOverrides Р В±Р ВµР В· Р С—Р ВµРЎР‚Р ВµР В·Р В°Р С—РЎС“РЎРѓР С”Р В° Р В±Р С•РЎвЂљР В°
  const CONFIG_PATH = require('path').join(__dirname, '..', 'config.json');
  const CONFIG_RELOAD_POLL_MS = 15000;
  let lastConfigMtime = 0;
  let hotReloadInProgress = false;
  function hotReloadConfig(reason = 'poll') {
    if (hotReloadInProgress) return false;
    try {
      hotReloadInProgress = true;
      const stat = fs.statSync(CONFIG_PATH);
      const mtime = stat.mtimeMs;
      if (reason === 'poll' && mtime <= lastConfigMtime) return false;
      lastConfigMtime = mtime;
      const fresh = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      config.configMeta = fresh.configMeta || config.configMeta || {};
      if (fresh.application) {
        config.application.holdMode = fresh.application.holdMode;
        config.application.mode = fresh.application.mode;
      }
      if (fresh.scheduler) config.scheduler = fresh.scheduler;
      if (fresh.targets) config.targets = fresh.targets;
      if (fresh.nodeOverrides) config.nodeOverrides = fresh.nodeOverrides;
      if (fresh.participants) config.participants = fresh.participants;

      const context = getCurrentTargetContext();
      log('СЂСџвЂќвЂћ', `[HOT RELOAD] version=${context.version} reason=${reason} mode=${context.mode} hold=${config.application.holdMode ? 'on' : 'off'} window=${formatTargetWindowForLog(context.target)}`);
      return true;
    } catch (e) {
      log('РІС™В РїС‘РЏ', `[HOT RELOAD] Р С›РЎв‚¬Р С‘Р В±Р С”Р В° РЎвЂЎРЎвЂљР ВµР Р…Р С‘РЎРЏ Р С”Р С•Р Р…РЎвЂћР С‘Р С–Р В° (reason=${reason}): ${e.message}`);
      return false;
    } finally {
      hotReloadInProgress = false;
    }
  }
  process.on('SIGUSR1', () => {
    hotReloadConfig('signal');
  });
  hotReloadConfig('startup');
  setInterval(() => hotReloadConfig('poll'), CONFIG_RELOAD_POLL_MS);
  startProxyLeaseRefreshTimer();

  // Р ВР Р…Р С‘РЎвЂ Р С‘Р В°Р В»Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ Р С—Р ВµРЎР‚Р Р†Р С•Р С–Р С• Р С—РЎР‚Р С•Р С”РЎРѓР С‘ (РЎРѓ РЎС“РЎвЂЎРЎвЂРЎвЂљР С•Р С Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р ВµР Р…Р Р…Р С•Р С–Р С• РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘РЎРЏ)
  if (nodeProxies.length > 0) {
    const savedProxyIndex = currentProxyIndex;
    const startupProxyIndex = getStartupProxyIndex(nodeProxies.length);
    currentProxyIndex = startupProxyIndex;
    if (savedProxyIndex !== startupProxyIndex) {
      log('СЂСџРЉС’', `Р РЋРЎвЂљР В°РЎР‚РЎвЂљР С•Р Р†РЎвЂ№Р в„– reseed Р С—РЎР‚Р С•Р С”РЎРѓР С‘: #${savedProxyIndex} РІвЂ вЂ™ #${startupProxyIndex} (seeded by node/window)`);
    }

    // Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С, Р Р…Р Вµ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р… Р В»Р С‘ Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р ВµР Р…Р Р…РЎвЂ№Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘ РІР‚вЂќ Р ВµРЎРѓР В»Р С‘ Р Т‘Р В°, Р С‘РЎвЂ°Р ВµР С РЎРѓР Р†Р С•Р В±Р С•Р Т‘Р Р…РЎвЂ№Р в„–
    if (isCurrentProxyBanned()) {
      const startupUnbanned = findUnbannedProxyFrom(startupProxyIndex);
      if (startupUnbanned !== null) {
        currentProxyIndex = startupUnbanned;
        currentProxy = nodeProxies[currentProxyIndex];
        saveBanState();
        log('СЂСџРЉС’', `Р РЋРЎвЂљР В°РЎР‚РЎвЂљР С•Р Р†РЎвЂ№Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р С—Р С•РЎРѓР В»Р Вµ reseed: #${currentProxyIndex} (${currentProxy.host}:${currentProxy.port})`);
      } else {
        const hasUnbanned = switchProxy('Startup: seeded proxy is banned');
        if (!hasUnbanned) {
          log('РІС™В РїС‘РЏ', `Р вЂ™РЎРѓР Вµ Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…РЎвЂ№ Р С—РЎР‚Р С‘ РЎРѓРЎвЂљР В°РЎР‚РЎвЂљР Вµ. Р СњР В°РЎвЂЎР Р…РЎвЂР С РЎРѓ Р Р…Р В°Р С‘Р СР ВµР Р…Р С‘Р Вµ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…Р Р…Р С•Р С–Р С•.`);
        }
      }
    } else {
      currentProxy = nodeProxies[currentProxyIndex];
      saveBanState();
      log('СЂСџРЉС’', `Р РЋРЎвЂљР В°РЎР‚РЎвЂљР С•Р Р†РЎвЂ№Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘: #${currentProxyIndex} (${currentProxy.host}:${currentProxy.port})`);
    }
  }

  // Р В Р ВµР В¶Р С‘Р С Р Р…Р С•Р Т‘РЎвЂ№: Р С—Р С• РЎС“Р СР С•Р В»РЎвЂЎР В°Р Р…Р С‘РЎР‹ "underground", Р СР С•Р В¶Р Р…Р С• Р С—Р ВµРЎР‚Р ВµР С•Р С—РЎР‚Р ВµР Т‘Р ВµР В»Р С‘РЎвЂљРЎРЉ РЎвЂЎР ВµРЎР‚Р ВµР В· nodeOverrides Р Р† config.json
  const nodeOverride = getCurrentNodeOverride();
  const targetType = getCurrentTargetType();
  const activeMode = targetType.charAt(0).toUpperCase() + targetType.slice(1);
  const isHoldMode = config.application.holdMode || false;
  console.log(`  СЂСџР‹Р‡ Р В Р ВµР В¶Р С‘Р С Р Р…Р С•Р Т‘РЎвЂ№: ${activeMode}`);
  console.log(`  СЂСџвЂќвЂћ Hold Mode: ${isHoldMode ? 'Р вЂ™Р С™Р вЂє (catch-and-release)' : 'Р вЂ™Р В«Р С™Р вЂє (checkout)'}`);

  // Р В Р В°РЎРѓРЎв‚¬Р С‘РЎР‚Р ВµР Р…Р Р…Р С•Р Вµ РЎРѓРЎвЂљР В°РЎР‚РЎвЂљР С•Р Р†Р С•Р Вµ РЎС“Р Р†Р ВµР Т‘Р С•Р СР В»Р ВµР Р…Р С‘Р Вµ
  const participants = config.participants || [];
  const adults = participants.filter(p => p.type === 'adult').length;
  const children = participants.filter(p => p.type === 'child').length;
  const guide = participants.find(p => p.type === 'guide');
  const activeTarget = buildEffectiveTarget(config.targets.find(t => t.type === targetType), nodeOverride, { logRolling: false });
  const dateStr = activeTarget ? formatTargetWindowForLog(activeTarget) : '?';
  const ticketTotal = activeTarget ? activeTarget.tickets.reduce((s, t) => s + t.quantity, 0) : '?';

  let startupMsg = `СЂСџС™Р‚ Р вЂ”Р В°Р С—РЎС“РЎвЂ°Р ВµР Р… (РЎР‚Р ВµР В¶Р С‘Р С: ${activeMode})`;
  if (participants.length > 0) {
    startupMsg += `\nСЂСџР‹В« Р вЂР С‘Р В»Р ВµРЎвЂљРЎвЂ№: ${adults} Р Р†Р В·РЎР‚ + ${children} Р Т‘Р ВµРЎвЂљ + 1 Р С–Р С‘Р Т‘ = ${ticketTotal}`;
    startupMsg += `\nСЂСџвЂњвЂ¦ ${dateStr}`;
    startupMsg += `\nСЂСџвЂќвЂћ Hold: ${isHoldMode ? 'Р вЂ™Р С™Р вЂє' : 'Р вЂ™Р В«Р С™Р вЂє'}`;
  }
  // Startup notification РЎС“Р В±РЎР‚Р В°Р Р… Р С—Р С• Р В·Р В°Р С—РЎР‚Р С•РЎРѓРЎС“ РІР‚вЂќ Р Р…Р Вµ РЎРѓР С—Р В°Р СР С‘РЎвЂљРЎРЉ Telegram
  // await notifyTelegram(startupMsg);

  // Р вЂ”Р В°Р С—РЎС“РЎРѓР С”Р В°Р ВµР С Telegram listener Р Т‘Р В»РЎРЏ Р С”Р С•Р СР В°Р Р…Р Т‘ /pay, /hold, /status
  startTelegramListener();

  let browser, page;
  let consecutiveErrors = 0;
  let firstSchedulerWait = process.env.RDP_SYNC_RESTART === '1' ? false : true;
  if (process.env.RDP_SYNC_RESTART === '1') {
    log('SCHEDULER', '[SCHEDULER] rdp_sync_restart open_browser_without_initial_grid_wait=true');
  }

  while (true) {
    try {
      // РІвЂўС’РІвЂўС’РІвЂўС’ Epoch Grid: Р В°Р В±РЎРѓР С•Р В»РЎР‹РЎвЂљР Р…Р В°РЎРЏ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ Р С—Р С• Р СР С‘РЎР‚Р С•Р Р†РЎвЂ№Р С РЎвЂЎР В°РЎРѓР В°Р С РІвЂўС’РІвЂўС’РІвЂўС’
      const nowMs = Date.now();
      checkAndLogStats();
      syncProxyBanStateFromDisk();
      cleanupExpiredProxyBans(nowMs);
      if (!isSchedulerNodeActive()) {
        await waitForNextPoll();
        continue;
      }
      if (firstSchedulerWait) {
        firstSchedulerWait = false;
        const readyForFirstPoll = await waitForNextPoll();
        if (readyForFirstPoll === false) continue;
      }

      if (isGlobalWafPauseActive(nowMs)) {
        const remainingSec = Math.ceil(getGlobalWafPauseRemainingMs(nowMs) / 1000);
        log('WARN', `[WAF] global circuit breaker pause active remaining_sec=${remainingSec}`);
        if (page) await performWarmup(page).catch(() => {});
        await waitForNextPoll();
        continue;
      }
      if (globalWafPauseUntilMs > 0 && nowMs >= globalWafPauseUntilMs) {
        globalWafPauseUntilMs = 0;
        globalWafEvents.length = 0;
        log('OK', '[WAF] global circuit breaker pause ended; resume polling');
      }

      // ALL PROXIES BANNED: do not enter frequent pressure mode; sleep 10m, then quickly probe the pool.
      if (!isSharedProxyPoolActiveForNode()) {
        const proxiesForAllBanCheck = getNodeProxies();
        const activeBannedIndexes = getActiveProxyBanIndexes(nowMs);
        const allProxiesAreBanned = proxiesForAllBanCheck.length > 0 && activeBannedIndexes.length >= proxiesForAllBanCheck.length;

        if (allProxiesBannedProbePending && allProxiesBannedSleepUntilMs > 0 && nowMs >= allProxiesBannedSleepUntilMs) {
          if (!ALL_PROXIES_BANNED_FAST_PROBE_ENABLED) {
            allProxiesBannedSleepUntilMs = 0;
            allProxiesBannedProbePending = false;
            cleanupExpiredProxyBans(Date.now());

            const unbannedAfterWait = findUnbannedProxyFrom(currentProxyIndex + 1);
            if (unbannedAfterWait !== null) {
              selectCurrentProxy(unbannedAfterWait);
              global.lastBanCheckMs = Date.now();
              consecutiveErrors = 2;
              clearAllCalendarPayloadCaches('all proxies banned cooldown expired');
              log('OK', `[PROXY BAN] all-proxies sleep ended; fast_probe=disabled usable proxy #${currentProxyIndex}; resume polling`);
              await waitForNextPoll();
              continue;
            }

            scheduleAllProxiesBannedSleep(Date.now(), 'fast_probe_disabled_no_usable_proxy');
            selectCurrentProxy(findEarliestUnbanProxy());
            log('WARN', '[PROXY BAN] all-proxies sleep ended; fast_probe=disabled no usable proxies; waiting for cooldown expiry');
            await waitForNextPoll();
            continue;
          }

          if (browser) {
            await closeBrowserAndFlushProxyReleases(browser, 'all_proxies_banned_probe_round');
            browser = null;
            page = null;
          }

          const probeIndexes = ALL_PROXIES_BANNED_FAST_PROBE_ALL ? getAllProxyIndexes() : activeBannedIndexes;
          log('PROXY', `[PROXY BAN] all-proxies sleep ended; fast probe starting checked_pool=${probeIndexes.length}`);
          allProxiesBannedSleepUntilMs = 0;
          allProxiesBannedProbePending = false;
          const probeRoundResult = await runProxyBanProbeRound(probeIndexes, { quick: true, force: true, reason: 'all_proxies_banned_after_sleep' });
          cleanupExpiredProxyBans(Date.now());

          const unbannedAfterAllProbe = findUnbannedProxyFrom(currentProxyIndex + 1);
          if (unbannedAfterAllProbe !== null) {
            selectCurrentProxy(unbannedAfterAllProbe);
            global.lastBanCheckMs = Date.now();
            consecutiveErrors = 2;
            clearAllCalendarPayloadCaches('all proxies banned fast probe cleared');
            log('OK', `[PROXY BAN] fast probe found usable proxy #${currentProxyIndex}; resume polling checked=${probeRoundResult.checked} cleared=${probeRoundResult.cleared}`);
            await waitForNextPoll();
            continue;
          }

          scheduleAllProxiesBannedSleep(Date.now(), 'fast_probe_no_usable_proxy');
          selectCurrentProxy(findEarliestUnbanProxy());
          log('WARN', `[PROXY BAN] fast probe found no usable proxies checked=${probeRoundResult.checked}; sleeping again`);
          await waitForNextPoll();
          continue;
        }

        if (allProxiesAreBanned) {
          if (browser) {
            await closeBrowserAndFlushProxyReleases(browser, 'all_proxies_banned_sleep');
            browser = null;
            page = null;
          }
          const sleepUntil = scheduleAllProxiesBannedSleep(nowMs, 'all_active_proxy_bans');
          const remainingSec = Math.ceil(Math.max(0, sleepUntil - nowMs) / 1000);
          log('WARN', `[PROXY BAN] all proxies banned; sleep active remaining_sec=${remainingSec} banned=${activeBannedIndexes.length}/${proxiesForAllBanCheck.length}`);
          await waitForNextPoll();
          continue;
        }

        if (!allProxiesAreBanned && (allProxiesBannedSleepUntilMs > 0 || allProxiesBannedProbePending)) {
          clearAllProxiesBannedSleep('some_proxy_available');
        }
      }

      // РІвЂўС’РІвЂўС’РІвЂўС’ PROXY BAN CHECK: Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С Р В±Р В°Р Р… РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР С–Р С• Р С—РЎР‚Р С•Р С”РЎРѓР С‘ РІвЂўС’РІвЂўС’РІвЂўС’
      if (IN_BOT_PROXY_BAN_PROBES) {
      const proxyBanProbeStateEveryCycle = getProxyBanProbeState(Date.now());
      if (proxyBanProbeStateEveryCycle.due && proxyBanProbeStateEveryCycle.banned.length > 0) {
        const originalProxyIndex = currentProxyIndex;
        if (browser) await closeBrowserAndFlushProxyReleases(browser, 'proxy_ban_probe_round');
        browser = null;
        page = null;

        const probeRoundResult = await runProxyBanProbeRound(proxyBanProbeStateEveryCycle.banned);
        cleanupExpiredProxyBans(Date.now());

        const unbannedAfterProbe = findUnbannedProxyFrom(originalProxyIndex);
        if (unbannedAfterProbe !== null) {
          selectCurrentProxy(unbannedAfterProbe);
        } else {
          selectCurrentProxy(findEarliestUnbanProxy());
        }

        global.lastBanCheckMs = Date.now();
        consecutiveErrors = 2;
        clearAllCalendarPayloadCaches('proxy ban probe round');
        log('SCHEDULER', `[SCHEDULER] proxy_ban_probe_round_done checked=${probeRoundResult.checked} cleared=${probeRoundResult.cleared} wait_next_slot=true`);
        try {
          if (!browser) {
            const opened = await openPollingBrowserForCurrentProxy();
            browser = opened.browser;
            page = opened.page;
            log('SCHEDULER', '[SCHEDULER] visible_browser_reopened_before_slot reason=proxy_ban_probe_round');
          }
        } catch (error) {
          log('WARN', `[SCHEDULER] visible_browser_reopen_failed reason=proxy_ban_probe_round error="${error.message}"`);
          browser = null;
          page = null;
        }
        const readyAfterProbe = await waitForNextPoll();
        if (readyAfterProbe === false) continue;
      }
      }

      if (isCurrentProxyBanned()) {
        // Р СћР ВµР С”РЎС“РЎвЂ°Р С‘Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р… РІР‚вЂќ Р С‘РЎвЂ°Р ВµР С РЎРѓР Р†Р С•Р В±Р С•Р Т‘Р Р…РЎвЂ№Р в„–
        // Close current browser/relay BEFORE switchProxy(), otherwise cleanup can target the new proxy index.
        if (browser) {
          await closeBrowserAndFlushProxyReleases(browser, 'current_proxy_banned_close');
          browser = null;
          page = null;
        }
        const hasUnbanned = switchProxy('Cycle: current proxy banned');
        if (hasUnbanned) {
          // Р СњР В°РЎв‚¬Р В»Р С‘ РЎРѓР Р†Р ВµР В¶Р С‘Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘ РІвЂ вЂ™ Р С—Р ВµРЎР‚Р ВµРЎРѓР С•Р В·Р Т‘Р В°РЎвЂР С Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚
          log('СЂСџвЂќвЂћ', `Р СџР ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР С‘Р В»Р С‘РЎРѓРЎРЉ Р Р…Р В° РЎРѓР Р†Р ВµР В¶Р С‘Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex}. Р СџР ВµРЎР‚Р ВµРЎРѓР С•Р В·Р Т‘Р В°РЎвЂР С Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚...`);
          consecutiveErrors = 2; // Force browser recreate
          for (let key in interceptedCalendars) delete interceptedCalendars[key];
          // Р СњР вЂў continue РІР‚вЂќ Р С—РЎС“РЎРѓРЎвЂљРЎРЉ Р С—Р ВµРЎР‚Р ВµРЎРѓР С•Р В·Р Т‘Р В°РЎРѓРЎвЂљ Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ Р Р…Р С‘Р В¶Р Вµ Р С‘ Р Р…Р В°РЎвЂЎР Р…РЎвЂРЎвЂљ РЎвЂ Р С‘Р С”Р В»
        } else {
          // Р вЂ™РЎРѓР Вµ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…РЎвЂ№ РІР‚вЂќ РЎР‚Р С•РЎвЂљР В°РЎвЂ Р С‘РЎРЏ РЎвЂљР ВµРЎРѓРЎвЂљ-Р С—РЎР‚Р С•Р В±Р В°Р СР С‘ Р С”Р В°Р В¶Р Т‘РЎвЂ№Р Вµ 10 Р СР С‘Р Р…РЎС“РЎвЂљ
          if (!IN_BOT_PROXY_BAN_PROBES) {
            const earliestIdx = findEarliestUnbanProxy();
            const earliestBan = getProxyUnavailableUntil(earliestIdx, getNodeProxies()[earliestIdx]);
            const remainingMin = Math.ceil(Math.max(0, earliestBan - nowMs) / 60000);
            log('WARN', `[PROXY BAN] all proxies banned; waiting for external checker or expiry earliest_proxy=${earliestIdx} remaining_min=${remainingMin}`);
            await waitForNextPoll();
            continue;
          }
          if (!global.lastBanCheckMs) global.lastBanCheckMs = Date.now();
          if (!nextProxyBanProbeAtMs || nextProxyBanProbeAtMs <= nowMs) {
            scheduleNextProxyBanProbe(nowMs, true);
          }

          if (nextProxyBanProbeAtMs <= 0 && nowMs - global.lastBanCheckMs >= PROXY_BAN_RECHECK_BASE_MS) {
            log('СЂСџвЂќРЊ', `Р СћР ВµРЎРѓРЎвЂљ-Р С—РЎР‚Р С•Р В±: Р С—РЎР‚Р С•Р В±РЎС“Р ВµР С Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex} (${currentProxy ? currentProxy.host : '?'})...`);
            global.lastBanCheckMs = nowMs;
            isTestProbe = true;
            consecutiveErrors = 2; // Р СџР ВµРЎР‚Р ВµРЎРѓР С•Р В·Р Т‘Р В°РЎвЂљРЎРЉ Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ Р Р…Р В° Р Р…Р С•Р Р†Р С•Р С (rotated) Р С—РЎР‚Р С•Р С”РЎРѓР С‘
            for (let key in interceptedCalendars) delete interceptedCalendars[key];
          } else {
            const currentBan = getProxyUnavailableUntil(currentProxyIndex, getNodeProxies()[currentProxyIndex]);
            const remainingMin = Math.ceil(Math.max(0, currentBan - nowMs) / 60000);
            const nextCheckMin = Math.ceil(Math.max(0, nextProxyBanProbeAtMs - nowMs) / 60000);
            log('СЂСџвЂќвЂЎ', `Р вЂ™РЎРѓР Вµ Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р…РЎвЂ№. Р СћР ВµРЎРѓРЎвЂљ РЎвЂЎР ВµРЎР‚Р ВµР В· ${nextCheckMin} Р СР С‘Р Р… (РЎвЂљР ВµР С”РЎС“РЎвЂ°Р С‘Р в„– РЎР‚Р В°Р В·Р В±Р В°Р Р… ~${remainingMin} Р СР С‘Р Р…)`);

            if (page) {
              await performWarmup(page).catch(() => { });
            }
            await waitForNextPoll();
            continue;
          }
        }
      } else {
        // Р СћР ВµР С”РЎС“РЎвЂ°Р С‘Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р Р…Р Вµ Р В·Р В°Р В±Р В°Р Р…Р ВµР Р… РІР‚вЂќ Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С, Р Р…Р Вµ Р С‘РЎРѓРЎвЂљРЎвЂР С” Р В»Р С‘ Р В±Р В°Р Р… (cleanup)
        if (proxyBans[currentProxyIndex] && proxyBans[currentProxyIndex] <= nowMs) {
          clearProxyBan(currentProxyIndex);
          consecutive403Count = 0;
          internal403Count = 0;
          global.lastBanCheckMs = 0;
          log('РІСљвЂ¦', `Р вЂР В°Р Р… Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex} Р С‘РЎРѓРЎвЂљРЎвЂР С”, Р С—РЎР‚Р С•Р Т‘Р С•Р В»Р В¶Р В°Р ВµР С Р С•Р С—РЎР‚Р С•РЎРѓ.`);
        }
      }

      // РІвЂўС’РІвЂўС’РІвЂўС’ Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚Р С”Р В° Р С—Р В°РЎС“Р В·РЎвЂ№ Р С—Р С•РЎРѓР В»Р Вµ РЎС“РЎРѓР С—Р ВµРЎвЂ¦Р В° (Under V2 lines 350-366) РІвЂўС’РІвЂўС’РІвЂўС’
      if (pressureBackoffUntilMs > 0 && nowMs < pressureBackoffUntilMs) {
        const remainingSec = Math.ceil((pressureBackoffUntilMs - nowMs) / 1000);
        log('WARN', `[PRESSURE] node backoff active remaining_sec=${remainingSec}`);
        if (page) {
          await performWarmup(page).catch(() => { });
        }
        await waitForNextPoll();
        continue;
      }
      if (pressureBackoffUntilMs > 0 && nowMs >= pressureBackoffUntilMs) {
        pressureBackoffUntilMs = 0;
        log('OK', '[PRESSURE] node backoff ended; resume polling');
      }

      if (pausedUntilMs > 0 && nowMs < pausedUntilMs) {
        const remainingMin = Math.ceil((pausedUntilMs - nowMs) / 60000);
        log('СЂСџвЂќвЂЎ', `Р СџР В°РЎС“Р В·Р В° Р С—Р С•РЎРѓР В»Р Вµ Р С—Р С•Р С”РЎС“Р С—Р С”Р С‘ (РЎвЂљР С•Р В»РЎРЉР С”Р С• РЎв‚¬РЎС“Р С), Р С•РЎРѓРЎвЂљР В°Р В»Р С•РЎРѓРЎРЉ ~${remainingMin} Р СР С‘Р Р…`);
        if (page) {
          await performWarmup(page).catch(() => { });
        }
        await waitForNextPoll();
        continue;
      }
      if (pausedUntilMs > 0 && nowMs >= pausedUntilMs) {
        pausedUntilMs = 0;
        log('РІСљвЂ¦', 'Р СџР В°РЎС“Р В·Р В° Р С—Р С•РЎРѓР В»Р Вµ Р С—Р С•Р С”РЎС“Р С—Р С”Р С‘ Р В·Р В°Р Р†Р ВµРЎР‚РЎв‚¬Р ВµР Р…Р В°, Р Р†Р С•Р В·Р С•Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С Р С•Р С—РЎР‚Р С•РЎРѓ.');
      }

      if (browserProxyMismatch(browser)) {
        const browserProxyIdx = getBrowserProxyIndex(browser);
        log('SCHEDULER', `[SCHEDULER] browser_proxy_mismatch_recreate browser_proxy=${browserProxyIdx} current_proxy=${currentProxyIndex}`);
        await closeBrowserAndFlushProxyReleases(browser, `proxy_switch_${browserProxyIdx}_to_${currentProxyIndex}_close`);
        browser = null;
        page = null;
      }

      if (!browser || consecutiveErrors >= 2) {
        if (browser) await closeBrowserAndFlushProxyReleases(browser, 'browser_recreate');
        browser = await createBrowser();
        page = await getBrowserWorkPage(browser, `polling-proxy-${currentProxyIndex}`);
        // Р С’Р Р†РЎвЂљР С•РЎР‚Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ Р С—РЎР‚Р С•Р С”РЎРѓР С‘ (Р В»Р С•Р С–Р С‘Р Р…/Р С—Р В°РЎР‚Р С•Р В»РЎРЉ) РЎвЂЎР ВµРЎР‚Р ВµР В· Puppeteer CDP
        if (currentProxy && currentProxy.username && !proxyRelayState[currentProxyIndex]) {
          await page.authenticate({
            username: currentProxy.username,
            password: currentProxy.password
          });
          log('СЂСџвЂќвЂ', `Р СџРЎР‚Р С•Р С”РЎРѓР С‘-Р В°Р Р†РЎвЂљР С•РЎР‚Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ РЎС“РЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р В°: ${currentProxy.username}@${currentProxy.host}`);
        }
        consecutiveErrors = 0;
      }

      // Loop through all targets
      let targetsChecked = 0;
      let triedCart = false;

      for (const rawTarget of config.targets) {
        const liveNodeOverride = getCurrentNodeOverride();
        const liveTargetType = getCurrentTargetType();
        if (rawTarget.type !== liveTargetType) continue;

        const target = buildEffectiveTarget(rawTarget, liveNodeOverride, { logRolling: true });

        if (targetsChecked > 0) {
          await randomDelay(1000, 3000);
        }
        targetsChecked++;

        const result = await checkAvailability(page, target);

        if (result && result.reason === 'payload_missing') {
          consecutiveErrors = 2;
          for (let key in interceptedCalendars) delete interceptedCalendars[key];
          break;
        }

        if (result && isCyclePressureStatus(result.status)) {
          if (result.status === 'hard_blocked') {
            log('СЂСџВ§в„–', 'Р Р€Р Р…Р С‘РЎвЂЎРЎвЂљР С•Р В¶Р ВµР Р…Р С‘Р Вµ Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚Р Р…Р С•Р в„– РЎРѓР ВµРЎРѓРЎРѓР С‘Р С‘ Р Т‘Р В»РЎРЏ Р С•Р В±РЎвЂ¦Р С•Р Т‘Р В° WAF fingerprint tracking...');
            if (browser) await closeBrowserAndFlushProxyReleases(browser, 'hard_blocked_close');
            browser = null;
            page = null;
            consecutiveErrors = 2; // Force browser recreate
            for (let key in interceptedCalendars) delete interceptedCalendars[key];
          } else if (result.status === WAF_PRESSURE_STATUS) {
            const browserNeedsProxySwitch = browserProxyMismatch(browser);
            const forceBrowserRecreate = isConnectFailurePressureReason(result.reason) || browserNeedsProxySwitch || consecutiveErrors >= 2;
            if (forceBrowserRecreate) {
              const closeReason = browserNeedsProxySwitch
                ? `waf_proxy_switch_${result.reason || 'waf'}_close`
                : `pressure_${result.reason || 'waf'}_close`;
              if (browser) await closeBrowserAndFlushProxyReleases(browser, closeReason);
              browser = null;
              page = null;
              if (browserNeedsProxySwitch) {
                log('SCHEDULER', `[SCHEDULER] recreate_browser_for_proxy_switch reason=${result.reason || 'waf'} current_proxy=${currentProxyIndex}`);
              }
              consecutiveErrors = 2; // Next active cycle creates a fresh browser on the selected proxy.
            } else {
              consecutiveErrors = Math.min(consecutiveErrors + 1, 2);
              log('SCHEDULER', `[SCHEDULER] keep_browser_on_waf reason=${result.reason || 'waf'} consecutive_errors=${consecutiveErrors}`);
            }
            for (let key in interceptedCalendars) delete interceptedCalendars[key];
          }
          break;
        }

        if (result && result.status === 'empty') {
          if (isTestProbe) {
            clearProxyBan(currentProxyIndex);
            isTestProbe = false;
            global.lastBanCheckMs = 0;
            log('РІСљвЂ¦', `[TEST PROBE] Calendar 200 OK (РЅРµС‚ СЃР»РѕС‚РѕРІ) -> Р±Р°РЅ РїСЂРѕРєСЃРё #${currentProxyIndex} РЎРќРЇРў!`);
          }
        }

        if (result && result.status === 'available') {
          // РІвЂўС’РІвЂўС’РІвЂўС’ SLOT COORDINATION: Р Р†РЎвЂ№Р В±Р С‘РЎР‚Р В°Р ВµР С Р С•Р С—РЎвЂљР С‘Р СР В°Р В»РЎРЉР Р…РЎвЂ№Р в„– РЎРѓР В»Р С•РЎвЂљ РІвЂўС’РІвЂўС’РІвЂўС’
          const coordBestSlot = pickBestSlot(result.slots);
          log('СЂСџР‹СџРїС‘РЏ', `Р СњР В°Р в„–Р Т‘Р ВµР Р…РЎвЂ№ РЎРѓР В»Р С•РЎвЂљРЎвЂ№ (${result.slots.length})! Р вЂ™РЎвЂ№Р В±Р С‘РЎР‚Р В°РЎР‹ ${coordBestSlot.startDateTime}...`);

          if (isTestProbe) {
            // Calendar Р Р†Р ВµРЎР‚Р Р…РЎС“Р В» 200 + РЎРѓР В»Р С•РЎвЂљ Р Р…Р В°Р в„–Р Т‘Р ВµР Р… РІвЂ вЂ™ Р С—РЎР‚Р С•Р С”РЎРѓР С‘ Р СњР вЂў Р В·Р В°Р В±Р В°Р Р…Р ВµР Р… WAF'Р С•Р С!
            clearProxyBan(currentProxyIndex);
            isTestProbe = false;
            global.lastBanCheckMs = 0;
            log('РІСљвЂ¦', `[TEST PROBE] Calendar 200 + РЎРѓР В»Р С•РЎвЂљ Р Р…Р В°Р в„–Р Т‘Р ВµР Р… РІвЂ вЂ™ Р В±Р В°Р Р… Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex} Р РЋР СњР Р‡Р Сћ! Р РЋРЎвЂљРЎР‚Р ВµР В»РЎРЏР ВµР С.`);
            break; // Р СњР Вµ Р Т‘Р ВµР В»Р В°Р ВµР С addtocart Р Р† РЎвЂљР ВµРЎРѓРЎвЂљР С•Р Р†Р С•Р С Р С—РЎР‚Р С•РЎРѓРЎвЂљРЎР‚Р ВµР В»Р Вµ
          }

          // РІвЂўС’РІвЂўС’РІвЂўС’ SLOT COORDINATION: PRE-CLAIM РІР‚вЂќ РЎР‚Р ВµР С–Р С‘РЎРѓРЎвЂљРЎР‚Р С‘РЎР‚РЎС“Р ВµР С РЎРѓР В»Р С•РЎвЂљ Р вЂќР С› Р С—Р С•Р С—РЎвЂ№РЎвЂљР С”Р С‘ addToCart РІвЂўС’РІвЂўС’РІвЂўС’
          claimSlot(coordBestSlot.startDateTime);

          const payload = interceptedCalendars[target.url.split('?')[0]];
          let cartResult = await addToCart(page, coordBestSlot, target, payload);

          if (cartResult && cartResult.status === 'rejected') {
            log('SCHEDULER', `[SCHEDULER] addtocart_rejected_no_extra_retry slot=${coordBestSlot.startDateTime} release_response=log_only`);
            // Rotate proxy after addtocart rejection: Octofence flags the IP after POST /addtocart,
            // causing WAF 403 on subsequent calendar requests from the same proxy.
            rotateProxyAfterWafPressure('addtocart_rejected_409');
            if (browser) await closeBrowserAndFlushProxyReleases(browser, 'addtocart_rejected_close');
            browser = null;
            page = null;
            consecutiveErrors = 2; // Force browser recreate on next cycle
            for (let key in interceptedCalendars) delete interceptedCalendars[key];
            break;
          }

          if (cartResult && cartResult.status === 'error') {
            log('WARN', `[CART] addtocart flow error reason=${cartResult.reason || 'unknown'} -> recreate browser next cycle`);
            consecutiveErrors = 2;
            for (let key in interceptedCalendars) delete interceptedCalendars[key];
            break;
          }

          if (cartResult && isCyclePressureStatus(cartResult.status)) {
            if (cartResult.status === 'hard_blocked') {
              log('СЂСџВ§в„–', 'Р Р€Р Р…Р С‘РЎвЂЎРЎвЂљР С•Р В¶Р ВµР Р…Р С‘Р Вµ Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚Р Р…Р С•Р в„– РЎРѓР ВµРЎРѓРЎРѓР С‘Р С‘ (403)...');
              if (browser) await closeBrowserAndFlushProxyReleases(browser, 'cart_hard_blocked_close');
              browser = null;
              page = null;
              consecutiveErrors = 2; // Force browser recreate
              for (let key in interceptedCalendars) delete interceptedCalendars[key];
            } else if (cartResult.status === WAF_PRESSURE_STATUS) {
              const browserNeedsProxySwitch = browserProxyMismatch(browser);
              const forceBrowserRecreate = isConnectFailurePressureReason(cartResult.reason) || browserNeedsProxySwitch || consecutiveErrors >= 2;
              if (forceBrowserRecreate) {
                const closeReason = browserNeedsProxySwitch
                  ? `cart_waf_proxy_switch_${cartResult.reason || 'waf'}_close`
                  : `cart_pressure_${cartResult.reason || 'waf'}_close`;
                if (browser) await closeBrowserAndFlushProxyReleases(browser, closeReason);
                browser = null;
                page = null;
                if (browserNeedsProxySwitch) {
                  log('SCHEDULER', `[SCHEDULER] recreate_browser_for_cart_proxy_switch reason=${cartResult.reason || 'waf'} current_proxy=${currentProxyIndex}`);
                }
                consecutiveErrors = 2; // Proxy rotated; recreate browser on the next strict-grid cycle.
              } else {
                consecutiveErrors = Math.min(consecutiveErrors + 1, 2);
                log('SCHEDULER', `[SCHEDULER] keep_browser_on_cart_waf reason=${cartResult.reason || 'waf'} consecutive_errors=${consecutiveErrors}`);
              }
              for (let key in interceptedCalendars) delete interceptedCalendars[key];
            }
            // rate_limited (429): Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ Р Р…Р Вµ РЎвЂљРЎР‚Р С•Р С–Р В°Р ВµР С, Р С—РЎР‚Р С•РЎРѓРЎвЂљР С• Р В¶Р Т‘РЎвЂР С РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р С‘Р в„– РЎвЂ Р С‘Р С”Р В»
            break;
          }

          if (cartResult && cartResult.success === true) {
            log('СЂСџР‹вЂ°', 'РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’');
            log('СЂСџР‹вЂ°', '  Р вЂР ВР вЂєР вЂўР СћР В« Р Р€Р РЋР СџР вЂўР РЃР СњР С› Р вЂќР С›Р вЂР С’Р вЂ™Р вЂєР вЂўР СњР В« Р вЂ™ Р С™Р С›Р В Р вЂ”Р ВР СњР Р€!  ');
            log('СЂСџР‹вЂ°', 'РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’');

            let ticketInfo = cartResult.ticketInfo || formatTicketInfo(target.tickets);
            log('PAYMENT', '[PAYMENT] passenger_prefill_deferred reason=checkout_requires_reservation_guid');

            // РІвЂўС’РІвЂўС’РІвЂўС’ Р СџР С•Р С—РЎвЂ№РЎвЂљР С”Р В° Р В°Р Р†РЎвЂљР С•-Р В·Р В°Р С—Р С•Р В»Р Р…Р ВµР Р…Р С‘РЎРЏ Р С‘Р СРЎвЂР Р… РІвЂўС’РІвЂўС’РІвЂўС’
            try {
              const detailGuids = cartResult.detailGuids || [];
              // Р вЂР ВµРЎР‚РЎвЂР С UUID Р С‘Р В· Р С—Р С•РЎРѓР В»Р ВµР Т‘Р Р…Р ВµР С–Р С• cartRes (Р С•Р Р… РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎвЂР Р… Р Р† Р В·Р В°Р СРЎвЂ№Р С”Р В°Р Р…Р С‘Р С‘ addToCart)
              if (false && page && config.participants && config.participants.length > 0) {
                log('PAYMENT', '[PAYMENT] passenger_legacy_prefill_skipped');
              }
            } catch (nameErr) {
              log('РІС™В РїС‘РЏ', `Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р В·Р В°Р С—Р С•Р В»Р Р…Р ВµР Р…Р С‘РЎРЏ Р С‘Р СРЎвЂР Р…: ${nameErr.message}`);
            }

            // РІвЂўС’РІвЂўС’РІвЂўС’ HOLD MODE: catch-and-release РЎРѓ Р СР С–Р Р…Р С•Р Р†Р ВµР Р…Р Р…РЎвЂ№Р С re-catch РІвЂўС’РІвЂўС’РІвЂўС’
            if (config.application.holdMode) {
              holdModeActive = true;
              holdModeSlotInfo = { slot: coordBestSlot, target, ticketInfo, bookingPlan: cartResult.bookingPlan || null };
              paymentModifyInFlight = false;
              clearPaymentModifyRetryWindow();
              payCommandReceived = false;
              holdCycleCount = 0;

              // Р С›Р вЂќР СњР С› РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ: Р ВµРЎРѓР В»Р С‘ РЎС“Р В¶Р Вµ Р ВµРЎРѓРЎвЂљРЎРЉ РІР‚вЂќ РЎР‚Р ВµР Т‘Р В°Р С”РЎвЂљР С‘РЎР‚РЎС“Р ВµР С, Р С‘Р Р…Р В°РЎвЂЎР Вµ Р С•РЎвЂљР С—РЎР‚Р В°Р Р†Р В»РЎРЏР ВµР С Р Р…Р С•Р Р†Р С•Р Вµ
              const initMsg = buildHoldMessage(coordBestSlot.startDateTime, ticketInfo, 1, currentProxyIndex, 'active');
              if (holdTelegramMsgId) {
                await editTelegram(holdTelegramMsgId, initMsg);
              } else {
                const sendResult = await notifyTelegram(initMsg);
                holdTelegramMsgId = (sendResult && sendResult.result && sendResult.result.message_id) || null;
              }

              // РІвЂўС’РІвЂўС’РІвЂўС’ INFINITE HOLD-AND-RECATCH LOOP РІвЂўС’РІвЂўС’РІвЂўС’
              let holdBrowser = browser;
              let holdPage = page;
              let holdSlot = coordBestSlot;
              let exitHold = false;
              const HOLD_DURATION_MS = 840000; // 14 Р СР С‘Р Р…РЎС“РЎвЂљ
              const CHECK_INTERVAL_MS = 5000;  // Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С /pay Р С”Р В°Р В¶Р Т‘РЎвЂ№Р Вµ 5 РЎРѓР ВµР С”
              let holdDeadlineMs = 0;

              while (!exitHold) {
                holdCycleCount++;
                if (!holdDeadlineMs || Date.now() >= holdDeadlineMs) holdDeadlineMs = Date.now() + HOLD_DURATION_MS;
                const holdStartMs = holdDeadlineMs - HOLD_DURATION_MS;
                let preloaded = null;
                let preloadStarted = false;
                let lastHoldLeaseRefreshMs = 0;

                log('СЂСџвЂќвЂћ', `HOLD РЎвЂ Р С‘Р С”Р В» #${holdCycleCount}: Р В±Р С‘Р В»Р ВµРЎвЂљРЎвЂ№ Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ Р Р…Р В° Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex}`);
                let lastHeartbeatMs = Date.now(); // Р С™Р С•Р С•РЎР‚Р Т‘Р С‘Р Р…Р В°РЎвЂ Р С‘Р С•Р Р…Р Р…РЎвЂ№Р в„– heartbeat
                let nextCartHealthCheckMs = Date.now() + randomInt(HOLD_CART_HEALTH_MIN_MS, HOLD_CART_HEALTH_MAX_MS);
                let holdReleasedEarly = false;
                // The cart was just created by a successful /addtocart.  /mtajax/check_cart can be
                // WAF-blocked with transient 403 during hold, so do not require a successful
                // check_cart response before allowing /pay cart modification.
                let holdCartHealthAliveSeen = Boolean(cartItemsInfo && getCartItemsNonGuideQty(cartItemsInfo) > 0);
                let holdCartHealthCheckDisabled = false;

                // РІвЂўС’РІвЂўС’РІвЂўС’ Hold wait loop РЎРѓ Р С—РЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С•Р в„– РІвЂўС’РІвЂўС’РІвЂўС’
                while (Date.now() < holdDeadlineMs) {
                  if (Date.now() - lastHoldLeaseRefreshMs >= PROXY_LEASE_REFRESH_INTERVAL_MS) {
                    refreshProxyLease(currentProxyLease, 'hold_active_browser');
                    if (preloaded && preloaded.proxyLease) {
                      refreshProxyLease(preloaded.proxyLease, 'hold_preload_browser');
                    }
                    lastHoldLeaseRefreshMs = Date.now();
                  }

                  if (!payCommandReceived && hasPendingPaymentModification() && !shouldDeferPaymentModification()) {
                    payCommandReceived = true;
                    log('PAYMENT', `[PAYMENT] cart_modify_retry_due adults=${payDesiredAdults || 0} children=${payDesiredChildren || 0} guide=${getCartItemsGuideQty(cartItemsInfo)}`);
                    break;
                  }

                  if (payCommandReceived || fs.existsSync('/tmp/pay_now') || fs.existsSync(PAY_REQUEST_PATH)) {
                    const hasLegacyPayTrigger = fs.existsSync('/tmp/pay_now');
                    const hasWebPaymentRequest = fs.existsSync(PAY_REQUEST_PATH);
                    if (hasWebPaymentRequest && !hasLegacyPayTrigger) {
                      const webPaymentRequest = readWebPaymentRequest();
                      if (!applyWebPaymentRequest(webPaymentRequest)) {
                        await sleep(CHECK_INTERVAL_MS);
                        continue;
                      }
                      if (payCommandReceived) {
                        log('PAYMENT', '[PAYMENT] web_payment_triggered');
                        break;
                      }
                      await sleep(CHECK_INTERVAL_MS);
                      // Let the hold loop sleep normally; do not add a check_cart request while modify is pending.
                    }
                    if (fs.existsSync('/tmp/pay_now')) {
                      fs.unlinkSync('/tmp/pay_now');
                      const webPaymentRequest = readWebPaymentRequest();
                      if (!applyWebPaymentRequest(webPaymentRequest)) {
                        await sleep(CHECK_INTERVAL_MS);
                        continue;
                      }
                      log('СЂСџвЂ™С–', 'Р В¤Р В°Р в„–Р В»Р С•Р Р†РЎвЂ№Р в„– РЎвЂљРЎР‚Р С‘Р С–Р С–Р ВµРЎР‚ /tmp/pay_now Р С•Р В±Р Р…Р В°РЎР‚РЎС“Р В¶Р ВµР Р…! Р вЂ™РЎвЂ№РЎвЂ¦Р С•Р Т‘Р С‘Р С Р С‘Р В· Hold Mode РІвЂ вЂ™ Checkout...');
                    } else {
                      log('СЂСџвЂ™С–', '/pay Р С—Р С•Р В»РЎС“РЎвЂЎР ВµР Р…! Р вЂ™РЎвЂ№РЎвЂ¦Р С•Р Т‘Р С‘Р С Р С‘Р В· Hold Mode РІвЂ вЂ™ Checkout...');
                    }
                    payCommandReceived = true; // Р вЂќР В»РЎРЏ Р Р…Р В°Р Т‘Р ВµР В¶Р Р…Р С•РЎРѓРЎвЂљР С‘ Р Р†Р В»Р С•Р В¶Р ВµР Р…Р Р…РЎвЂ№РЎвЂ¦ РЎС“РЎРѓР В»Р С•Р Р†Р С‘Р в„–
                    break;
                  }

                  if (Date.now() >= nextCartHealthCheckMs) {
                    if (paymentModifyInFlight || payCommandReceived || hasPendingPaymentModification()) {
                      nextCartHealthCheckMs = Date.now() + randomInt(10000, 15000);
                      log('PAYMENT', '[PAYMENT] cart_health_check_skipped reason=payment_modify_pending');
                    } else if (holdCartHealthCheckDisabled) {
                      nextCartHealthCheckMs = Date.now() + 60000;
                    } else {
                    const cartHealth = await verifyHeldCart(holdPage);
                    if (cartHealth.alive === true) {
                      holdCartHealthAliveSeen = true;
                      log('HOLD', `[HOLD] cart_alive adults=${cartHealth.adults || 0} children=${cartHealth.children || 0} guide=${Math.max(0, Number(cartHealth.guide || 0) || 0)} total=${cartHealth.total || 0}`);
                    } else if (cartHealth.alive === false) {
                      markHeldCartReleased(cartHealth.reason || 'unknown');
                      holdReleasedEarly = true;
                      break;
                    } else {
                      log('HOLD', `[HOLD] cart_health_unknown reason=${cartHealth.reason || 'unknown'}`);
                      if (holdCartHealthAliveSeen && /^transient_http_(0|403|429)$/.test(cartHealth.reason || '')) {
                        holdCartHealthCheckDisabled = true;
                        log('HOLD', `[HOLD] cart_health_check_disabled reason=${cartHealth.reason} alive_seen=true until_next_hold_or_payment`);
                      }
                      if (hasPendingPaymentModification() && getPaymentModifyRetryRemainingMs() === 0) {
                        schedulePaymentModifyRetry(cartHealth.reason || 'cart_health_unknown');
                      }
                    }
                    nextCartHealthCheckMs = holdCartHealthCheckDisabled
                      ? Date.now() + 60000
                      : Date.now() + randomInt(HOLD_CART_HEALTH_MIN_MS, HOLD_CART_HEALTH_MAX_MS);
                    }
                  }

                  const remainingMs = holdDeadlineMs - Date.now();

                  // РІвЂўС’РІвЂўС’РІвЂўС’ Registry heartbeat: Р С•Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С РЎР‚Р ВµР ВµРЎРѓРЎвЂљРЎР‚ Р С”Р В°Р В¶Р Т‘РЎвЂ№Р Вµ 10 Р СР С‘Р Р… (TTL=16 Р СР С‘Р Р…) РІвЂўС’РІвЂўС’РІвЂўС’
                  if (Date.now() - lastHeartbeatMs >= 600000) {
                    claimSlot(holdSlot.startDateTime);
                    lastHeartbeatMs = Date.now();
                    log('СЂСџвЂњРЋ', `[HOLD] Registry heartbeat: ${holdSlot.startDateTime}`);
                  }

                  // Р вЂ”Р В° 60 РЎРѓР ВµР С” Р Т‘Р С• Р С”Р С•Р Р…РЎвЂ Р В° РІР‚вЂќ Р В·Р В°Р С—РЎС“РЎРѓР С”Р В°Р ВµР С Р С—РЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“ РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р ВµР С–Р С• Р С—РЎР‚Р С•Р С”РЎРѓР С‘
                  if (getSchedulerConfig().recatchMode !== 'grid' && remainingMs <= PRE_LOAD_AHEAD_MS && !preloadStarted) {
                    preloadStarted = true;
                    log('СЂСџвЂќвЂћ', `[HOLD] Р вЂќР С• РЎРѓР В±РЎР‚Р С•РЎРѓР В° ~${Math.ceil(remainingMs / 1000)}РЎРѓ. Р вЂ”Р В°Р С—РЎС“РЎРѓР С”Р В°Р ВµР С pre-load...`);
                    try {
                      preloaded = await preloadForRecatch(target);
                    } catch (e) {
                      log('РІС™В РїС‘РЏ', `[HOLD] Pre-load Р С•РЎв‚¬Р С‘Р В±Р С”Р В°: ${e.message}`);
                      preloaded = null;
                    }
                  }

                  // Р РЃРЎС“Р С Р Т‘Р В»РЎРЏ Р В°Р Р…РЎвЂљР С‘Р В±Р С•РЎвЂљР В°
                  if (holdPage) await performWarmup(holdPage).catch(() => { });
                  await sleep(CHECK_INTERVAL_MS);
                }

                // РІвЂўС’РІвЂўС’РІвЂўС’ /pay Р С—Р С•Р В»РЎС“РЎвЂЎР ВµР Р… РІвЂ вЂ™ CHECKOUT РІвЂўС’РІвЂўС’РІвЂўС’
                let paymentDeferredByPrecheck = false;
                if (payCommandReceived) {
                  const heldCartCheck = await verifyHeldCart(holdPage);
                  if (heldCartCheck.alive === false) {
                    markHeldCartReleased(`pre_payment_${heldCartCheck.reason || 'unknown'}`);
                    holdReleasedEarly = true;
                    notifyTelegram('Payment stopped: held cart is no longer alive. Re-catching now.');
                  } else if (heldCartCheck.alive === null && hasPendingPaymentModification()) {
                    const prePaymentTransient = /^transient_http_(0|403|429)$/.test(heldCartCheck.reason || '');
                    const hasKnownHeldCart = holdCartHealthAliveSeen || Boolean(cartItemsInfo && getCartItemsNonGuideQty(cartItemsInfo) > 0 && Date.now() < holdDeadlineMs);
                    if (hasKnownHeldCart && prePaymentTransient) {
                      log('PAYMENT', `[PAYMENT] pre_payment_check_soft_failed reason=${heldCartCheck.reason} known_cart=true action=continue_modify`);
                    } else {
                      paymentModifyInFlight = false;
                      if (getPaymentModifyRetryRemainingMs() === 0) {
                        schedulePaymentModifyRetry(heldCartCheck.reason || 'pre_payment_unknown');
                      }
                      logPaymentModifyDeferred(heldCartCheck.reason || 'pre_payment_unknown', payDesiredAdults, payDesiredChildren, 'source=pre_payment_check');
                      payCommandReceived = false;
                      paymentDeferredByPrecheck = true;
                    }
                  }
                }

                if (paymentDeferredByPrecheck) {
                  log('HOLD', `[HOLD] payment_deferred_return_to_hold remaining_ms=${Math.max(0, holdDeadlineMs - Date.now())}`);
                  continue;
                }

                if (payCommandReceived) {
                  // Р вЂ”Р В°Р С”РЎР‚РЎвЂ№Р Р†Р В°Р ВµР С Р С—РЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р ВµР Р…Р Р…РЎвЂ№Р в„– Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ Р ВµРЎРѓР В»Р С‘ Р ВµРЎРѓРЎвЂљРЎРЉ
                  if (preloaded && preloaded.browser) {
                    await preloaded.browser.close().catch(() => { });
                    await releaseProxyLeaseNow(getProxyLeaseReleaseTarget(preloaded.proxyLease), 'preload_closed_unused');
                    stopProxyRelayForIndex(preloaded.proxyIdx, 'preload_closed_unused');
                    log('СЂСџВ§в„–', 'Р СџРЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р ВµР Р…Р Р…РЎвЂ№Р в„– Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ Р В·Р В°Р С”РЎР‚РЎвЂ№РЎвЂљ.');
                  }

                  payCommandReceived = false;

                  // РІвЂўС’РІвЂўС’РІвЂўС’ Р СљР С•Р Т‘Р С‘РЎвЂћР С‘Р С”Р В°РЎвЂ Р С‘РЎРЏ Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎвЂ№ (Р ВµРЎРѓР В»Р С‘ Р Р…РЎС“Р В¶Р Р…Р С•) РІвЂўС’РІвЂўС’РІвЂўС’
                  let passengerDetailGuids = cartItemsInfo?.detailGuids || [];
                  const passengerDetailsForCheckout = PAYMENT_PASSENGER_AUTOFILL_ENABLED ? payPassengerDetails : null;
                  const currentPaymentGuideQty = getCartItemsGuideQty(cartItemsInfo);

                  if ((payDesiredAdults > 0 || payDesiredChildren > 0) && !payCheckoutOnly) {
                    paymentModifyInFlight = true;
                    log('PAYMENT', `[PAYMENT] cart_modify_started adults=${payDesiredAdults} children=${payDesiredChildren} guide=${currentPaymentGuideQty}`);
                    const modResult = await modifyCartForCheckout(holdPage, payDesiredAdults, payDesiredChildren, cartItemsInfo, holdSlot, target);
                    if (!modResult.success) {
                      paymentModifyInFlight = false;
                      const retryableModify = !modResult.noAutoRetry && (
                        Boolean(modResult.retryable)
                        || isRetryableCartMutation(modResult.status, modResult.error || '')
                        || /HTTP\s+(0|403|429|500|502|503|504)\b/i.test(String(modResult.error || ''))
                        || /octofence|rate limit|block_style/i.test(String(modResult.error || ''))
                      );
                      if (retryableModify) {
                        const retryInMs = schedulePaymentModifyRetry(modResult.retryReason || 'cart_modify_retryable');
                        logPaymentModifyDeferred(modResult.retryReason || 'cart_modify_retryable', payDesiredAdults, payDesiredChildren, `source=modify retry_in_ms=${retryInMs}`);
                        notifyTelegram(`РњРѕРґРёС„РёРєР°С†РёСЏ РєРѕСЂР·РёРЅС‹ РІСЂРµРјРµРЅРЅРѕ Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅР° (${modResult.error}). РџРѕРІС‚РѕСЂСЋ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё С‡РµСЂРµР· ~${Math.max(1, Math.ceil(retryInMs / 1000))}СЃ.`);
                        payCommandReceived = false;
                        continue;
                      }

                      if (modResult.status === 409) {
                        log('WARN', `[PAYMENT] 409 error on cart modification. Releasing cart immediately.`);
                        notifyTelegram(`вљ пёЏ Р‘РёР»РµС‚С‹ Р±С‹Р»Рё РїРµСЂРµС…РІР°С‡РµРЅС‹ (РѕС€РёР±РєР° 409). РћС‚РїСѓСЃРєР°СЋ РєРѕСЂР·РёРЅСѓ.`);
                        await holdPage.evaluate(async () => {
                           try {
                             const dropRes = await fetch('/mtajax/dropcart', {
                               method: 'POST',
                               credentials: 'include',
                               headers: {
                                 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                 'x-requested-with': 'XMLHttpRequest'
                               },
                               body: 'action=midaabc_dropcart'
                             });
                             if (!dropRes.ok) throw new Error(`dropcart_http_${dropRes.status}`);
                           } catch (e) {
                             try { await fetch('/mtajax/release_cart', { method: 'POST' }); } catch (_) {}
                           }
                        }).catch(() => {});
                        break; // Р’С‹С…РѕРґРёРј РёР· С†РёРєР»Р° hold
                      }

                      log('PAYMENT', `[PAYMENT] cart_modify_failed adults=${payDesiredAdults} children=${payDesiredChildren} error="${modResult.error}"`);
                      log('РІС™В РїС‘РЏ', `Р СљР С•Р Т‘Р С‘РЎвЂћР С‘Р С”Р В°РЎвЂ Р С‘РЎРЏ Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎвЂ№ Р Р…Р Вµ РЎС“Р Т‘Р В°Р В»Р В°РЎРѓРЎРЉ: ${modResult.error}`);
                      notifyTelegram(`РІС™В РїС‘РЏ Р С›РЎв‚¬Р С‘Р В±Р С”Р В° Р СР С•Р Т‘Р С‘РЎвЂћР С‘Р С”Р В°РЎвЂ Р С‘Р С‘: ${modResult.error}\nСЂСџР‹В« Р вЂ™ Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ: ${modResult.currentAdults || '?'} Intero + ${currentPaymentGuideQty} Guide\nР С›РЎвЂљР С—РЎР‚Р В°Р Р†РЎРЉРЎвЂљР Вµ /pay РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р С—Р С•Р С—РЎР‚Р С•Р В±Р С•Р Р†Р В°РЎвЂљРЎРЉ РЎРѓР Р…Р С•Р Р†Р В°.`);
                      // Р СњР Вµ Р Р†РЎвЂ№РЎвЂ¦Р С•Р Т‘Р С‘Р С Р С‘Р В· hold РІР‚вЂќ Р Т‘Р В°РЎвЂР С Р ВµРЎвЂ°РЎвЂ РЎв‚¬Р В°Р Р…РЎРѓ
                      payCommandReceived = false;
                      payDesiredAdults = 0;
                      payDesiredChildren = 0;
                      payCheckoutOnly = false;
                      payPassengerDetails = null;
                      continue;
                    }
                    paymentModifyInFlight = false;
                    clearPaymentModifyRetryWindow();
                    const guideText = currentPaymentGuideQty > 0 ? `, ${currentPaymentGuideQty}x Guide` : '';
                    const newTicketInfo = payDesiredChildren > 0
                      ? `${payDesiredAdults}x Intero, ${payDesiredChildren}x Under18${guideText}`
                      : `${payDesiredAdults}x Intero${guideText}`;
                    ticketInfo = newTicketInfo;
                    log('PAYMENT', `[PAYMENT] cart_modified adults=${payDesiredAdults} children=${payDesiredChildren} guide=${currentPaymentGuideQty}`);
                    passengerDetailGuids = modResult.detailGuids || cartItemsInfo?.detailGuids || [];
                    log('РІСљвЂ¦', `Р С™Р С•РЎР‚Р В·Р С‘Р Р…Р В° Р СР С•Р Т‘Р С‘РЎвЂћР С‘РЎвЂ Р С‘РЎР‚Р С•Р Р†Р В°Р Р…Р В°: ${ticketInfo}`);
                    notifyTelegram(`РІСљвЂ¦ Р С™Р С•РЎР‚Р В·Р С‘Р Р…Р В° Р С–Р С•РЎвЂљР С•Р Р†Р В°: ${ticketInfo}\nСЂСџвЂ™С– Р СџР ВµРЎР‚Р ВµРЎвЂ¦Р С•Р Т‘Р С‘Р С Р С” Р С•Р С—Р В»Р В°РЎвЂљР Вµ!`);
                  } else if (payCheckoutOnly) {
                    log('PAYMENT', `[PAYMENT] cart_modify_skipped reason=checkout_only adults=${payDesiredAdults || 0} children=${payDesiredChildren || 0} guide=${currentPaymentGuideQty}`);
                  }

                  // Checkout Р Р…Р В° РЎвЂљР ВµР С”РЎС“РЎвЂ°Р ВµР С hold-Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚Р Вµ
                  // Р С›Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ: Р РЋРЎвЂљР В°РЎвЂљРЎС“РЎРѓ РІвЂ вЂ™ Р С›Р С—Р В»Р В°РЎвЂљР В°
                  paymentModifyInFlight = false;
                  holdModeActive = false;
                  config.application.holdMode = false;
                  log('PAYMENT', `[PAYMENT] checkout_ready adults=${payDesiredAdults || 0} children=${payDesiredChildren || 0} guide=${currentPaymentGuideQty}`);

                  if (holdTelegramMsgId) {
                    await editTelegram(holdTelegramMsgId, buildHoldMessage(holdSlot.startDateTime, ticketInfo, holdCycleCount, currentProxyIndex, 'checkout'));
                  }
                  const checkoutResult = await performCheckout(holdBrowser, holdPage, holdSlot.startDateTime, ticketInfo, {
                    detailGuids: passengerDetailGuids,
                    passengerDetails: passengerDetailsForCheckout
                  });
                  if (checkoutResult?.controlled) {
                    holdBrowser = null;
                    holdPage = null;
                    await parkBotDuringManualCheckout('hold_controlled_checkout', {
                      slot: holdSlot?.startDateTime || holdSlot,
                      ticketInfo,
                      checkoutProfile: checkoutResult.checkoutProfile || null
                    }, checkoutResult.page || null);
                  }
                  payDesiredAdults = 0;
                  payDesiredChildren = 0;
                  payCheckoutOnly = false;
                  payPassengerDetails = null;
                  browser = null;
                  page = null;
                  consecutiveErrors = 0;
                  pausedUntilMs = Date.now() + SUCCESS_WAIT_MS;
                  exitHold = true;
                  break;
                }

                // Do not fall through into re-catch when checkout was deferred or the inner
                // hold loop ended for a non-expiration reason.  Re-catch must happen only after
                // the real hold deadline or an explicit cart release.
                if (!holdReleasedEarly && Date.now() < holdDeadlineMs) {
                  log('HOLD', `[HOLD] hold_loop_continue_without_recatch remaining_ms=${Math.max(0, holdDeadlineMs - Date.now())}`);
                  continue;
                }

                // РІвЂўС’РІвЂўС’РІвЂўС’ Hold Р С‘РЎРѓРЎвЂљРЎвЂР С” РІвЂ вЂ™ INSTANT RE-CATCH РІвЂўС’РІвЂўС’РІвЂўС’
                log('СЂСџвЂќвЂћ', `[HOLD] 14 Р СР С‘Р Р… Р С‘РЎРѓРЎвЂљР ВµР С”Р В»Р С‘. Р вЂ”Р В°Р С”РЎР‚РЎвЂ№Р Р†Р В°Р ВµР С Р С—РЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex}, Р СР С–Р Р…Р С•Р Р†Р ВµР Р…Р Р…РЎвЂ№Р в„– re-catch...`);
                // Р С›Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ: Р РЋРЎвЂљР В°РЎвЂљРЎС“РЎРѓ РІвЂ вЂ™ Re-catch
                if (holdTelegramMsgId) {
                  await editTelegram(holdTelegramMsgId, buildHoldMessage(holdSlot.startDateTime, ticketInfo, holdCycleCount, currentProxyIndex, 'recatch'));
                }

                // Р вЂ”Р В°Р С”РЎР‚РЎвЂ№Р Р†Р В°Р ВµР С РЎРѓРЎвЂљР В°РЎР‚РЎвЂ№Р в„– Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ (Р С•РЎРѓР Р†Р С•Р В±Р С•Р В¶Р Т‘Р В°Р ВµР С Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎС“)
                queueProxyLeaseRelease('recatch_old_hold_browser_closed', currentProxyLease);
                await closeBrowserAndFlushProxyReleases(holdBrowser, 'recatch_old_hold_browser_closed');
                currentProxyLease = null;

                if (!preloaded || !preloaded.browser || !preloaded.page) {
                  const proxies = getNodeProxies();
                  if (proxies.length > 0) {
                    const nextIdx = (currentProxyIndex + 1) % proxies.length;
                    log('SCHEDULER', `[SCHEDULER] recatch_browser_prepare proxy=${nextIdx} network_waits_for_slot=true`);
                    preloaded = await createBrowserForProxy(nextIdx).catch(error => {
                      log('WARN', `[SCHEDULER] recatch_browser_prepare_failed proxy=${nextIdx} error=${error.message}`);
                      return null;
                    });
                  }
                }

                if (preloaded && preloaded.browser && preloaded.page) {
                  // РІвЂўС’РІвЂўС’РІвЂўС’ Р СљР вЂњР СњР С›Р вЂ™Р вЂўР СњР СњР В«Р в„ў RE-CATCH Р Р…Р В° Р С—РЎР‚Р ВµР Т‘Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р ВµР Р…Р Р…Р С•Р С Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚Р Вµ РІвЂўС’РІвЂўС’РІвЂўС’
                  holdBrowser = preloaded.browser;
                  holdPage = preloaded.page;

                  // Р СџР ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР В°Р ВµР С Р С–Р В»Р С•Р В±Р В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ Р С—РЎР‚Р С•Р С”РЎРѓР С‘-Р С—Р ВµРЎР‚Р ВµР СР ВµР Р…Р Р…РЎвЂ№Р Вµ Р Р…Р В° Р Р…Р С•Р Р†РЎвЂ№Р в„– Р С—РЎР‚Р С•Р С”РЎРѓР С‘
                  const oldProxyIdx = currentProxyIndex;
                  currentProxyIndex = preloaded.proxyIdx;
                  currentProxy = preloaded.proxy;
                  currentProxyLease = preloaded.proxyLease || currentProxyLease;
                  internal403Count = 0;
                  saveBanState();

                  log('SCHEDULER', `[SCHEDULER] recatch_proxy_ready old_proxy=${oldProxyIdx} new_proxy=${currentProxyIndex} mode=strict_grid`);

                  // Re-catch is gated by the same strict scheduler slot as normal polling.
                  let caught = false;
                  const recatchDeadlineMs = Date.now() + RECATCH_MAX_DURATION_MS;
                  for (let attempt = 1; attempt <= RECATCH_MAX_ATTEMPTS && Date.now() < recatchDeadlineMs; attempt++) {
                    if (payCommandReceived) {
                      log('СЂСџвЂ™С–', '/pay Р Р†Р С• Р Р†РЎР‚Р ВµР СРЎРЏ re-catch! Р СџРЎР‚Р ВµРЎР‚РЎвЂ№Р Р†Р В°Р ВµР С...');
                      break;
                    }

                    log('SCHEDULER', `[SCHEDULER] recatch_wait_next_slot attempt=${attempt}/${RECATCH_MAX_ATTEMPTS} remaining_ms=${Math.max(0, recatchDeadlineMs - Date.now())}`);
                    const recatchReady = await waitForNextPoll();
                    if (recatchReady === false || Date.now() >= recatchDeadlineMs) break;

                    // РІвЂўС’РІвЂўС’РІвЂўС’ UNION Р вЂќР ВР С’Р СџР С’Р вЂ”Р С›Р СњР С’ (Р СџР В»Р В°Р Р†Р В°РЎР‹РЎвЂ°Р ВµР Вµ Р С•Р С”Р Р…Р С• + Р Р€Р Т‘Р ВµРЎР‚Р В¶Р С‘Р Р†Р В°Р ВµР СР В°РЎРЏ Р Т‘Р В°РЎвЂљР В°) РІвЂўС’РІвЂўС’РІвЂўС’
                    const recatchNodeOverride = getCurrentNodeOverride();
                    let recatchTarget = { ...buildEffectiveTarget(target, recatchNodeOverride, { logRolling: false }) };
                    if (recatchNodeOverride && recatchNodeOverride.rolling_days_ahead !== undefined) {
                      const romeDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
                      const [ry, rm, rd] = romeDate.split('-').map(Number);
                      const todayRome = new Date(Date.UTC(ry, rm - 1, rd));
                      const startDate = new Date(todayRome);
                      startDate.setUTCDate(startDate.getUTCDate() + recatchNodeOverride.rolling_days_ahead);
                      const count = recatchNodeOverride.rolling_days_count || 3;
                      const endDate = new Date(startDate);
                      endDate.setUTCDate(endDate.getUTCDate() + count - 1);
                      recatchTarget.target_date_start = startDate.toISOString().split('T')[0];
                      recatchTarget.target_date_end = endDate.toISOString().split('T')[0];
                    }
                    if (recatchTarget.target_date_start && recatchTarget.target_date_end) {
                      const holdDateYMD = holdSlot.startDateTime.split('T')[0];
                      if (holdDateYMD < recatchTarget.target_date_start) recatchTarget.target_date_start = holdDateYMD;
                      if (holdDateYMD > recatchTarget.target_date_end) recatchTarget.target_date_end = holdDateYMD;
                      delete recatchTarget.target_date;
                    }

                    const recatchResult = await checkAvailability(holdPage, recatchTarget);

                    if (recatchResult && recatchResult.status === 'available') {
                      // РІвЂўС’РІвЂўС’РІвЂўС’ SLOT COORDINATION: Р Р†РЎвЂ№Р В±Р С‘РЎР‚Р В°Р ВµР С Р С•Р С—РЎвЂљР С‘Р СР В°Р В»РЎРЉР Р…РЎвЂ№Р в„– РЎРѓР В»Р С•РЎвЂљ Р С—РЎР‚Р С‘ re-catch РІвЂўС’РІвЂўС’РІвЂўС’
                      const recatchBestSlot = pickBestSlot(recatchResult.slots);
                      // РІвЂўС’РІвЂўС’РІвЂўС’ SLOT COORDINATION: PRE-CLAIM Р С—РЎР‚Р С‘ re-catch РІвЂўС’РІвЂўС’РІвЂўС’
                      claimSlot(recatchBestSlot.startDateTime);
                      const plPayload = interceptedCalendars[recatchTarget.url.split('?')[0]];
                      let cartResult = await addToCart(holdPage, recatchBestSlot, recatchTarget, plPayload);

                      if (cartResult && cartResult.status === 'rejected') {
                        log('SCHEDULER', `[SCHEDULER] recatch_addtocart_rejected_no_extra_retry slot=${recatchBestSlot.startDateTime} release_response=log_only`);
                        // Rotate proxy after recatch rejection: Octofence flags the IP after POST /addtocart,
                        // causing WAF 403 on subsequent calendar requests from the same proxy.
                        rotateProxyAfterWafPressure('recatch_addtocart_rejected_409');
                        consecutiveErrors = 2; // Force browser recreate on next cycle
                        for (let key in interceptedCalendars) delete interceptedCalendars[key];
                        break;
                      }

                      if (cartResult && cartResult.success === true) {
                        holdSlot = cartResult.slot || recatchBestSlot;
                        holdModeActive = true;
                        caught = true;
                        ticketInfo = cartResult.ticketInfo || ticketInfo;
                        log('СЂСџР‹вЂ°', `РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’`);
                        log('СЂСџР‹вЂ°', `  RE-CATCH #${holdCycleCount} Р Р€Р РЋР СџР вЂўР Тђ!`);
                        log('СЂСџР‹вЂ°', `  Р СџРЎР‚Р С•Р С”РЎРѓР С‘ #${currentProxyIndex} | ${holdSlot.startDateTime}`);
                        log('СЂСџР‹вЂ°', `РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’`);

                        // Р С›Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С hold info
                        holdModeSlotInfo = { slot: holdSlot, target: recatchTarget, ticketInfo, bookingPlan: cartResult.bookingPlan || null };
                        holdDeadlineMs = Date.now() + HOLD_DURATION_MS;

                        // Р С›Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ: re-catch РЎС“РЎРѓР С—Р ВµРЎв‚¬Р ВµР Р…, Р РЋРЎвЂљР В°РЎвЂљРЎС“РЎРѓ РІвЂ вЂ™ Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р в„–
                        if (holdTelegramMsgId) {
                          await editTelegram(holdTelegramMsgId, buildHoldMessage(holdSlot.startDateTime, ticketInfo, holdCycleCount, currentProxyIndex, 'active'));
                        }
                        break;
                      } else if (cartResult && cartResult.status === WAF_PRESSURE_STATUS) {
                        log('WARN', `[RE-CATCH] Cart WAF pressure (${cartResult.reason || 'waf_pressure'}). Stop recatch until next strict-grid cycle.`);
                        consecutiveErrors = 2; // Proxy rotated; recreate browser before the next attempt.
                        for (let key in interceptedCalendars) delete interceptedCalendars[key];
                        break;
                      } else if (cartResult && cartResult.status === 'hard_blocked') {
                        log('РІС™В РїС‘РЏ', `[RE-CATCH] Р С™Р С•РЎР‚Р В·Р С‘Р Р…Р В° hard_blocked (WAF). Р СџРЎР‚Р ВµРЎР‚РЎвЂ№Р Р†Р В°Р ВµР С.`);
                        break;
                      } else if (cartResult && cartResult.status === 'rate_limited') {
                        // 429 Р С•РЎвЂљ Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎвЂ№ РІР‚вЂќ Р С—Р В°РЎС“Р В·Р В° Р С‘ Р С—Р С•Р Р†РЎвЂљР С•РЎР‚, Р Р…Р Вµ abort
                        log('РІРЏС–', `[RE-CATCH] 429 Р С•РЎвЂљ Р С”Р С•РЎР‚Р В·Р С‘Р Р…РЎвЂ№. Р СџР В°РЎС“Р В·Р В° 15РЎРѓ Р С‘ Р С—РЎР‚Р С•Р Т‘Р С•Р В»Р В¶Р В°Р ВµР С...`);
                        await sleep(15000);
                        continue;
                      }
                      // Р вЂўРЎРѓР В»Р С‘ addToCart Р Р†Р ВµРЎР‚Р Р…РЎС“Р В» false (409/rejected) РІР‚вЂќ РЎРѓР В»Р С•РЎвЂљ Р ВµРЎвЂ°РЎвЂ Р В·Р В°Р Р…РЎРЏРЎвЂљ, Р В¶Р Т‘РЎвЂР С
                    }

                    if (recatchResult && recatchResult.status === WAF_PRESSURE_STATUS) {
                      log('WARN', `[RE-CATCH] Calendar WAF pressure (${recatchResult.reason || 'waf_pressure'}). Stop recatch until next strict-grid cycle.`);
                      consecutiveErrors = 2; // Proxy rotated; recreate browser before the next attempt.
                      for (let key in interceptedCalendars) delete interceptedCalendars[key];
                      break;
                    }
                    if (recatchResult && (recatchResult.status === 'hard_blocked')) {
                      log('РІС™В РїС‘РЏ', `[RE-CATCH] Calendar hard_blocked. Р СџРЎР‚Р ВµРЎР‚РЎвЂ№Р Р†Р В°Р ВµР С.`);
                      break;
                    }
                    if (recatchResult && recatchResult.status === 'rate_limited') {
                      // 429 Р С—РЎР‚Р С‘ re-catch РІР‚вЂќ Р СњР вЂў Р С—РЎР‚Р ВµРЎР‚РЎвЂ№Р Р†Р В°Р ВµР С, Р В° Р В¶Р Т‘РЎвЂР С 15РЎРѓ Р С‘ Р С—РЎР‚Р С•Р Т‘Р С•Р В»Р В¶Р В°Р ВµР С
                      log('РІРЏС–', `[RE-CATCH] 429 rate limit. Р СџР В°РЎС“Р В·Р В° 15РЎРѓ Р С‘ Р С—РЎР‚Р С•Р Т‘Р С•Р В»Р В¶Р В°Р ВµР С...`);
                      await sleep(15000);
                      continue;
                    }

                    log('SCHEDULER', `[SCHEDULER] recatch_slot_done_no_ticket attempt=${attempt}/${RECATCH_MAX_ATTEMPTS}`);
                  }

                  // РІвЂўС’РІвЂўС’РІвЂўС’ Р С›Р В±РЎР‚Р В°Р В±Р С•РЎвЂљР С”Р В° РЎР‚Р ВµР В·РЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂљР В° re-catch РІвЂўС’РІвЂўС’РІвЂўС’
                  if (payCommandReceived) {
                    // /pay Р С—РЎР‚Р С‘РЎв‚¬РЎвЂР В» Р Р†Р С• Р Р†РЎР‚Р ВµР СРЎРЏ re-catch
                    if (caught) {
                      // Р вЂР С‘Р В»Р ВµРЎвЂљРЎвЂ№ РЎС“Р В¶Р Вµ Р Р† Р С”Р С•РЎР‚Р В·Р С‘Р Р…Р Вµ Р Р…Р В° Р Р…Р С•Р Р†Р С•Р С Р С—РЎР‚Р С•Р С”РЎРѓР С‘ РІР‚вЂќ checkout Р С•РЎвЂљРЎвЂљРЎС“Р Т‘Р В°
                      payCommandReceived = false;
                      holdModeActive = false;
                      config.application.holdMode = false;
                      if (holdTelegramMsgId) {
                        await editTelegram(holdTelegramMsgId, buildHoldMessage(holdSlot.startDateTime, ticketInfo, holdCycleCount, currentProxyIndex, 'checkout'));
                      }
                      const checkoutResult = await performCheckout(holdBrowser, holdPage, holdSlot.startDateTime, ticketInfo, {
                        detailGuids: cartItemsInfo?.detailGuids || [],
                        passengerDetails: payPassengerDetails
                      });
                      if (checkoutResult?.controlled) {
                        holdBrowser = null;
                        holdPage = null;
                        await parkBotDuringManualCheckout('recatch_controlled_checkout', {
                          slot: holdSlot?.startDateTime || holdSlot,
                          ticketInfo,
                          checkoutProfile: checkoutResult.checkoutProfile || null
                        }, checkoutResult.page || null);
                      }
                      browser = null;
                      page = null;
                      consecutiveErrors = 0;
                      pausedUntilMs = Date.now() + SUCCESS_WAIT_MS;
                    } else {
                      // Р вЂР С‘Р В»Р ВµРЎвЂљРЎвЂ№ Р Р…Р Вµ Р С—Р С•Р в„–Р СР В°Р Р…РЎвЂ№, Р Р…Р С• /pay РІР‚вЂќ Р С—РЎР‚Р С•РЎРѓРЎвЂљР С• Р Р†РЎвЂ№РЎвЂ¦Р С•Р Т‘Р С‘Р С
                      payCommandReceived = false;
                      holdModeActive = false;
                      browser = holdBrowser;
                      page = holdPage;
                      if (holdTelegramMsgId) {
                        await editTelegram(holdTelegramMsgId, buildHoldMessage(holdSlot.startDateTime, ticketInfo, holdCycleCount, currentProxyIndex, 'inactive'));
                      }
                    }
                    exitHold = true;
                  } else if (caught) {
                    // Р Р€РЎРѓР С—Р ВµРЎв‚¬Р Р…РЎвЂ№Р в„– re-catch РІвЂ вЂ™ Р С—РЎР‚Р С•Р Т‘Р С•Р В»Р В¶Р В°Р ВµР С hold loop (Р Р…Р С•Р Р†РЎвЂ№Р в„– РЎвЂ Р С‘Р С”Р В» 14 Р СР С‘Р Р…)
                    log('СЂСџвЂќвЂћ', `[HOLD] Re-catch РЎС“РЎРѓР С—Р ВµРЎв‚¬Р ВµР Р…! Р СњР В°РЎвЂЎР С‘Р Р…Р В°Р ВµР С Р Р…Р С•Р Р†РЎвЂ№Р в„– hold РЎвЂ Р С‘Р С”Р В» #${holdCycleCount + 1}...`);
                    // Loop continues
                  } else {
                    // Re-catch Р Р…Р Вµ РЎС“Р Т‘Р В°Р В»РЎРѓРЎРЏ Р В·Р В° 60РЎРѓ РІР‚вЂќ Р Р†РЎвЂ№РЎвЂ¦Р С•Р Т‘Р С‘Р С Р Р† Р С•Р В±РЎвЂ№РЎвЂЎР Р…РЎвЂ№Р в„– РЎР‚Р ВµР В¶Р С‘Р С
                    log('РІСњРЉ', `[HOLD] Re-catch Р Р…Р Вµ РЎС“Р Т‘Р В°Р В»РЎРѓРЎРЏ Р В·Р В° ${RECATCH_MAX_DURATION_MS / 1000}РЎРѓ.`);
                    if (holdTelegramMsgId) {
                      await editTelegram(holdTelegramMsgId, buildHoldMessage(holdSlot.startDateTime, ticketInfo, holdCycleCount, currentProxyIndex, 'inactive'));
                    }
                    holdModeActive = false;
                    holdModeSlotInfo = null;
                    if (consecutiveErrors >= 2) {
                      if (holdBrowser) await closeBrowserAndFlushProxyReleases(holdBrowser, 'recatch_failed_pressure');
                      holdBrowser = null;
                      holdPage = null;
                      browser = null;
                      page = null;
                    } else {
                      browser = holdBrowser;
                      page = holdPage;
                    }
                    // Р СџРЎР‚Р С•Р Т‘Р С•Р В»Р В¶Р В°Р ВµР С Р С•Р В±РЎвЂ№РЎвЂЎР Р…РЎвЂ№Р в„– РЎвЂ Р С‘Р С”Р В» РІР‚вЂќ Р Р…Р Вµ РЎРѓРЎвЂљР В°Р Р†Р С‘Р С consecutiveErrors РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р Р…Р Вµ Р С—Р ВµРЎР‚Р ВµРЎРѓР С•Р В·Р Т‘Р В°Р Р†Р В°РЎвЂљРЎРЉ Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚
                    exitHold = true;
                  }
                } else {
                  // РІвЂўС’РІвЂўС’РІвЂўС’ FALLBACK: Pre-load Р Р…Р Вµ РЎС“Р Т‘Р В°Р В»РЎРѓРЎРЏ РІвЂўС’РІвЂўС’РІвЂўС’
                  log('РІС™В РїС‘РЏ', `[HOLD] Pre-load Р Р…Р ВµР Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р ВµР Р…. Р вЂРЎвЂ№РЎРѓРЎвЂљРЎР‚Р С•Р Вµ Р С—Р ВµРЎР‚Р ВµР С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘Р Вµ...`);
                  // Р вЂ”Р В°Р С”РЎР‚РЎвЂ№Р Р†Р В°Р ВµР С pre-load Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ Р ВµРЎРѓР В»Р С‘ Р С•Р Р… Р В±РЎвЂ№Р В» РЎРѓР С•Р В·Р Т‘Р В°Р Р… (Р Р…Р С• Р В±Р ВµР В· payload)
                  if (preloaded && preloaded.browser) {
                    await preloaded.browser.close().catch(() => { });
                    await releaseProxyLeaseNow(getProxyLeaseReleaseTarget(preloaded.proxyLease), 'preload_closed_no_payload');
                    stopProxyRelayForIndex(preloaded.proxyIdx, 'preload_closed_no_payload');
                    log('СЂСџВ§в„–', `Pre-load Р В±РЎР‚Р В°РЎС“Р В·Р ВµРЎР‚ #${preloaded.proxyIdx} Р В·Р В°Р С”РЎР‚РЎвЂ№РЎвЂљ.`);
                  }
                  if (holdTelegramMsgId) {
                    await editTelegram(holdTelegramMsgId, buildHoldMessage(holdSlot.startDateTime, ticketInfo, holdCycleCount, currentProxyIndex, 'inactive'));
                  }
                  switchProxy('hold-expired-no-preload');
                  for (let key in interceptedCalendars) delete interceptedCalendars[key];
                  holdModeActive = false;
                  holdModeSlotInfo = null;
                  browser = null;
                  page = null;
                  consecutiveErrors = 2; // Force browser recreate
                  exitHold = true;
                }
              }

              // РІвЂўС’РІвЂўС’РІвЂўС’ Р СџР С•РЎРѓР В»Р Вµ Р Р†РЎвЂ№РЎвЂ¦Р С•Р Т‘Р В° Р С‘Р В· hold loop РІР‚вЂќ Р С•Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С РЎРѓР С•РЎРѓРЎвЂљР С•РЎРЏР Р…Р С‘Р Вµ main loop РІвЂўС’РІвЂўС’РІвЂўС’
              if (!browser && holdBrowser) {
                browser = holdBrowser;
                page = holdPage;
              }
              break;
            }

            // РІвЂўС’РІвЂўС’РІвЂўС’ NORMAL MODE: Checkout (Р В±Р ВµР В· hold) РІвЂўС’РІвЂўС’РІвЂўС’
            const checkoutBrowser = browser;
            const checkoutPage = page;
            const checkoutCartCheck = await verifyHeldCart(checkoutPage);
            if (checkoutCartCheck.alive === false) {
              markHeldCartReleased(`pre_checkout_${checkoutCartCheck.reason || 'unknown'}`);
              break;
            }
            browser = null;
            page = null;
            consecutiveErrors = 0;
            const checkoutResult = await performCheckout(checkoutBrowser, checkoutPage, coordBestSlot.startDateTime, ticketInfo, {
              detailGuids: cartItemsInfo?.detailGuids || []
            });
            if (checkoutResult?.controlled) {
              await parkBotDuringManualCheckout('normal_controlled_checkout', {
                slot: coordBestSlot.startDateTime,
                ticketInfo,
                checkoutProfile: checkoutResult.checkoutProfile || null
              }, checkoutResult.page || null);
            }

            await notifyTelegram(`СЂСџР‹вЂ° Р вЂР ВР вЂєР вЂўР СћР В« Р вЂ™ Р С™Р С›Р В Р вЂ”Р ВР СњР вЂў!\nРІРЏВ° Р РЋР В»Р С•РЎвЂљ: ${coordBestSlot.startDateTime}\nСЂСџР‹В« Р вЂР С‘Р В»Р ВµРЎвЂљРЎвЂ№: ${ticketInfo}\nСЂСџР‹Р‡ Url: https://ticketing.colosseo.it/it/checkout`);

            // РІвЂўС’РІвЂўС’РІвЂўС’ Р СџР В°РЎС“Р В·Р В° Р С—Р С•РЎРѓР В»Р Вµ РЎС“РЎРѓР С—Р ВµРЎвЂ¦Р В° РІР‚вЂќ 15 Р СР С‘Р Р…РЎС“РЎвЂљ РІвЂўС’РІвЂўС’РІвЂўС’
            log('РІРЏС‘РїС‘РЏ', `Р Р€РЎРѓР С—Р ВµРЎв‚¬Р Р…Р В°РЎРЏ Р С—Р С•Р С”РЎС“Р С—Р С”Р В°: Р С—Р В°РЎС“Р В·Р В° ${SUCCESS_WAIT_MS / 60000} Р СР С‘Р Р…. Р вЂ”Р В°Р С—РЎР‚Р С•РЎРѓРЎвЂ№ Р С—РЎР‚Р С‘Р С•РЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…РЎвЂ№.`);
            pausedUntilMs = Date.now() + SUCCESS_WAIT_MS;
            break;
          }
        }
      }

      // Р РЋР В±РЎР‚Р В°РЎРѓРЎвЂ№Р Р†Р В°Р ВµР С РЎвЂћР В»Р В°Р С– РЎвЂљР ВµРЎРѓРЎвЂљР С•Р Р†Р С•Р С–Р С• Р С—РЎР‚Р С•РЎРѓРЎвЂљРЎР‚Р ВµР В»Р В° Р С—Р С•РЎРѓР В»Р Вµ Р С”Р В°Р В¶Р Т‘Р С•Р С–Р С• РЎвЂ Р С‘Р С”Р В»Р В°
      isTestProbe = false;

      // Р вЂ“Р Т‘РЎвЂР С РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р С‘Р в„– РЎвЂ Р С‘Р С”Р В» (Epoch Grid: РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С• Р С—Р С• Р В°Р В±РЎРѓР С•Р В»РЎР‹РЎвЂљР Р…РЎвЂ№Р С РЎвЂЎР В°РЎРѓР В°Р С + jitter)
      const prewarmed = await prewarmBrowserBeforeNextStrictSlot(browser, page, consecutiveErrors);
      browser = prewarmed.browser;
      page = prewarmed.page;
      consecutiveErrors = prewarmed.consecutiveErrors;
      await waitForNextPoll();

    } catch (err) {
      log('РІСњРЉ', `Р С™РЎР‚Р С‘РЎвЂљР С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ Р С›РЎв‚¬Р С‘Р В±Р С”Р В°: ${err.message}`);
      consecutiveErrors++;
      await sleep(10000);
    }
  }
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
