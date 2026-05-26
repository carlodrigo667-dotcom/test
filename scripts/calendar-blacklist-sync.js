#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function appendJsonLine(file, value) {
  const dir = path.dirname(file);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf8');
}

function pick(line, re) {
  const match = re.exec(line);
  return match ? match[1].trim() : '';
}

function classify(line) {
  if (line.includes('fetch failed after static WAF payload')) return 'calendar_fetch_failed_after_page_waf';
  if (line.includes('[CALENDAR] WAF 403')) return 'calendar_waf_403';
  return '';
}

function getIpv4Subnet24(ip) {
  const parts = String(ip || '').split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return '';
  const nums = parts.map((part) => Number(part));
  if (nums.some((num) => !Number.isInteger(num) || num < 0 || num > 255)) return '';
  return `${nums[0]}.${nums[1]}.${nums[2]}.0/24`;
}

function normalizeAsn(asn) {
  const value = String(asn || '').replace(/\s+/g, ' ').trim();
  return /^n\/?a$/i.test(value) ? '' : value;
}

function normalizeState(state) {
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

function extractEvent(line, nodeId) {
  const outcome = classify(line);
  if (!outcome || !line.includes('ctx=url=')) return null;

  const proxyIndex = Number(pick(line, /proxyIndex=(\d+)/));
  if (!Number.isInteger(proxyIndex)) return null;
  const proxyServer = pick(line, /proxyServer=([^\s]+)/);
  const ip = proxyServer.split(':')[0] || '';
  const subnet = getIpv4Subnet24(ip);
  const asn = normalizeAsn(pick(line, /\basn=(.+?)\s+cache=/));
  const now = Date.now();
  const ctx = {
    url: pick(line, /\bctx=url=(.+?)\s+origin=/),
    origin: pick(line, /\borigin=(.+?)\s+ref=/),
    ref: pick(line, /\bref=(.+?)\s+cookies=/),
    cookies: pick(line, /\bcookies=(.+?)\s+php=/),
    php: pick(line, /\bphp=(yes|no)/),
    octo: pick(line, /\bocto=(yes|no)/),
    ready: pick(line, /\bready=([^\s]+)/),
  };

  return {
    at: now,
    isoTime: new Date(now).toISOString(),
    nodeId,
    outcome,
    reason: outcome,
    proxyIndex,
    proxyServer,
    ip,
    subnet,
    asn,
    mslc: pick(line, /\bmslc=([^\s]+)/),
    cache: pick(line, /\bcache=([^\s]+)/),
    octo: ctx.octo || 'no',
    php: ctx.php || 'no',
    ref: ctx.ref || '',
    origin: ctx.origin || '',
    pageUrl: ctx.url || '',
    readyState: ctx.ready || '',
  };
}

function countDistinct(events, field, value, cutoffMs) {
  if (!field || !value) return 0;
  const set = new Set();
  for (const event of events) {
    if (Number(event.at || 0) < cutoffMs) continue;
    if (event[field] === value) set.add(String(event.proxyIndex));
  }
  return set.size;
}

const args = parseArgs(process.argv.slice(2));
const nodeId = Number(args['node-id'] || process.env.NODE_ID || 0);
const logFile = args.log || process.env.CALENDAR_CTX_LOG || 'sniper.log';
const stateFile = (args.state || process.env.CALENDAR_BLACKLIST_STATE_FILE || `/tmp/sniper-calendar-blacklist-node${nodeId}.json`).replace(/\$\{NODE_ID\}|%NODE_ID%/g, String(nodeId));
const banStateFile = (args['ban-state'] || process.env.BAN_STATE_FILE || `/tmp/sniper-proxy-bans-node${nodeId}.json`).replace(/\$\{NODE_ID\}|%NODE_ID%/g, String(nodeId));
const auditFile = args.audit || process.env.CALENDAR_BLACKLIST_LOG_FILE || 'calendar_blacklist.log';
const durationMs = Math.max(0, Number(args['duration-ms'] || process.env.CALENDAR_BLACKLIST_BLOCK_MS || 4 * 60 * 60 * 1000));
const octoDurationMs = Math.max(durationMs, Number(args['octo-duration-ms'] || process.env.CALENDAR_BLACKLIST_OCTO_NEGATIVE_MS || 24 * 60 * 60 * 1000));
const groupWindowMs = Math.max(60000, Number(args['group-window-ms'] || process.env.CALENDAR_BLACKLIST_GROUP_WINDOW_MS || 24 * 60 * 60 * 1000));
const groupBlockMs = Math.max(durationMs, Number(args['group-block-ms'] || process.env.CALENDAR_BLACKLIST_GROUP_BLOCK_MS || durationMs));
const subnetThreshold = Math.max(0, Number(args['subnet-threshold'] || process.env.CALENDAR_BLACKLIST_SUBNET_THRESHOLD || 2));
const asnThreshold = Math.max(0, Number(args['asn-threshold'] || process.env.CALENDAR_BLACKLIST_ASN_THRESHOLD || 2));

if (!fs.existsSync(logFile)) {
  console.log(JSON.stringify({ ok: false, error: 'log_not_found', logFile }, null, 2));
  process.exit(0);
}

const state = normalizeState(readJson(stateFile, {}));
const banState = readJson(banStateFile, {});
banState.proxyBans = banState.proxyBans && typeof banState.proxyBans === 'object' ? banState.proxyBans : {};

const processed = new Set(state.processedLineHashes || []);
const now = Date.now();
const cutoff = now - groupWindowMs;
const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-5000);
const newEvents = [];

