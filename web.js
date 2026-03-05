// claude-mobile web — iPad edition
// Single file, zero dependencies, runs in Node.js Lab
// Hit Run, then open http://127.0.0.1:3000

// === CONFIG ===
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 16384;
const PORT = 3000;

// === MODULES (renamed — Node.js Lab reserves 'https') ===
const httpsLib = require('https');
const httpLib = require('http');
const fsLib = require('fs');
const pathLib = require('path');
const osLib = require('os');

// Working directory — iPad may return '/' for cwd()
let CWD = process.cwd();
if (CWD === '/' || CWD === '') CWD = osLib.homedir();

// === SYSTEM PROMPT ===
const SYSTEM_PROMPT = `You are Claude, an AI coding assistant running on iPad via claude-mobile.
You help users with software engineering tasks: writing, debugging, refactoring, and exploring code.

# Tools
- Use Read to read files (with optional offset/limit for large files)
- Use Write to create or overwrite files
- Use Edit to make targeted string replacements in files
- Use Glob to find files by pattern (e.g. "**/*.js")
- Use Grep to search file contents with regex
- Use Bash to run shell commands (JS polyfill — supports: ls, cat, mkdir, rm, cp, mv, touch, pwd, echo, wc, find, tree, head, tail, sort, uniq, grep, sed, stat, du, date)

# Guidelines
- Read files before editing
- Make minimal, focused changes
- Use Glob and Grep to explore before making changes
- Be concise
- Rispondi in italiano se l'utente scrive in italiano

# Environment
- Platform: iPad (iOS, Node.js Lab)
- Working directory: ${CWD}
- Date: ${new Date().toISOString().slice(0, 10)}`;

// === TOOL DEFINITIONS (sent to API) ===
const TOOL_DEFS = [
  {
    name: 'Read',
    description: 'Read a file. Returns contents with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute or relative file path' },
        offset: { type: 'number', description: 'Start line (1-based)' },
        limit: { type: 'number', description: 'Max lines to read' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'Write',
    description: 'Write/create a file (overwrites if exists).',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'File content' }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'Edit',
    description: 'Replace a string in a file. old_string must be unique in the file.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File path' },
        old_string: { type: 'string', description: 'Text to find (must be unique)' },
        new_string: { type: 'string', description: 'Replacement text' }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  {
    name: 'Glob',
    description: 'Find files matching a glob pattern. Returns file paths.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.js", "src/**/*.ts")' },
        path: { type: 'string', description: 'Directory to search in (default: working dir)' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Grep',
    description: 'Search file contents with regex. Returns matching lines.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'Directory or file to search' },
        glob: { type: 'string', description: 'File pattern filter (e.g. "*.js")' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Bash',
    description: 'Run a shell command (JS polyfill: ls, cat, mkdir, rm, cp, mv, pwd, echo, wc, find, tree, head, tail, sort, uniq, grep, sed, touch, stat, du, date, basename, dirname).',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' }
      },
      required: ['command']
    }
  }
];

// === TOOL IMPLEMENTATIONS ===

function resolvePath(p) {
  if (!p) return CWD;
  if (pathLib.isAbsolute(p)) return p;
  return pathLib.resolve(CWD, p);
}

function toolRead(input) {
  const fp = resolvePath(input.file_path);
  if (!fsLib.existsSync(fp)) return `Error: File not found: ${fp}`;
  const content = fsLib.readFileSync(fp, 'utf-8');
  const lines = content.split('\n');
  const start = (input.offset || 1) - 1;
  const end = input.limit ? start + input.limit : lines.length;
  return lines.slice(start, end)
    .map((l, i) => `${String(start + i + 1).padStart(6)} ${l}`)
    .join('\n');
}

function toolWrite(input) {
  const fp = resolvePath(input.file_path);
  const dir = pathLib.dirname(fp);
  if (!fsLib.existsSync(dir)) fsLib.mkdirSync(dir, { recursive: true });
  fsLib.writeFileSync(fp, input.content, 'utf-8');
  return `Written: ${fp} (${input.content.length} bytes)`;
}

function toolEdit(input) {
  const fp = resolvePath(input.file_path);
  if (!fsLib.existsSync(fp)) return `Error: File not found: ${fp}`;
  const content = fsLib.readFileSync(fp, 'utf-8');
  const count = content.split(input.old_string).length - 1;
  if (count === 0) return `Error: old_string not found in ${fp}`;
  if (count > 1) return `Error: old_string found ${count} times — must be unique`;
  const updated = content.replace(input.old_string, input.new_string);
  fsLib.writeFileSync(fp, updated, 'utf-8');
  return `Edited: ${fp}`;
}

