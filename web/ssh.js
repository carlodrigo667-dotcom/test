/**
 * 🔗 SSH Operations — Remote commands to cluster nodes
 * 
 * Uses node-ssh for all remote operations:
 *   - Deploy code (tar + scp + install)
 *   - Start/Stop bots
 *   - Tail logs
 *   - Execute arbitrary commands
 */

const { NodeSSH } = require('node-ssh');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const SSH_KEY_CANDIDATES = process.env.SSH_KEY_PATH
  ? [process.env.SSH_KEY_PATH]
  : ['/root/.ssh/id_ed25519', '/root/.ssh/id_rsa'].filter(filePath => require('fs').existsSync(filePath));
const REMOTE_DIR = '/root/colosseum-sniper';
const CONNECT_TIMEOUT = 10000;
const BOT_CHROME_PATTERN = '/root/chrome-user-data/';
const FIND_BOT_PIDS_SNIPPET =
  `BOT_PIDS=$(ps -eo pid=,args= | awk '/[n]ode/ && /[s]rc\\/sniper\\.js([[:space:]]|$)/ { print $1 }'); `;
const FIND_BOT_PID_SNIPPET =
  `${FIND_BOT_PIDS_SNIPPET}` +
  `BOT_PID=$(printf "%s\\n" "$BOT_PIDS" | tail -n 1); `;
const STOP_BOT_COMMAND =
  FIND_BOT_PIDS_SNIPPET +
  `if [ -n "$BOT_PIDS" ]; then printf "%s\\n" "$BOT_PIDS" | xargs -r kill -TERM; sleep 2; printf "%s\\n" "$BOT_PIDS" | xargs -r kill -KILL 2>/dev/null || true; fi; ` +
  `CHROME_PIDS=$(pgrep -f "${BOT_CHROME_PATTERN}" || true); ` +
  `if [ -n "$CHROME_PIDS" ]; then printf "%s\\n" "$CHROME_PIDS" | xargs -r kill -TERM; sleep 1; printf "%s\\n" "$CHROME_PIDS" | xargs -r kill -KILL 2>/dev/null || true; fi; ` +
  `echo "Stopped"`;
const SIGNAL_RELOAD_COMMAND =
  FIND_BOT_PID_SNIPPET +
  `if [ -z "$BOT_PID" ]; then echo "__NO_PROCESS__"; exit 0; fi; ` +
  `kill -USR1 "$BOT_PID" && echo "__SIGNALED__|$BOT_PID" || echo "__SIGNAL_FAILED__|$BOT_PID"`;

/**
 * Create SSH connection to a node
 */
async function connect(ip) {
  let lastError = null;

  for (const privateKeyPath of SSH_KEY_CANDIDATES) {
    const ssh = new NodeSSH();
    try {
      await ssh.connect({
        host: ip,
        username: 'root',
        privateKeyPath,
        readyTimeout: CONNECT_TIMEOUT,
        strictHostKeyChecking: false
      });
      return ssh;
    } catch (error) {
      lastError = error;
      ssh.dispose();
    }
  }

  throw lastError || new Error(`No working SSH key found for ${ip}`);
}

/**
 * Execute a command on a remote node
 */
async function execOnNode(ip, command) {
  const ssh = await connect(ip);
  try {
    const result = await ssh.execCommand(command, { cwd: REMOTE_DIR });
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  } finally {
    ssh.dispose();
  }
}

/**
 * Start bot on a specific node
 */
async function startBot(ip, nodeId) {
  return execOnNode(ip, `bash launcher.sh ${nodeId}`);
}

/**
 * Stop bot on a specific node
 */
async function stopBot(ip) {
  return execOnNode(ip, STOP_BOT_COMMAND);
}

