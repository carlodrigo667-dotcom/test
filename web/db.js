/**
 * 🗄️ Database Layer — SQLite via better-sqlite3
 * 
 * Tables:
 *   nodes   — live status of each node (updated by heartbeats)
 *   events  — historical log of important events
 *   config  — key-value store for job configuration
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'control-center.db');
const LEGACY_DB_PATH = path.join(__dirname, 'control-center.db');

let db;

function nowSql() {
  return new Date().toISOString();
}

function init() {
  const fs = require('fs');
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // One-time compatibility move for older installs that kept the DB in web/control-center.db.
  if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY,
      ip TEXT NOT NULL,
      status TEXT DEFAULT 'offline',
      bot_status TEXT DEFAULT 'stopped',
      current_slot TEXT,
      current_proxy INTEGER DEFAULT 0,
      proxy_bans TEXT DEFAULT '{}',
      cart_items TEXT,
      hold_cycle INTEGER DEFAULT 0,
      last_error TEXT,
      last_heartbeat TEXT,
      uptime_seconds INTEGER DEFAULT 0,
      extra TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id INTEGER,
      type TEXT NOT NULL,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload TEXT DEFAULT '{}',
      total_count INTEGER DEFAULT 0,
      completed_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      node_id INTEGER,
      label TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      message TEXT,
      meta TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      node_count INTEGER NOT NULL DEFAULT 0,
      online_count INTEGER NOT NULL DEFAULT 0,
      payment_count INTEGER NOT NULL DEFAULT 0,
      hold_count INTEGER NOT NULL DEFAULT 0,
      checkout_count INTEGER NOT NULL DEFAULT 0,
      active_slot_count INTEGER NOT NULL DEFAULT 0,
      problem_count INTEGER NOT NULL DEFAULT 0,
      diagnostic_noise_count INTEGER NOT NULL DEFAULT 0,
      running_job_count INTEGER NOT NULL DEFAULT 0,
      status_counts_json TEXT DEFAULT '{}',
      issue_counts_json TEXT DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_events_node ON events(node_id);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id);
    CREATE INDEX IF NOT EXISTS idx_job_items_node ON job_items(node_id);
    CREATE INDEX IF NOT EXISTS idx_metric_snapshots_captured ON metric_snapshots(captured_at);
  `);

  return db;
}

// ═══════════════════════════════════════════════════════
//  NODE OPERATIONS
// ═══════════════════════════════════════════════════════

function upsertNode(id, ip) {
  const stmt = db.prepare(`
    INSERT INTO nodes (id, ip) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET ip = excluded.ip
  `);
  return stmt.run(id, ip);
}

function getAllNodes() {
  return db.prepare('SELECT * FROM nodes ORDER BY id').all();
}

function getNode(id) {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
}

function updateNodeHeartbeat(nodeId, data) {
  const stmt = db.prepare(`
    UPDATE nodes SET
      status = 'online',
      bot_status = COALESCE(?, bot_status),
      current_slot = ?,
      current_proxy = COALESCE(?, current_proxy),
      proxy_bans = COALESCE(?, proxy_bans),
      cart_items = ?,
      hold_cycle = COALESCE(?, hold_cycle),
      last_error = ?,
      last_heartbeat = datetime('now'),
      uptime_seconds = COALESCE(?, uptime_seconds),
      extra = COALESCE(?, extra)
    WHERE id = ?
  `);
  return stmt.run(
    data.botStatus || null,
    data.currentSlot || null,
    data.currentProxy ?? null,
    data.proxyBans ? JSON.stringify(data.proxyBans) : null,
    data.cartItems || null,
    data.holdCycle ?? null,
    data.lastError || null,
    data.uptimeSeconds ?? null,
    data.extra ? JSON.stringify(data.extra) : null,
    nodeId
  );
}

function setNodeStatus(nodeId, status, botStatus) {
  const updates = [];
  const params = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (botStatus) { updates.push('bot_status = ?'); params.push(botStatus); }
  if (updates.length === 0) return;
  params.push(nodeId);
  db.prepare(`UPDATE nodes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

function markStaleNodes(thresholdSeconds = 30) {
  db.prepare(`
    UPDATE nodes SET status = 'offline'
    WHERE status = 'online'
      AND last_heartbeat IS NOT NULL
      AND (julianday('now') - julianday(last_heartbeat)) * 86400 > ?
  `).run(thresholdSeconds);
}

// ═══════════════════════════════════════════════════════
//  EVENT OPERATIONS
// ═══════════════════════════════════════════════════════

function addEvent(nodeId, type, message) {
  db.prepare('INSERT INTO events (node_id, type, message) VALUES (?, ?, ?)').run(nodeId, type, message);
}

function getEvents(opts = {}) {
  const { nodeId, type, limit = 100 } = opts;
  let sql = 'SELECT * FROM events WHERE 1=1';
  const params = [];
  if (nodeId) { sql += ' AND node_id = ?'; params.push(nodeId); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

// ═══════════════════════════════════════════════════════
//  CONFIG OPERATIONS
// ═══════════════════════════════════════════════════════

function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

function getAllConfig() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const result = {};
  for (const row of rows) {
    try { result[row.key] = JSON.parse(row.value); } catch { result[row.key] = row.value; }
  }
  return result;
}

// ═══════════════════════════════════════════════════════
//  SLOT REGISTRY (replaces slot-registry.json)
// ═══════════════════════════════════════════════════════

function getSlotRegistry() {
  const nodes = db.prepare('SELECT id, current_slot, last_heartbeat FROM nodes WHERE current_slot IS NOT NULL').all();
  const registry = {};
  for (const n of nodes) {
    registry[n.id] = { slot: n.current_slot, updated: n.last_heartbeat };
  }
  return registry;
}

function createJob({ kind, title, payload = {}, items = [] }) {
  const timestamp = nowSql();
  const insertJob = db.prepare(`
    INSERT INTO jobs (
      kind, title, status, payload, total_count, created_at, updated_at
    ) VALUES (?, ?, 'queued', ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO job_items (
      job_id, node_id, label, status, message, meta, created_at, updated_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    const result = insertJob.run(
      kind,
      title,
      JSON.stringify(payload || {}),
      items.length,
      timestamp,
      timestamp
    );
    const jobId = result.lastInsertRowid;
    items.forEach((item) => {
      insertItem.run(
        jobId,
        item.nodeId ?? null,
        item.label || null,
        item.message || null,
        JSON.stringify(item.meta || {}),
        timestamp,
        timestamp
      );
    });
    return jobId;
  });

  return getJob(tx());
}

function setJobStatus(jobId, status, extra = {}) {
  const timestamp = nowSql();
  const current = getJob(jobId);
  if (!current) return null;

  const startedAt = current.started_at || (status === 'running' ? timestamp : null);
  const finishedAt = ['done', 'failed', 'partial', 'canceled'].includes(status) ? timestamp : null;

  db.prepare(`
    UPDATE jobs
    SET
      status = ?,
      completed_count = COALESCE(?, completed_count),
      success_count = COALESCE(?, success_count),
      failed_count = COALESCE(?, failed_count),
      updated_at = ?,
      started_at = COALESCE(?, started_at),
      finished_at = ?
    WHERE id = ?
  `).run(
    status,
    extra.completedCount ?? null,
    extra.successCount ?? null,
    extra.failedCount ?? null,
    timestamp,
    startedAt,
    finishedAt,
    jobId
  );

  return getJob(jobId);
}

function updateJobCounters(jobId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN status IN ('done', 'failed', 'warning') THEN 1 ELSE 0 END) AS completed_count,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count
    FROM job_items
    WHERE job_id = ?
  `).get(jobId);

  db.prepare(`
    UPDATE jobs
    SET
      total_count = ?,
      completed_count = ?,
      success_count = ?,
      failed_count = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    row?.total_count || 0,
    row?.completed_count || 0,
    row?.success_count || 0,
    row?.failed_count || 0,
    nowSql(),
    jobId
  );

  return getJob(jobId);
}

function updateJobItem(jobItemId, patch = {}) {
  const timestamp = nowSql();
  const current = db.prepare('SELECT * FROM job_items WHERE id = ?').get(jobItemId);
  if (!current) return null;

  const nextStatus = patch.status || current.status;
  const startedAt = current.started_at || (nextStatus === 'running' ? timestamp : null);
  const finishedAt = ['done', 'failed', 'warning', 'canceled'].includes(nextStatus) ? timestamp : null;

  db.prepare(`
    UPDATE job_items
    SET
      status = ?,
      message = COALESCE(?, message),
      meta = COALESCE(?, meta),
      updated_at = ?,
      started_at = COALESCE(?, started_at),
      finished_at = COALESCE(?, finished_at)
    WHERE id = ?
  `).run(
    nextStatus,
    patch.message ?? null,
    patch.meta ? JSON.stringify(patch.meta) : null,
    timestamp,
    startedAt,
    finishedAt,
    jobItemId
  );

  updateJobCounters(current.job_id);
  return getJobItem(jobItemId);
}

function getJob(jobId) {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!row) return null;
  return {
    ...row,
    payload: parseMaybeJson(row.payload)
  };
}

function getJobItem(jobItemId) {
  const row = db.prepare('SELECT * FROM job_items WHERE id = ?').get(jobItemId);
  if (!row) return null;
  return {
    ...row,
    meta: parseMaybeJson(row.meta)
  };
}

function getJobItems(jobId) {
  return db.prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY id').all(jobId).map((row) => ({
    ...row,
    meta: parseMaybeJson(row.meta)
  }));
}

function listJobs(limit = 30) {
  return db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?').all(limit).map((row) => ({
    ...row,
    payload: parseMaybeJson(row.payload)
  }));
}

function normalizeMetricRange(range = '24h') {
  const allowed = new Map([
    ['1h', 1],
    ['6h', 6],
    ['24h', 24],
    ['72h', 72]
  ]);
  const key = allowed.has(range) ? range : '24h';
  return { key, hours: allowed.get(key) };
}

function recordMetricSnapshot(snapshot = {}) {
  const capturedAt = snapshot.capturedAt || nowSql();
  db.prepare(`
    INSERT INTO metric_snapshots (
      captured_at,
      node_count,
      online_count,
      payment_count,
      hold_count,
      checkout_count,
      active_slot_count,
      problem_count,
      diagnostic_noise_count,
      running_job_count,
      status_counts_json,
      issue_counts_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    capturedAt,
    Number(snapshot.nodeCount || 0),
    Number(snapshot.onlineCount || 0),
    Number(snapshot.paymentCount || 0),
    Number(snapshot.holdCount || 0),
    Number(snapshot.checkoutCount || 0),
    Number(snapshot.activeSlotCount || 0),
    Number(snapshot.problemCount || 0),
    Number(snapshot.diagnosticNoiseCount || 0),
    Number(snapshot.runningJobCount || 0),
    JSON.stringify(snapshot.statusCounts || {}),
    JSON.stringify(snapshot.issueCounts || {})
  );
}

function listMetricSnapshots(range = '24h') {
  const normalized = normalizeMetricRange(range);
  const cutoff = new Date(Date.now() - normalized.hours * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT *
    FROM metric_snapshots
    WHERE captured_at >= ?
    ORDER BY captured_at ASC
  `).all(cutoff).map((row) => ({
    capturedAt: row.captured_at,
    nodeCount: row.node_count,
    onlineCount: row.online_count,
    paymentCount: row.payment_count,
    holdCount: row.hold_count,
    checkoutCount: row.checkout_count,
    activeSlotCount: row.active_slot_count,
    problemCount: row.problem_count,
    diagnosticNoiseCount: row.diagnostic_noise_count,
    runningJobCount: row.running_job_count,
    statusCounts: parseMaybeJson(row.status_counts_json) || {},
    issueCounts: parseMaybeJson(row.issue_counts_json) || {}
  }));
}

function pruneMetricSnapshots(retentionHours = 72) {
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM metric_snapshots WHERE captured_at < ?').run(cutoff);
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

module.exports = {
  init, db: () => db,
  upsertNode, getAllNodes, getNode, updateNodeHeartbeat, setNodeStatus, markStaleNodes,
  addEvent, getEvents,
  getConfig, setConfig, getAllConfig,
  getSlotRegistry,
  createJob,
  setJobStatus,
  updateJobCounters,
  updateJobItem,
  getJob,
  getJobItem,
  getJobItems,
  listJobs,
  recordMetricSnapshot,
  listMetricSnapshots,
  pruneMetricSnapshots
};