// Glob
const IGNORE_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', '.DS_Store', 'dist', 'build', '.next']);

function globToRegex(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += pattern[i + 2] === '/' ? 3 : 2;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '.') {
      re += '\\.';
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

function walkDir(dir, maxDepth, depth) {
  if (depth > (maxDepth || 15)) return [];
  let results = [];
  try {
    const entries = fsLib.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = pathLib.join(dir, e.name);
      if (e.isDirectory()) {
        results = results.concat(walkDir(full, maxDepth, depth + 1));
      } else {
        results.push(full);
      }
    }
  } catch (e) {}
  return results;
}

function toolGlob(input) {
  const base = resolvePath(input.path);
  const regex = globToRegex(input.pattern);
  const files = walkDir(base, 15, 0);
  const matches = files.filter(f => {
    const rel = pathLib.relative(base, f);
    return regex.test(rel) || regex.test(pathLib.basename(f));
  });
  if (matches.length === 0) return 'No matches found.';
  return matches.slice(0, 200).map(f => pathLib.relative(base, f)).join('\n');
}

// Grep
function toolGrep(input) {
  if (!input.pattern) return 'Error: pattern required';
  const base = resolvePath(input.path);
  const regex = new RegExp(input.pattern, 'i');
  const globRe = input.glob ? globToRegex(input.glob) : null;
  const results = [];
  const files = fsLib.statSync(base).isFile() ? [base] : walkDir(base, 10, 0);

  for (const f of files) {
    if (globRe && !globRe.test(pathLib.basename(f))) continue;
    try {
      const content = fsLib.readFileSync(f, 'utf-8');
      if (content.includes('\0')) continue; // skip binary
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const rel = pathLib.relative(CWD, f);
          results.push(`${rel}:${i + 1}: ${lines[i].slice(0, 200)}`);
          if (results.length >= 100) return results.join('\n');
        }
      }
    } catch (e) {}
  }
  return results.length ? results.join('\n') : 'No matches found.';
}

// Bash JS polyfill
function toolBash(input) {
  const cmd = (input.command || '').trim();
  if (!cmd) return '';

  // Handle chains (&&)
  if (cmd.includes('&&')) {
    const parts = cmd.split('&&').map(s => s.trim());
    let output = '';
    for (const part of parts) {
      const r = toolBash({ command: part });
      if (r.startsWith('Error:')) return output + r;
      output += (output && r ? '\n' : '') + r;
    }
    return output;
  }

  // Handle pipes
  if (cmd.includes(' | ')) {
    const parts = cmd.split(' | ').map(s => s.trim());
    let data = toolBash({ command: parts[0] });
    for (let i = 1; i < parts.length; i++) {
      data = pipeData(parts[i], data);
    }
    return data;
  }

  // Parse command
  const args = parseArgs(cmd);
  const name = args[0];
  const rest = args.slice(1);

  try {
    switch (name) {
      case 'ls': return cmdLs(rest);
      case 'cat': return cmdCat(rest);
      case 'head': return cmdHead(rest);
      case 'tail': return cmdTail(rest);
      case 'pwd': return CWD;
      case 'cd': {
        const target = rest[0] ? resolvePath(rest[0]) : osLib.homedir();
        if (!fsLib.existsSync(target)) return `Error: ${target}: No such directory`;
        CWD = target;
        return '';
      }
      case 'echo': return rest.join(' ');
      case 'mkdir': return cmdMkdir(rest);
      case 'rm': return cmdRm(rest);
      case 'cp': return cmdCp(rest);
      case 'mv': return cmdMv(rest);
      case 'touch': {
        for (const f of rest) {
          const fp = resolvePath(f);
          if (fsLib.existsSync(fp)) {
            const now = new Date();
            fsLib.utimesSync(fp, now, now);
          } else {
            fsLib.writeFileSync(fp, '', 'utf-8');
          }
        }
        return '';
      }
      case 'wc': return cmdWc(rest);
      case 'find': return cmdFind(rest);
      case 'tree': return cmdTree(rest);
      case 'sort': return cmdSort(rest);
      case 'uniq': return cmdUniq(rest);
      case 'grep': return cmdGrepBash(rest);
      case 'sed': return cmdSed(rest);
      case 'stat': {
        const fp = resolvePath(rest[0]);
        const s = fsLib.statSync(fp);
        return `  File: ${fp}\n  Size: ${s.size}\n  Type: ${s.isDirectory() ? 'directory' : 'file'}\nModify: ${s.mtime.toISOString()}`;
      }
      case 'du': {
        const target = resolvePath(rest.filter(a => !a.startsWith('-'))[0] || '.');
        return `${getDirSize(target)}\t${target}`;
      }
      case 'date': return new Date().toISOString();
      case 'basename': return pathLib.basename(rest[0] || '');
      case 'dirname': return pathLib.dirname(rest[0] || '');
      case 'whoami': return osLib.userInfo().username;
      case 'hostname': return osLib.hostname();
      case 'uname': return `${osLib.type()} ${osLib.release()} ${osLib.arch()}`;
      default: return `Error: command not found: ${name} (iPad JS polyfill — no native shell)`;
    }
  } catch (e) {
    return `Error: ${e.message}`;
  }
}