function buildResetCartCommand(nodeId) {
  const safeNodeId = parseInt(nodeId, 10);
  if (!Number.isFinite(safeNodeId) || safeNodeId <= 0) {
    throw new Error(`Invalid node id: ${nodeId}`);
  }

  return `set -u
cd ${REMOTE_DIR} || exit 10
NODE_ID=${safeNodeId}
RESET_JS="/tmp/sniper-reset-cart-node${safeNodeId}.js"
cat > "$RESET_JS" <<'NODE'
const fs = require('fs');

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (error) {
    console.log('RELEASE_SKIP=puppeteer_missing');
    return;
  }

  const roots = ['/root/chrome-user-data', '/root/chrome-checkout-data'];
  const candidates = [];

  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profile = \`\${root}/\${entry.name}\`;
      const activePortPath = \`\${profile}/DevToolsActivePort\`;
      let port = '';
      try {
        port = fs.readFileSync(activePortPath, 'utf8').split(/\\r?\\n/)[0].trim();
      } catch {
        continue;
      }
      if (/^\\d+$/.test(port)) candidates.push({ profile, port });
    }
  }

  const seenPorts = new Set();
  let dropCount = 0;
  let releaseCount = 0;

  for (const candidate of candidates) {
    if (seenPorts.has(candidate.port)) continue;
    seenPorts.add(candidate.port);

    let browser = null;
    try {
      browser = await puppeteer.connect({
        browserURL: \`http://127.0.0.1:\${candidate.port}\`,
        defaultViewport: null
      });
      const pages = await browser.pages();
      const page = pages.find((item) => /ticketing\\.colosseo\\.it/i.test(item.url()));
      if (!page) {
        console.log(\`RELEASE_SKIP=no_ticketing_page profile=\${candidate.profile} port=\${candidate.port}\`);
        continue;
      }

      const result = await page.evaluate(async () => {
        async function postCartAction(endpoint, body) {
          const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'x-requested-with': 'XMLHttpRequest'
            },
            body
          });
          const text = await response.text().catch(() => '');
          return { endpoint, status: response.status, ok: response.ok, text: text.slice(0, 240) };
        }

        const drop = await postCartAction('/mtajax/dropcart', 'action=midaabc_dropcart');
        if (drop.ok) return { drop, fallback: null };

        const fallback = await postCartAction('/mtajax/release_cart', 'action=midaabc_release_cart');
        return { drop, fallback };
      });
      dropCount += 1;
      const drop = result && result.drop ? result.drop : {};
      console.log(\`DROPCART_RESULT=profile=\${candidate.profile} port=\${candidate.port} status=\${drop.status} ok=\${drop.ok} text=\${JSON.stringify(drop.text || '')}\`);
      if (result && result.fallback) {
        releaseCount += 1;
        console.log(\`RELEASE_RESULT=profile=\${candidate.profile} port=\${candidate.port} status=\${result.fallback.status} ok=\${result.fallback.ok} text=\${JSON.stringify(result.fallback.text || '')}\`);
      }
    } catch (error) {
      console.log(\`DROPCART_ERROR=profile=\${candidate.profile} port=\${candidate.port} error=\${JSON.stringify(error.message)}\`);
    } finally {
      if (browser) {
        try { await browser.disconnect(); } catch {}
      }
    }
  }

  console.log(\`DROPCART_ATTEMPTS=\${dropCount}\`);
  console.log(\`RELEASE_ATTEMPTS=\${releaseCount}\`);
}

main().catch((error) => {
  console.log(\`DROPCART_FATAL=\${JSON.stringify(error.message)}\`);
});
NODE
node "$RESET_JS" 2>&1 || true
rm -f "$RESET_JS" /tmp/pay_now /tmp/pay_request.json "/tmp/sniper-manual-checkout-node${safeNodeId}.json" "/tmp/sniper-manual-checkout-node${safeNodeId}.json.completed" 2>/dev/null || true
BOT_PIDS=$(ps -eo pid=,args= | awk '/[n]ode/ && /[s]rc\\/sniper\\.js([[:space:]]|$)/ { print $1 }')
if [ -n "$BOT_PIDS" ]; then printf "%s\\n" "$BOT_PIDS" | xargs -r kill -TERM; sleep 2; printf "%s\\n" "$BOT_PIDS" | xargs -r kill -KILL 2>/dev/null || true; fi
CHROME_PIDS=$(ps -eo pid=,args= | awk '/chrome/ && /(chrome-user-data|chrome-checkout-data|puppeteer_dev_profile)/ { print $1 }')
if [ -n "$CHROME_PIDS" ]; then printf "%s\\n" "$CHROME_PIDS" | xargs -r kill -TERM; sleep 1; printf "%s\\n" "$CHROME_PIDS" | xargs -r kill -KILL 2>/dev/null || true; fi
rm -rf /root/chrome-checkout-data 2>/dev/null || true
rm -f state.json 2>/dev/null || true
timeout 240 bash launcher.sh ${safeNodeId}
RESET_CODE=$?
printf '[%s] [NODE %s] HOLD [HOLD] cart_released reason=web_reset_cart_command\\n' "$(date -u +%H:%M:%S)" "$NODE_ID" >> sniper.log 2>/dev/null || true
if [ "$RESET_CODE" -ne 0 ]; then
  echo "__RESET_CART_LAUNCHER_FAILED__|$RESET_CODE"
  exit "$RESET_CODE"
fi
echo "__RESET_CART_OK__"`;
}