for (const line of lines) {
  if (!line.includes('ctx=url=')) continue;
  const hash = crypto.createHash('sha1').update(line).digest('hex');
  if (processed.has(hash)) continue;
  const event = extractEvent(line, nodeId);
  if (!event) continue;
  const alreadyRecorded = (state.events || []).some((existing) => (
    String(existing.proxyIndex) === String(event.proxyIndex)
    && existing.outcome === event.outcome
    && existing.proxyServer === event.proxyServer
    && Math.abs(Number(existing.at || 0) - Date.now()) < 10 * 60 * 1000
  ));
  processed.add(hash);
  if (alreadyRecorded) continue;
  let blockMs = durationMs;
  if (event.octo === 'yes' || event.outcome === 'calendar_fetch_failed_after_page_waf') blockMs = Math.max(blockMs, octoDurationMs);
  event.blockedUntil = now + blockMs;
  event.blockedUntilIso = new Date(event.blockedUntil).toISOString();
  event.durationMs = blockMs;
  newEvents.push(event);
}

for (const event of newEvents) {
  const idxKey = String(event.proxyIndex);
  const previous = state.proxies[idxKey] || {};
  state.proxies[idxKey] = {
    ...previous,
    proxyIndex: event.proxyIndex,
    proxyServer: event.proxyServer,
    ip: event.ip,
    subnet: event.subnet,
    asn: event.asn,
    lastOutcome: event.outcome,
    lastAt: event.at,
    blockedUntil: Math.max(Number(previous.blockedUntil || 0), event.blockedUntil),
    octo: event.octo,
    php: event.php,
    ref: event.ref,
    count: Number(previous.count || 0) + 1
  };
  if (event.ip) {
    const previousIp = state.ipBlocks[event.ip] || {};
    state.ipBlocks[event.ip] = {
      ...previousIp,
      blockedUntil: Math.max(Number(previousIp.blockedUntil || 0), event.blockedUntil),
      reason: event.outcome,
      proxyIndex: event.proxyIndex,
      asn: event.asn,
      lastAt: event.at
    };
  }
  state.events.push(event);
  banState.proxyBans[idxKey] = Math.max(Number(banState.proxyBans[idxKey] || 0), event.blockedUntil);
  appendJsonLine(auditFile, event);
}

state.events = state.events.filter((event) => Number(event.at || 0) >= cutoff).slice(-1000);
state.processedLineHashes = Array.from(processed).slice(-5000);

for (const event of newEvents) {
  if (subnetThreshold > 0 && event.subnet) {
    const count = countDistinct(state.events, 'subnet', event.subnet, cutoff);
    if (count >= subnetThreshold) {
      const until = now + groupBlockMs;
      state.subnetBlocks[event.subnet] = { blockedUntil: until, reason: 'calendar_waf_subnet_threshold', count, lastAt: now };
    }
  }
  if (asnThreshold > 0 && event.asn) {
    const count = countDistinct(state.events, 'asn', event.asn, cutoff);
    if (count >= asnThreshold) {
      const until = now + groupBlockMs;
      state.asnBlocks[event.asn] = { blockedUntil: until, reason: 'calendar_waf_asn_threshold', count, lastAt: now };
    }
  }
}

for (const groupName of ['proxies', 'ipBlocks', 'subnetBlocks', 'asnBlocks']) {
  for (const [key, entry] of Object.entries(state[groupName])) {
    if (Number(entry.blockedUntil || 0) <= now) delete state[groupName][key];
  }
}

banState.currentProxyIndex = banState.currentProxyIndex ?? 0;
banState.savedAt = now;
writeJsonAtomic(stateFile, { ...state, savedAt: now });
writeJsonAtomic(banStateFile, banState);

console.log(JSON.stringify({
  ok: true,
  logFile,
  stateFile,
  banStateFile,
  auditFile,
  newEvents: newEvents.length,
  blockedProxyIndexes: Object.keys(state.proxies).length,
  subnetBlocks: Object.keys(state.subnetBlocks).length,
  asnBlocks: Object.keys(state.asnBlocks).length
}, null, 2));