function parseArgs(cmd) {
  const args = [];
  let current = '';
  let inQuote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (inQuote) {
      if (c === inQuote) { inQuote = null; }
      else { current += c; }
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === ' ' || c === '\t') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += c;
    }
  }
  if (current) args.push(current);
  return args;
}

function cmdLs(args) {
  const flags = args.filter(a => a.startsWith('-')).join('');
  const target = resolvePath(args.find(a => !a.startsWith('-')) || '.');
  const entries = fsLib.readdirSync(target, { withFileTypes: true });
  const filtered = flags.includes('a') ? entries : entries.filter(e => !e.name.startsWith('.'));
  if (flags.includes('l')) {
    return filtered.map(e => {
      try {
        const s = fsLib.statSync(pathLib.join(target, e.name));
        const type = e.isDirectory() ? 'd' : '-';
        return `${type}rw-r--r-- ${String(s.size).padStart(8)} ${e.name}${e.isDirectory() ? '/' : ''}`;
      } catch { return `?         ? ${e.name}`; }
    }).join('\n');
  }
  return filtered.map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n');
}

function cmdCat(args) {
  return args.filter(a => !a.startsWith('-')).map(f => {
    return fsLib.readFileSync(resolvePath(f), 'utf-8');
  }).join('\n');
}

function cmdHead(args) {
  let n = 10;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && args[i + 1]) { n = parseInt(args[++i]); }
    else if (!args[i].startsWith('-')) files.push(args[i]);
  }
  return files.map(f => {
    const lines = fsLib.readFileSync(resolvePath(f), 'utf-8').split('\n');
    return lines.slice(0, n).join('\n');
  }).join('\n');
}

function cmdTail(args) {
  let n = 10;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && args[i + 1]) { n = parseInt(args[++i]); }
    else if (!args[i].startsWith('-')) files.push(args[i]);
  }
  return files.map(f => {
    const lines = fsLib.readFileSync(resolvePath(f), 'utf-8').split('\n');
    return lines.slice(-n).join('\n');
  }).join('\n');
}

function cmdMkdir(args) {
  for (const a of args) {
    if (a === '-p') continue;
    fsLib.mkdirSync(resolvePath(a), { recursive: args.includes('-p') });
  }
  return '';
}

function cmdRm(args) {
  const flags = args.filter(a => a.startsWith('-')).join('');
  for (const a of args.filter(a => !a.startsWith('-'))) {
    const fp = resolvePath(a);
    if (flags.includes('r')) {
      fsLib.rmSync(fp, { recursive: true, force: flags.includes('f') });
    } else {
      fsLib.unlinkSync(fp);
    }
  }
  return '';
}

function cmdCp(args) {
  const files = args.filter(a => !a.startsWith('-'));
  if (files.length < 2) return 'Error: cp requires source and destination';
  const src = resolvePath(files[0]);
  const dst = resolvePath(files[1]);
  if (args.includes('-r') && fsLib.statSync(src).isDirectory()) {
    copyDirSync(src, dst);
  } else {
    fsLib.copyFileSync(src, dst);
  }
  return '';
}

function copyDirSync(src, dst) {
  fsLib.mkdirSync(dst, { recursive: true });
  for (const e of fsLib.readdirSync(src, { withFileTypes: true })) {
    const s = pathLib.join(src, e.name);
    const d = pathLib.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d);
    else fsLib.copyFileSync(s, d);
  }
}