async function resetCart(ip, nodeId) {
  const result = await execOnNode(ip, buildResetCartCommand(nodeId));
  const stdout = result.stdout || '';
  const ok = result.code === 0 && stdout.includes('__RESET_CART_OK__');
  return {
    ok,
    stdout,
    stderr: result.stderr || '',
    code: result.code,
    dropAttempts: (stdout.match(/DROPCART_ATTEMPTS=(\d+)/) || [])[1] ? parseInt((stdout.match(/DROPCART_ATTEMPTS=(\d+)/) || [])[1], 10) : null,
    releaseAttempts: (stdout.match(/RELEASE_ATTEMPTS=(\d+)/) || [])[1] ? parseInt((stdout.match(/RELEASE_ATTEMPTS=(\d+)/) || [])[1], 10) : null
  };
}

/**
 * Get tail of sniper.log
 */
async function tailLog(ip, lines = 200) {
  return execOnNode(ip, `tail -n ${lines} ${REMOTE_DIR}/sniper.log 2>/dev/null || echo "No log file"`);
}

/**
 * Get log tail plus remote metadata
 */
async function getLogSnapshot(ip, lines = 200) {
  const safeLines = Math.max(10, Math.min(parseInt(lines, 10) || 200, 2000));
  const command =
    `DEFAULT_LOG="${REMOTE_DIR}/sniper.log"; ` +
    `LOG="$DEFAULT_LOG"; BOT_PID=""; BOT_CWD=""; ` +
    FIND_BOT_PID_SNIPPET +
    `if [ -n "$BOT_PID" ]; then ` +
    `  PROC_STATE=RUNNING; ` +
    `  BOT_CWD=$(readlink -f "/proc/$BOT_PID/cwd" 2>/dev/null || true); ` +
    `  BOT_STDOUT=$(readlink -f "/proc/$BOT_PID/fd/1" 2>/dev/null || true); ` +
    `  if [ -n "$BOT_STDOUT" ] && [ -f "$BOT_STDOUT" ]; then LOG="$BOT_STDOUT"; fi; ` +
    `else ` +
    `  PROC_STATE=STOPPED; ` +
    `fi; ` +
    `if [ ! -f "$LOG" ] && [ -n "$BOT_CWD" ] && [ -f "$BOT_CWD/sniper.log" ]; then LOG="$BOT_CWD/sniper.log"; fi; ` +
    `MTIME=0; SIZE=0; HAS_LOG=0; ` +
    `if [ -f "$LOG" ]; then ` +
    `  HAS_LOG=1; ` +
    `  MTIME=$(stat -c %Y "$LOG" 2>/dev/null || echo 0); ` +
    `  SIZE=$(stat -c %s "$LOG" 2>/dev/null || echo 0); ` +
    `fi; ` +
    `printf "__LOG_META__%s|%s|%s|%s|%s|%s\\n" "$HAS_LOG" "$MTIME" "$SIZE" "$PROC_STATE" "$BOT_PID" "$LOG"; ` +
    `if [ "$HAS_LOG" = "1" ]; then tail -n ${safeLines} "$LOG" 2>/dev/null || true; else echo "No log file"; fi`;

  const result = await execOnNode(ip, command);
  const linesOut = (result.stdout || '').split('\n');
  const metaLine = linesOut[0] || '';
  const log = linesOut.slice(1).join('\n').trimEnd();

  let meta = {
    hasLogFile: false,
    mtimeMs: null,
    sizeBytes: 0,
    processState: 'UNKNOWN'
  };

  if (metaLine.startsWith('__LOG_META__')) {
    const [hasLogRaw, mtimeRaw, sizeRaw, processStateRaw, processIdRaw, logPathRaw] = metaLine.replace('__LOG_META__', '').split('|');
    meta = {
      hasLogFile: hasLogRaw === '1',
      mtimeMs: mtimeRaw && mtimeRaw !== '0' ? parseInt(mtimeRaw, 10) * 1000 : null,
      sizeBytes: parseInt(sizeRaw || '0', 10) || 0,
      processState: processStateRaw || 'UNKNOWN',
      processId: processIdRaw ? parseInt(processIdRaw, 10) || null : null,
      logPath: logPathRaw || `${REMOTE_DIR}/sniper.log`
    };
  }

  return {
    ...result,
    log,
    meta
  };
}

