#!/usr/bin/env node
'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

const ips = fs.readFileSync('ips.txt', 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

function sshStatus(node, ip) {
  const remote = [
    'cd /root/colosseum-sniper 2>/dev/null || exit 2',
    'tmp=/tmp/sniper-tail-status.txt',
    'tail -n 1200 sniper.log 2>/dev/null > $tmp',
    "cal=$(grep -c 'calendar_api allowed_by_slot=true' $tmp || true)",
    "waf=$(grep -Ec 'WARN \\[WAF\\] Page block|global circuit breaker|Octofence| 403 ' $tmp || true)",
    "page=$(grep -c 'page_load allowed_by_slot=true' $tmp || true)",
    "cap=$(grep -c 'SUPPLY \\[CAPACITY\\]' $tmp || true)",
    "cb=$(grep -c 'global circuit breaker pause active' $tmp || true)",
    "proc=$(pgrep -af 'node .*src/sniper\\.js' | wc -l)",
    `state=$(cat /tmp/sniper-proxy-bans-node${node}.json 2>/dev/null | tr -d '\\n' | cut -c1-180)`,
    'echo cal=$cal waf=$waf page=$page cap=$cap cbpause=$cb proc=$proc state=$state'
  ].join('; ');

  return new Promise((resolve) => {
    execFile(
      'ssh',
      [
        '-o', 'ConnectTimeout=6',
        '-o', 'ConnectionAttempts=1',
        '-o', 'StrictHostKeyChecking=accept-new',
        `root@${ip}`,
        remote
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          node,
          ip,
          ok: !error,
          output: String(stdout || stderr || error?.message || '').trim().replace(/\s+/g, ' ')
        });
      }
    );
  });
}

(async () => {
  const results = await Promise.all(ips.map((ip, index) => sshStatus(index + 1, ip)));
  for (const result of results) {
    const prefix = `${String(result.node).padStart(2, '0')} ${result.ip.padEnd(15)}`;
    console.log(`${prefix} ${result.ok ? result.output : `ERR ${result.output}`}`);
  }
})();
