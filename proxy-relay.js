#!/usr/bin/env node
/*
 * Local authenticated proxy relay.
 *
 * Chrome connects to localhost:LOCAL_PORT without credentials. This process
 * forwards HTTP/CONNECT traffic to REMOTE_HOST:REMOTE_PORT and adds
 * Proxy-Authorization for the upstream proxy.
 */

const http = require('http');
const net = require('net');

const REMOTE_HOST = process.argv[2];
const REMOTE_PORT = parseInt(process.argv[3], 10);
const USERNAME = process.argv[4];
const PASSWORD = process.argv[5];
const LOCAL_PORT = parseInt(process.argv[6] || '18080', 10);
const CONNECT_TIMEOUT_MS = Math.max(1000, Number(process.env.PROXY_RELAY_CONNECT_TIMEOUT_MS || 15000));

if (!REMOTE_HOST || !REMOTE_PORT || !USERNAME || !PASSWORD) {
  console.error('Usage: node proxy-relay.js REMOTE_HOST REMOTE_PORT USERNAME PASSWORD [LOCAL_PORT]');
  process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

function sanitizeLogValue(value, maxLen = 180) {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, maxLen);
}

function writeConnectFailure(clientSocket, reason) {
  if (clientSocket.destroyed) return;
  clientSocket.write(`HTTP/1.1 502 Bad Gateway\r\nX-Proxy-Relay-Error: ${sanitizeLogValue(reason, 80)}\r\n\r\n`);
  clientSocket.end();
}

const server = http.createServer((clientReq, clientRes) => {
  const options = {
    hostname: REMOTE_HOST,
    port: REMOTE_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      'Proxy-Authorization': authHeader,
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (error) => {
    console.error(`[ProxyRelay] HTTP request error remote=${REMOTE_HOST}:${REMOTE_PORT} method=${clientReq.method} url=${sanitizeLogValue(clientReq.url)} code=${error.code || 'ERR'} message=${sanitizeLogValue(error.message)}`);
    if (!clientRes.headersSent) clientRes.writeHead(502);
    clientRes.end('Proxy relay error');
  });

  clientReq.pipe(proxyReq);
});

server.on('connect', (clientReq, clientSocket) => {
  let settled = false;
  let responseBuffer = Buffer.alloc(0);

  const proxySocket = net.connect(REMOTE_PORT, REMOTE_HOST, () => {
    const connectReq = [
      `CONNECT ${clientReq.url} HTTP/1.1`,
      `Host: ${clientReq.url}`,
      `Proxy-Authorization: ${authHeader}`,
      'Proxy-Connection: Keep-Alive',
      '',
      '',
    ].join('\r\n');
    proxySocket.write(connectReq);
  });

  const fail = (reason, error) => {
    if (settled) return;
    settled = true;
    const errorPart = error ? ` code=${error.code || 'ERR'} message=${sanitizeLogValue(error.message)}` : '';
    console.error(`[ProxyRelay] CONNECT failed remote=${REMOTE_HOST}:${REMOTE_PORT} target=${sanitizeLogValue(clientReq.url)} reason=${sanitizeLogValue(reason)}${errorPart}`);
    writeConnectFailure(clientSocket, reason);
    proxySocket.destroy();
  };

  proxySocket.setTimeout(CONNECT_TIMEOUT_MS);

  proxySocket.on('data', (chunk) => {
    if (settled) return;
    responseBuffer = Buffer.concat([responseBuffer, chunk]);
    const headerEnd = responseBuffer.indexOf('\r\n\r\n');

    if (headerEnd === -1) {
      if (responseBuffer.length > 8192) fail('oversized_connect_response');
      return;
    }

    const headerText = responseBuffer.slice(0, headerEnd).toString('latin1');
    const statusLine = sanitizeLogValue(headerText.split(/\r?\n/, 1)[0]);
    const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/i.exec(statusLine);
    const statusCode = statusMatch ? Number(statusMatch[1]) : 0;

    if (statusCode !== 200) {
      fail(`remote_status_${statusCode || 'unknown'}:${statusLine}`);
      return;
    }

    settled = true;
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    const firstPayloadOffset = headerEnd + 4;
    if (firstPayloadOffset < responseBuffer.length) {
      clientSocket.write(responseBuffer.slice(firstPayloadOffset));
    }

    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);
  });

  proxySocket.on('error', (error) => fail('remote_socket_error', error));
  proxySocket.on('timeout', () => fail('remote_connect_timeout'));
  clientSocket.on('error', () => proxySocket.destroy());
  clientSocket.on('close', () => {
    if (!settled) proxySocket.destroy();
  });
});

server.listen(LOCAL_PORT, '127.0.0.1', () => {
  console.log(`[ProxyRelay] localhost:${LOCAL_PORT} -> ${REMOTE_HOST}:${REMOTE_PORT} (auth_user: ${sanitizeLogValue(USERNAME, 80)}) timeout_ms=${CONNECT_TIMEOUT_MS}`);
});