function cmdMv(args) {
  const files = args.filter(a => !a.startsWith('-'));
  if (files.length < 2) return 'Error: mv requires source and destination';
  fsLib.renameSync(resolvePath(files[0]), resolvePath(files[1]));
  return '';
}

function cmdWc(args) {
  const flags = args.filter(a => a.startsWith('-')).join('');
  return args.filter(a => !a.startsWith('-')).map(f => {
    const content = fsLib.readFileSync(resolvePath(f), 'utf-8');
    const lines = content.split('\n').length;
    const words = content.split(/\s+/).filter(Boolean).length;
    const bytes = Buffer.byteLength(content);
    if (flags.includes('l')) return `${lines} ${f}`;
    if (flags.includes('w')) return `${words} ${f}`;
    if (flags.includes('c')) return `${bytes} ${f}`;
    return `${lines} ${words} ${bytes} ${f}`;
  }).join('\n');
}

function cmdFind(args) {
  let dir = '.', namePattern = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-name' && args[i + 1]) { namePattern = args[++i]; }
    else if (!args[i].startsWith('-')) { dir = args[i]; }
  }
  const base = resolvePath(dir);
  const files = walkDir(base, 10, 0);
  const filtered = namePattern
    ? files.filter(f => globToRegex(namePattern).test(pathLib.basename(f)))
    : files;
  return filtered.map(f => pathLib.relative(CWD, f)).join('\n');
}

function cmdTree(args) {
  const dir = resolvePath(args.find(a => !a.startsWith('-')) || '.');
  const lines = [];
  function walk(d, prefix, depth) {
    if (depth > 4) return;
    try {
      const entries = fsLib.readdirSync(d, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name));
      entries.forEach((e, i) => {
        const last = i === entries.length - 1;
        lines.push(prefix + (last ? '└── ' : '├── ') + e.name);
        if (e.isDirectory()) walk(pathLib.join(d, e.name), prefix + (last ? '    ' : '│   '), depth + 1);
      });
    } catch (e) {}
  }
  lines.push(pathLib.basename(dir));
  walk(dir, '', 0);
  return lines.join('\n');
}

function cmdSort(args) { return ''; /* pipe only */ }
function cmdUniq(args) { return ''; /* pipe only */ }

function cmdGrepBash(args) {
  const flags = args.filter(a => a.startsWith('-')).join('');
  const nonFlags = args.filter(a => !a.startsWith('-'));
  const pattern = nonFlags[0];
  const files = nonFlags.slice(1);
  if (!pattern) return 'Error: grep requires a pattern';
  const re = new RegExp(pattern, flags.includes('i') ? 'i' : '');
  return files.map(f => {
    const lines = fsLib.readFileSync(resolvePath(f), 'utf-8').split('\n');
    return lines.filter(l => re.test(l)).map(l => files.length > 1 ? `${f}:${l}` : l).join('\n');
  }).join('\n');
}

function cmdSed(args) { return 'Error: sed works via pipe only'; }

function pipeData(cmd, data) {
  const args = parseArgs(cmd);
  const name = args[0];
  const rest = args.slice(1);
  const lines = data.split('\n');

  switch (name) {
    case 'head': {
      const n = rest.includes('-n') ? parseInt(rest[rest.indexOf('-n') + 1]) : 10;
      return lines.slice(0, n).join('\n');
    }
    case 'tail': {
      const n = rest.includes('-n') ? parseInt(rest[rest.indexOf('-n') + 1]) : 10;
      return lines.slice(-n).join('\n');
    }
    case 'sort': return lines.sort().join('\n');
    case 'uniq': return lines.filter((l, i) => i === 0 || l !== lines[i - 1]).join('\n');
    case 'wc': {
      const flags = rest.join('');
      if (flags.includes('l')) return String(lines.length);
      return `${lines.length} ${data.split(/\s+/).filter(Boolean).length} ${data.length}`;
    }
    case 'grep': {
      const flags = rest.filter(a => a.startsWith('-')).join('');
      const pattern = rest.find(a => !a.startsWith('-'));
      if (!pattern) return data;
      const re = new RegExp(pattern, flags.includes('i') ? 'i' : '');
      const invert = flags.includes('v');
      return lines.filter(l => invert ? !re.test(l) : re.test(l)).join('\n');
    }
    case 'sed': {
      const expr = rest[0] || '';
      const m = expr.match(/^s\/(.+?)\/(.*)\/([gi]*)$/);
      if (m) {
        const re = new RegExp(m[1], m[3] || 'g');
        return lines.map(l => l.replace(re, m[2])).join('\n');
      }
      return data;
    }
    default: return data;
  }
}