/**
 * Check if bot process is running
 */
async function checkProcess(ip) {
  const result = await execOnNode(
    ip,
    `${FIND_BOT_PIDS_SNIPPET} if [ -n "$BOT_PIDS" ]; then echo "RUNNING"; else echo "STOPPED"; fi`
  );
  return result.stdout.trim() === 'RUNNING';
}

async function signalBotReload(ip) {
  const result = await execOnNode(ip, SIGNAL_RELOAD_COMMAND);
  const stdout = (result.stdout || '').trim();

  if (stdout.startsWith('__SIGNALED__|')) {
    return {
      ok: true,
      processId: parseInt(stdout.split('|')[1], 10) || null,
      status: 'signaled'
    };
  }

  if (stdout.startsWith('__NO_PROCESS__')) {
    return {
      ok: false,
      processId: null,
      status: 'no_process'
    };
  }

  return {
    ok: false,
    processId: null,
    status: 'signal_failed',
    error: stdout || result.stderr || 'Failed to signal bot reload'
  };
}

async function uploadConfig(ip, localConfigPath) {
  return uploadFile(ip, localConfigPath, `${REMOTE_DIR}/config.json`);
}

/**
 * Deploy code to a node
 * Steps: create archive locally → scp → extract → npm install
 */
async function deployToNode(ip, nodeId, archivePath) {
  const ssh = await connect(ip);
  try {
    // Ensure remote directory exists
    await ssh.execCommand(`mkdir -p ${REMOTE_DIR}`);
    
    // Upload archive
    await ssh.putFile(archivePath, `${REMOTE_DIR}/deploy.tar.gz`);
    
    // Stop existing bot, extract runtime files, validate, then start it again.
    const result = await ssh.execCommand(
      `cd ${REMOTE_DIR} && ` +
      `${STOP_BOT_COMMAND} > /dev/null 2>&1 && ` +
      `tar -xzf deploy.tar.gz && ` +
      `chmod +x launcher.sh scripts/proxy-preflight.js scripts/proxy-ban-checker.js scripts/rdp-login-sync.sh 2>/dev/null || true && ` +
      `node --check sniper.js && ` +
      `node --check src/logger.js && ` +
      `node --check src/sniper.js && ` +
      `node --check scripts/proxy-preflight.js && ` +
      `node --check scripts/proxy-ban-checker.js && ` +
      `bash -n scripts/rdp-login-sync.sh && ` +
      `bash launcher.sh ${nodeId} && ` +
      `echo "DEPLOY_OK"`,
      { cwd: REMOTE_DIR }
    );
    
    return result.stdout.includes('DEPLOY_OK');
  } finally {
    ssh.dispose();
  }
}

/**
 * Create deploy archive from project root
 */
function createDeployArchive(projectRoot) {
  const archivePath = path.join(projectRoot, 'deploy.tar.gz');
  execSync(
    'tar -czf deploy.tar.gz src sniper.js proxy-relay.js slot-registry.js config.json "Webshare 2500 proxies.txt" package.json package-lock.json launcher.sh scripts/proxy-preflight.js scripts/proxy-ban-checker.js scripts/rdp-login-sync.sh',
    { cwd: projectRoot, stdio: 'pipe' }
  );
  return archivePath;
}

/**
 * Upload a single file to a node
 */
async function uploadFile(ip, localPath, remotePath) {
  const ssh = await connect(ip);
  try {
    await ssh.putFile(localPath, remotePath);
    return true;
  } catch (e) {
    console.error(`Upload failed to ${ip}:`, e);
    return false;
  } finally {
    ssh.dispose();
  }
}

module.exports = {
  connect, execOnNode,
  startBot, stopBot, resetCart, tailLog, getLogSnapshot, checkProcess, signalBotReload, uploadConfig,
  deployToNode, createDeployArchive, uploadFile
};
