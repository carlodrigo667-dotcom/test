#!/usr/bin/env node
/**
 * Slot Registry — координация слотов между ботами.
 * Живёт на мастер-сервере (Node 1). Управляет /root/slot-registry.json.
 *
 * Использование:
 *   node slot-registry.js read                     — вывести реестр (JSON)
 *   node slot-registry.js claim <nodeId> <slot>    — записать/обновить слот ноды
 *   node slot-registry.js release <nodeId>         — удалить запись ноды
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = process.env.REGISTRY_PATH || '/root/slot-registry.json';
const REGISTRY_LOCK_PATH = `${REGISTRY_PATH}.lock`;
const DEFAULT_TTL_MS = 16 * 60 * 1000;
const LOCK_TTL_MS = 8000;

function getTtlMs() {
  const envTtl = parseInt(process.env.REGISTRY_TTL_MS || '', 10);
  return Number.isFinite(envTtl) && envTtl > 0 ? envTtl : DEFAULT_TTL_MS;
}

function cleanupPath(p) {
  if (!fs.existsSync(p)) return;
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    // ignore
  }
}

function getLock() {
  const deadline = Date.now() + 4000;
  const lock = REGISTRY_LOCK_PATH;
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lock);
      return;
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const st = fs.statSync(lock);
          if (Date.now() - st.mtimeMs > LOCK_TTL_MS) {
            cleanupPath(lock);
            continue;
          }
        } catch (ignore) {
          cleanupPath(lock);
          continue;
        }
      } else {
        throw e;
      }
    }
  }
  throw new Error('slot registry lock timeout');
}

function releaseLock() {
  cleanupPath(REGISTRY_LOCK_PATH);
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function save(data) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf8');
}

const [,, action, nodeId, slotTime] = process.argv;
const REG_TTL = getTtlMs();

function withRegistry(body) {
  getLock();
  try {
    return body();
  } finally {
    releaseLock();
  }
}

function purgeExpired(reg) {
  const now = Date.now();
  const next = {};
  for (const [nid, entry] of Object.entries(reg || {})) {
    if (!entry || typeof entry !== 'object') continue;
    if (now - Number(entry.updated || 0) > REG_TTL) continue;
    next[nid] = entry;
  }
  return next;
}

function commandUsage() {
  console.error('Usage: node slot-registry.js <read|claim|acquire|release> <nodeId> [slotTime]');
}

switch (action) {
  case 'acquire': {
    if (!nodeId || !slotTime) {
      commandUsage();
      process.exit(1);
    }
    const reg = withRegistry(() => {
      const current = purgeExpired(load());
      const conflict = Object.entries(current).find(([otherId, entry]) => {
        return otherId !== nodeId && String(entry?.slot || '') === String(slotTime) &&
          (Date.now() - Number(entry?.updated || 0) <= REG_TTL);
      });
      if (conflict) {
        return { reg: current, conflict: conflict[0] };
      }
      current[nodeId] = { slot: slotTime, updated: Date.now() };
      save(current);
      return { reg: current, conflict: null };
    });

    if (reg.conflict) {
      console.log(`CONFLICT ${reg.conflict}`);
      process.exit(0);
    }
    console.log('OK');
    break;
  }

  case 'claim': {
    if (!nodeId || !slotTime) {
      console.error('Usage: node slot-registry.js claim <nodeId> <slotTime>');
      process.exit(1);
    }
    withRegistry(() => {
      const reg = purgeExpired(load());
      reg[nodeId] = { slot: slotTime, updated: Date.now() };
      save(reg);
      return true;
    });
    console.log('OK');
    break;
  }

  case 'release': {
    if (!nodeId) {
      console.error('Usage: node slot-registry.js release <nodeId>');
      process.exit(1);
    }
    withRegistry(() => {
      const reg = purgeExpired(load());
      delete reg[nodeId];
      save(reg);
      return true;
    });
    console.log('OK');
    break;
  }

  case 'read':
  default: {
    console.log(JSON.stringify(load()));
    break;
  }
}
