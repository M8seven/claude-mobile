// relay.js — Lightweight HTTP relay server for remote command execution
//
// Usage:
//   RELAY_TOKEN=mysecrettoken node relay.js
//   RELAY_TOKEN=mysecrettoken RELAY_PORT=7890 node relay.js
//
// Endpoints:
//   GET  /health       — status check (auth required)
//   POST /exec         — run command, wait for completion, return full output
//   POST /exec/stream  — run command, stream stdout/stderr via SSE
//
// Environment variables:
//   RELAY_TOKEN   (required) Bearer token for authentication
//   RELAY_PORT    (optional) Port to listen on, default 7890
//   RELAY_MAX_TIMEOUT  (optional) Max allowed timeout in ms, default 300000
//   RELAY_CMD_LIMIT    (optional) Max command string length, default 2048

'use strict';

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  token: process.env.RELAY_TOKEN || '',
  port: parseInt(process.env.RELAY_PORT || '7890', 10),
  defaultTimeout: 60_000,          // 60 seconds
  maxTimeout: parseInt(process.env.RELAY_MAX_TIMEOUT || '300000', 10), // 5 minutes hard cap
  cmdLimit: parseInt(process.env.RELAY_CMD_LIMIT || '2048', 10),       // max command length
  bodyLimit: 65_536,               // 64 KB max request body
};

if (!CONFIG.token) {
  console.error('[relay] FATAL: RELAY_TOKEN env var is required. Aborting.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg, meta = {}) {
  const ts = new Date().toISOString();
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  console.log(`[${ts}] [${level}] ${msg}${metaStr}`);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Verify Bearer token using timing-safe comparison to prevent timing attacks.
 * Returns true if the token matches.
 */
function authenticate(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice(7).trim();
  if (!provided) return false;

  // Timing-safe comparison
  try {
    const a = Buffer.from(provided.padEnd(CONFIG.token.length));
    const b = Buffer.from(CONFIG.token.padEnd(provided.length));
    return crypto.timingSafeEqual(
      Buffer.from(provided.padEnd(Math.max(provided.length, CONFIG.token.length))),
      Buffer.from(CONFIG.token.padEnd(Math.max(provided.length, CONFIG.token.length)))
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set common CORS + security headers on every response. */
function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

/** Send a JSON response. */
function sendJSON(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Read + parse the JSON request body with a size limit. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > CONFIG.bodyLimit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Validate the exec request body.
 * Returns { command, cwd, timeout } or throws an Error.
 */
function validateExecBody(body) {
  const { command, cwd, timeout } = body;

  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Missing or empty "command" field');
  }
  if (command.length > CONFIG.cmdLimit) {
    throw new Error(`Command exceeds max length of ${CONFIG.cmdLimit} characters`);
  }

  // cwd is optional; if provided, it must exist and be a directory
  let resolvedCwd = undefined;
  if (cwd !== undefined) {
    if (typeof cwd !== 'string') throw new Error('"cwd" must be a string');
    const abs = path.resolve(cwd);
    if (!fs.existsSync(abs)) throw new Error(`Working directory does not exist: ${abs}`);
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) throw new Error(`"cwd" is not a directory: ${abs}`);
    resolvedCwd = abs;
  }

  // timeout clamping
  let ms = CONFIG.defaultTimeout;
  if (timeout !== undefined) {
    const t = parseInt(timeout, 10);
    if (isNaN(t) || t <= 0) throw new Error('"timeout" must be a positive integer (ms)');
    ms = Math.min(t, CONFIG.maxTimeout);
  }

  return { command: command.trim(), cwd: resolvedCwd, timeout: ms };
}

/**
 * Spawn a shell command (via /bin/sh -c) and return a Promise that resolves
 * with { stdout, stderr, exitCode, duration }.
 * Rejects on timeout.
 */
function runCommand({ command, cwd, timeout }) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - start;
      if (timedOut) {
        reject(Object.assign(new Error('Command timed out'), {
          stdout, stderr, duration, code: null,
        }));
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 0, duration });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Spawn a shell command and stream events via Server-Sent Events.
 * Events emitted: stdout, stderr, exit, error
 */
function streamCommand({ command, cwd, timeout }, res) {
  const start = Date.now();

  // SSE helpers
  const sendEvent = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch { /* client disconnected */ }
  };

  const child = spawn('/bin/sh', ['-c', command], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
    sendEvent('error', { message: 'Command timed out', timeout });
  }, timeout);

  child.stdout.on('data', (chunk) => {
    sendEvent('stdout', { data: chunk.toString() });
  });

  child.stderr.on('data', (chunk) => {
    sendEvent('stderr', { data: chunk.toString() });
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (!timedOut) {
      sendEvent('exit', { exitCode: code ?? 0, duration: Date.now() - start });
    }
    try { res.end(); } catch { /* already closed */ }
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    sendEvent('error', { message: err.message });
    try { res.end(); } catch { /* already closed */ }
  });

  // If the client disconnects early, kill the child
  res.on('close', () => {
    clearTimeout(timer);
    child.kill('SIGKILL');
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleHealth(req, res) {
  sendJSON(res, 200, {
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    port: CONFIG.port,
  });
}

async function handleExec(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJSON(res, 400, { error: err.message });
  }

  let params;
  try {
    params = validateExecBody(body);
  } catch (err) {
    return sendJSON(res, 400, { error: err.message });
  }

  log('INFO', 'exec', { command: params.command, cwd: params.cwd, timeout: params.timeout });

  try {
    const result = await runCommand(params);
    log('INFO', 'exec done', { exitCode: result.exitCode, duration: result.duration });
    sendJSON(res, 200, result);
  } catch (err) {
    if (err.message === 'Command timed out') {
      log('WARN', 'exec timeout', { command: params.command });
      return sendJSON(res, 408, {
        error: 'Command timed out',
        stdout: err.stdout,
        stderr: err.stderr,
        duration: err.duration,
      });
    }
    log('ERROR', 'exec error', { message: err.message });
    sendJSON(res, 500, { error: err.message });
  }
}

async function handleExecStream(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJSON(res, 400, { error: err.message });
  }

  let params;
  try {
    params = validateExecBody(body);
  } catch (err) {
    return sendJSON(res, 400, { error: err.message });
  }

  log('INFO', 'exec/stream', { command: params.command, cwd: params.cwd, timeout: params.timeout });

  // SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering if behind a proxy
  });

  // Send an initial keep-alive comment so the client knows the stream started
  res.write(': connected\n\n');

  streamCommand(params, res);
}