function getDirSize(dir) {
  let size = 0;
  try {
    const entries = fsLib.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = pathLib.join(dir, e.name);
      if (e.isDirectory()) size += getDirSize(fp);
      else try { size += fsLib.statSync(fp).size; } catch (e) {}
    }
  } catch (e) {}
  return size;
}

// === EXECUTE TOOL ===
function executeTool(name, input) {
  switch (name) {
    case 'Read': return toolRead(input);
    case 'Write': return toolWrite(input);
    case 'Edit': return toolEdit(input);
    case 'Glob': return toolGlob(input);
    case 'Grep': return toolGrep(input);
    case 'Bash': return toolBash(input);
    default: return `Error: Unknown tool: ${name}`;
  }
}

// === ANTHROPIC API STREAMING ===
function streamAPI(messages, onEvent) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOL_DEFS,
      stream: true
    });

    const req = httpsLib.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          let msg = `API error ${res.statusCode}`;
          try { msg = JSON.parse(data).error?.message || msg; } catch (e) {}
          reject(new Error(msg));
        });
        res.on('error', reject);
        return;
      }

      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const parts = buffer.split('\n\n');
        buffer = parts.pop();
        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split('\n');
          let data = null;
          for (const line of lines) {
            if (line.startsWith('data: ')) data = line.slice(6);
          }
          if (!data || data === '[DONE]') continue;
          try { onEvent(JSON.parse(data)); } catch (e) {}
        }
      });
      res.on('end', resolve);
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// === AGENT LOOP ===
async function runAgent(userMessage, sendSSE) {
  // Simple message history (reset each request for now)
  const messages = [{ role: 'user', content: userMessage }];
  let iterations = 0;

  while (iterations++ < 30) {
    const contentBlocks = [];
    let currentType = null;
    let textBuf = '';
    let jsonBuf = '';
    let blockId = null;
    let blockName = null;
    let stopReason = null;

    await streamAPI(messages, (event) => {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block.type === 'text') {
            currentType = 'text';
            textBuf = '';
          } else if (event.content_block.type === 'tool_use') {
            currentType = 'tool_use';
            blockId = event.content_block.id;
            blockName = event.content_block.name;
            jsonBuf = '';
          }
          break;
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            textBuf += event.delta.text;
            sendSSE('text', { text: event.delta.text });
          } else if (event.delta.type === 'input_json_delta') {
            jsonBuf += event.delta.partial_json;
          }
          break;
        case 'content_block_stop':
          if (currentType === 'text') {
            contentBlocks.push({ type: 'text', text: textBuf });
          } else if (currentType === 'tool_use') {
            let parsed = {};
            try { parsed = JSON.parse(jsonBuf); } catch (e) {}
            contentBlocks.push({ type: 'tool_use', id: blockId, name: blockName, input: parsed });
          }
          currentType = null;
          break;
        case 'message_delta':
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          break;
      }
    });

    messages.push({ role: 'assistant', content: contentBlocks });

    if (stopReason !== 'tool_use') break;

    // Execute tools
    const toolCalls = contentBlocks.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const call of toolCalls) {
      sendSSE('tool_start', { name: call.name, input: call.input });
      const result = executeTool(call.name, call.input);
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      sendSSE('tool_end', { name: call.name, result: resultStr.slice(0, 500) });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: resultStr
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  sendSSE('done', {});
}

// === CONVERSATION HISTORY ===
let conversationMessages = [];

