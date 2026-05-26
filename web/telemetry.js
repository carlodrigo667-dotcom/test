const DEFAULT_RING_LIMIT = 1500;

const nodeStreams = new Map();

function ensureNodeStream(nodeId) {
  if (!nodeStreams.has(nodeId)) {
    nodeStreams.set(nodeId, {
      nodeId,
      nextSeq: 1,
      lines: [],
      lastCursor: 0,
      lastUpdatedAt: null
    });
  }

  return nodeStreams.get(nodeId);
}

function appendLines(nodeId, lines, meta = {}) {
  const stream = ensureNodeStream(nodeId);
  const cleanLines = (lines || [])
    .map((line) => String(line ?? '').replace(/\r/g, ''))
    .filter((line) => line.length > 0);

  if (cleanLines.length === 0) {
    if (meta.cursor !== undefined) stream.lastCursor = meta.cursor;
    if (meta.updatedAt) stream.lastUpdatedAt = meta.updatedAt;
    return { stream, chunk: null };
  }

  const chunk = {
    nodeId,
    seqStart: stream.nextSeq,
    seqEnd: stream.nextSeq + cleanLines.length - 1,
    lines: cleanLines,
    cursor: meta.cursor ?? stream.lastCursor,
    updatedAt: meta.updatedAt || new Date().toISOString(),
    source: meta.source || 'sidecar'
  };

  cleanLines.forEach((line, index) => {
    stream.lines.push({
      seq: chunk.seqStart + index,
      line,
      ts: chunk.updatedAt
    });
  });

  stream.nextSeq = chunk.seqEnd + 1;
  stream.lastCursor = chunk.cursor;
  stream.lastUpdatedAt = chunk.updatedAt;

  if (stream.lines.length > DEFAULT_RING_LIMIT) {
    stream.lines.splice(0, stream.lines.length - DEFAULT_RING_LIMIT);
  }

  return { stream, chunk };
}

function seedFromSnapshot(nodeId, logText, meta = {}) {
  const stream = ensureNodeStream(nodeId);
  if (stream.lines.length > 0) return getSnapshot(nodeId);

  const lines = String(logText || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-300);

  appendLines(nodeId, lines, { ...meta, source: meta.source || 'snapshot' });
  return getSnapshot(nodeId);
}

function appendSnapshotTail(nodeId, logText, meta = {}) {
  const stream = ensureNodeStream(nodeId);
  const lines = String(logText || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-300);

  if (!lines.length) return getSnapshot(nodeId);

  const existing = stream.lines.map((entry) => entry.line);
  let overlap = 0;
  const maxOverlap = Math.min(existing.length, lines.length, 300);
  for (let length = maxOverlap; length > 0; length -= 1) {
    let matches = true;
    for (let i = 0; i < length; i += 1) {
      if (existing[existing.length - length + i] !== lines[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      overlap = length;
      break;
    }
  }

  const tail = lines.slice(overlap);
  if (!tail.length) {
    if (meta.cursor !== undefined) stream.lastCursor = meta.cursor;
    if (meta.updatedAt) stream.lastUpdatedAt = meta.updatedAt;
    return getSnapshot(nodeId);
  }

  appendLines(nodeId, tail, { ...meta, source: meta.source || 'snapshot-tail' });
  return getSnapshot(nodeId);
}

function getSnapshot(nodeId, afterSeq = 0) {
  const stream = ensureNodeStream(nodeId);
  const lines = stream.lines.filter((entry) => entry.seq > afterSeq);
  return {
    nodeId,
    seq: stream.nextSeq - 1,
    cursor: stream.lastCursor,
    updatedAt: stream.lastUpdatedAt,
    lines
  };
}

function clearNode(nodeId) {
  nodeStreams.delete(nodeId);
}

module.exports = {
  appendLines,
  seedFromSnapshot,
  appendSnapshotTail,
  getSnapshot,
  clearNode
};