// ---------------------------------------------------------------------------
// Main request router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const reqId = crypto.randomBytes(4).toString('hex');
  const { method, url } = req;

  log('REQ', `${method} ${url}`, { id: reqId });

  // Always set CORS headers
  setCORSHeaders(res);

  // Handle preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // --- Authentication (required on all real routes) ---
  if (!authenticate(req)) {
    log('WARN', 'auth failed', { id: reqId, url });
    return sendJSON(res, 401, { error: 'Unauthorized' });
  }

  // --- Route dispatch ---
  try {
    if (method === 'GET' && url === '/health') {
      return await handleHealth(req, res);
    }

    if (method === 'POST' && url === '/exec') {
      return await handleExec(req, res);
    }

    if (method === 'POST' && url === '/exec/stream') {
      return await handleExecStream(req, res);
    }

    // 404 for everything else
    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    log('ERROR', 'unhandled exception', { id: reqId, message: err.message });
    try {
      sendJSON(res, 500, { error: 'Internal server error' });
    } catch { /* response already started */ }
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(CONFIG.port, '0.0.0.0', () => {
  log('INFO', `relay server listening on port ${CONFIG.port}`);
  log('INFO', `endpoints: GET /health  POST /exec  POST /exec/stream`);
  log('INFO', `max timeout: ${CONFIG.maxTimeout}ms  cmd limit: ${CONFIG.cmdLimit} chars`);
});

server.on('error', (err) => {
  log('ERROR', `server error: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log('INFO', 'SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  log('INFO', 'SIGINT received, shutting down');
  server.close(() => process.exit(0));
});