async function runAgentWithHistory(userMessage, sendSSE) {
  conversationMessages.push({ role: 'user', content: userMessage });
  const messages = [...conversationMessages];
  let iterations = 0;
  let lastAssistantBlocks = [];

  while (iterations++ < 30) {
    const contentBlocks = [];
    let currentType = null;
    let textBuf = '';
    let jsonBuf = '';
    let blockId = null;
    let blockName = null;
    let stopReason = null;

    await streamAPI(messages, (event) => {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block.type === 'text') {
            currentType = 'text';
            textBuf = '';
          } else if (event.content_block.type === 'tool_use') {
            currentType = 'tool_use';
            blockId = event.content_block.id;
            blockName = event.content_block.name;
            jsonBuf = '';
          }
          break;
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            textBuf += event.delta.text;
            sendSSE('text', { text: event.delta.text });
          } else if (event.delta.type === 'input_json_delta') {
            jsonBuf += event.delta.partial_json;
          }
          break;
        case 'content_block_stop':
          if (currentType === 'text') {
            contentBlocks.push({ type: 'text', text: textBuf });
          } else if (currentType === 'tool_use') {
            let parsed = {};
            try { parsed = JSON.parse(jsonBuf); } catch (e) {}
            contentBlocks.push({ type: 'tool_use', id: blockId, name: blockName, input: parsed });
          }
          currentType = null;
          break;
        case 'message_delta':
          if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          break;
      }
    });

    messages.push({ role: 'assistant', content: contentBlocks });
    lastAssistantBlocks = contentBlocks;

    if (stopReason !== 'tool_use') break;

    const toolCalls = contentBlocks.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const call of toolCalls) {
      sendSSE('tool_start', { name: call.name, input: call.input });
      const result = executeTool(call.name, call.input);
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      sendSSE('tool_end', { name: call.name, result: resultStr.slice(0, 500) });
      toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: resultStr });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  // Save to conversation history
  conversationMessages = messages;
  sendSSE('done', {});
}

// === HTTP SERVER ===
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>claude-mobile</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a2e; color: #e0e0e0; font-family: -apple-system, system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; }
#header { background: #16213e; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #2a2a4a; }
#header h1 { font-size: 16px; color: #c9a0dc; font-weight: 600; }
#header .cwd { font-size: 11px; color: #888; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#actions { display: flex; gap: 8px; }
#actions button { background: #2a2a4a; border: none; color: #aaa; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
#actions button:hover { background: #3a3a5a; color: #fff; }
#messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; -webkit-overflow-scrolling: touch; }
.msg { max-width: 92%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; word-wrap: break-word; }
.msg.user { background: #4a3f6b; align-self: flex-end; border-bottom-right-radius: 4px; }
.msg.assistant { background: #1e2a3a; align-self: flex-start; border-bottom-left-radius: 4px; }
.msg pre { background: #0d1117; padding: 8px 10px; border-radius: 6px; overflow-x: auto; margin: 6px 0; font-size: 12px; line-height: 1.4; }
.msg code { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.msg p code { background: #2a2a4a; padding: 1px 5px; border-radius: 3px; }
.tool-card { background: #1a2332; border-left: 3px solid #f0ad4e; padding: 6px 10px; margin: 4px 0; border-radius: 4px; font-size: 12px; }
.tool-card .tool-name { color: #f0ad4e; font-weight: 600; }
.tool-card .tool-detail { color: #888; margin-top: 2px; font-family: monospace; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tool-result { color: #6a9; font-size: 11px; margin-top: 2px; white-space: pre-wrap; max-height: 80px; overflow: hidden; }
#input-area { background: #16213e; padding: 10px 16px; border-top: 1px solid #2a2a4a; display: flex; gap: 8px; align-items: flex-end; }
#input { flex: 1; background: #1a1a2e; border: 1px solid #3a3a5a; color: #e0e0e0; padding: 10px 14px; border-radius: 20px; font-size: 14px; font-family: inherit; resize: none; max-height: 120px; outline: none; }
#input:focus { border-color: #c9a0dc; }
#send { background: #c9a0dc; border: none; color: #1a1a2e; width: 40px; height: 40px; border-radius: 50%; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
#send:disabled { background: #4a4a6a; cursor: not-allowed; }
#send:hover:not(:disabled) { background: #d4b0e7; }
.typing { display: inline-block; }
.typing::after { content: '▊'; animation: blink 0.8s infinite; }
@keyframes blink { 50% { opacity: 0; } }
</style>
</head>
<body>
<div id="header">
  <div>
    <h1>claude-mobile</h1>
    <div class="cwd" id="cwdDisplay"></div>
  </div>
  <div id="actions">
    <button onclick="clearChat()">Clear</button>
    <button onclick="changeCwd()">cd</button>
  </div>
</div>
<div id="messages"></div>
<div id="input-area">
  <textarea id="input" rows="1" placeholder="Ask Claude..." autofocus></textarea>
  <button id="send" onclick="sendMessage()">↑</button>
</div>
<script>
const messagesDiv = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const cwdDisplay = document.getElementById('cwdDisplay');
let sending = false;

cwdDisplay.textContent = '${CWD}';

// Auto-resize textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

// Enter to send (Shift+Enter for newline)
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function scrollBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  // Code blocks
  text = text.replace(/\`\`\`(\\w*?)\\n([\\s\\S]*?)\`\`\`/g, '<pre><code>$2</code></pre>');
  // Inline code
  text = text.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  // Bold
  text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
  // Headers
  text = text.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  text = text.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Lists
  text = text.replace(/^[\\-\\*] (.+)$/gm, '• $1');
  // Paragraphs
  text = text.replace(/\\n\\n/g, '<br><br>');
  text = text.replace(/\\n/g, '<br>');
  return text;
}

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || sending) return;

  sending = true;
  sendBtn.disabled = true;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  // User message
  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = text;
  messagesDiv.appendChild(userDiv);

  // Assistant message container
  const assistDiv = document.createElement('div');
  assistDiv.className = 'msg assistant';
  messagesDiv.appendChild(assistDiv);
  scrollBottom();

  let fullText = '';
  let currentTextSpan = document.createElement('span');
  currentTextSpan.className = 'typing';
  assistDiv.appendChild(currentTextSpan);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));

          if (event.type === 'text') {
            fullText += event.text;
            currentTextSpan.innerHTML = renderMarkdown(escapeHtml(fullText));
            scrollBottom();
          }
          else if (event.type === 'tool_start') {
            // Remove typing indicator
            currentTextSpan.classList.remove('typing');
            // Tool card
            const card = document.createElement('div');
            card.className = 'tool-card';
            card.innerHTML = '<span class="tool-name">' + event.name + '</span>'
              + '<div class="tool-detail">' + escapeHtml(JSON.stringify(event.input).slice(0, 100)) + '</div>';
            card.id = 'tool-' + Date.now();
            assistDiv.appendChild(card);
            scrollBottom();
          }
          else if (event.type === 'tool_end') {
            // Add result to last tool card
            const cards = assistDiv.querySelectorAll('.tool-card');
            const lastCard = cards[cards.length - 1];
            if (lastCard && event.result) {
              const resultDiv = document.createElement('div');
              resultDiv.className = 'tool-result';
              resultDiv.textContent = event.result.slice(0, 200);
              lastCard.appendChild(resultDiv);
            }
            // New text span for next response
            fullText = '';
            currentTextSpan = document.createElement('span');
            currentTextSpan.className = 'typing';
            assistDiv.appendChild(currentTextSpan);
            scrollBottom();
          }
          else if (event.type === 'done') {
            currentTextSpan.classList.remove('typing');
          }
          else if (event.type === 'error') {
            currentTextSpan.classList.remove('typing');
            currentTextSpan.innerHTML = '<span style="color:#e74c3c">Error: ' + escapeHtml(event.message) + '</span>';
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    currentTextSpan.classList.remove('typing');
    currentTextSpan.innerHTML = '<span style="color:#e74c3c">Connection error: ' + escapeHtml(err.message) + '</span>';
  }

  sending = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

function clearChat() {
  messagesDiv.innerHTML = '';
  fetch('/api/clear', { method: 'POST' });
}

function changeCwd() {
  const newCwd = prompt('Working directory:', cwdDisplay.textContent);
  if (newCwd) {
    fetch('/api/cwd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: newCwd })
    }).then(r => r.json()).then(data => {
      cwdDisplay.textContent = data.cwd;
    });
  }
}
</script>
</body>
</html>`;

// === SERVER ===
const server = httpLib.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Routes
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    const body = await readBody(req);
    const { message } = JSON.parse(body);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const sendSSE = (type, data) => {
      res.write('data: ' + JSON.stringify({ type, ...data }) + '\n\n');
    };

    try {
      await runAgentWithHistory(message, sendSSE);
    } catch (err) {
      sendSSE('error', { message: err.message });
    }
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/clear') {
    conversationMessages = [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/cwd') {
    const body = await readBody(req);
    const { cwd: newCwd } = JSON.parse(body);
    if (fsLib.existsSync(newCwd)) {
      CWD = newCwd;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cwd: CWD }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Directory not found' }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/cwd') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ cwd: CWD }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
  });
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('claude-mobile running on http://127.0.0.1:' + PORT);
  console.log('Working directory: ' + CWD);
});
