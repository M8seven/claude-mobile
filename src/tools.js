const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { loadConfig } = require('./config');

// --- Ignored directories ---
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
  '.next', '.nuxt', '__pycache__', '.DS_Store', 'coverage',
  '.cache', '.tmp', 'tmp', '.idea', '.vscode', '.expo',
  'Pods', 'DerivedData', '.build', '.swiftpm',
]);

// Binary file extensions to skip in grep
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.mov', '.avi',
  '.zip', '.gz', '.tar', '.rar', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.woff', '.woff2', '.ttf', '.eot',
  '.so', '.dylib', '.dll', '.exe', '.o',
  '.pyc', '.class', '.jar',
]);

// --- Tool definitions for the API ---
const toolDefinitions = [
  {
    name: 'Read',
    description: 'Read a file. Returns contents with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file' },
        offset: { type: 'number', description: 'Start line (1-indexed)' },
        limit: { type: 'number', description: 'Max lines to read' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'Write',
    description: 'Create or overwrite a file with the given content.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: 'Edit a file by replacing an exact string. The old_string must be unique in the file unless replace_all is true.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file' },
        old_string: { type: 'string', description: 'Exact string to find' },
        new_string: { type: 'string', description: 'Replacement string' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Glob',
    description: 'Find files matching a glob pattern. Supports ** for recursive, * for single level.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.js")' },
        path: { type: 'string', description: 'Base directory (default: cwd)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Grep',
    description: 'Search file contents for a regex pattern. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'Directory to search (default: cwd)' },
        glob: { type: 'string', description: 'File filter (e.g. "*.ts")' },
        context: { type: 'number', description: 'Lines of context around matches' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'Bash',
    description: 'Run a shell command. On Mac uses native shell. On iPad tries a remote relay server (if configured), then falls back to a JS polyfill supporting: ls, cat, head, tail, mkdir, rm, cp, mv, touch, pwd, echo, wc, find, tree, date, whoami, uname, sort, uniq, diff, grep (basic), sed (basic s///), xargs (basic).',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
      },
      required: ['command'],
    },
  },
  {
    name: 'Git',
    description: 'Git operations using isomorphic-git. Supports: status, add, commit, push, pull, log, diff, branch, checkout.',
    input_schema: {
      type: 'object',
      properties: {
        subcommand: {
          type: 'string',
          description: 'Git subcommand: status, add, commit, push, pull, log, diff, branch, checkout',
        },
        args: {
          type: 'object',
          description: 'Arguments for the subcommand. E.g. for commit: { message: "..." }, for add: { filepath: "." }, for push: { remote: "origin", branch: "main" }, for checkout: { branch: "feature" }, for log: { depth: 10 }',
        },
      },
      required: ['subcommand'],
    },
  },
];

// --- Path helpers ---

function resolvePath(filePath, cwd) {
  if (!filePath) return cwd;
  return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

// --- Tool: Read ---

function toolRead(input, cwd) {
  const fullPath = resolvePath(input.file_path, cwd);

  if (!fs.existsSync(fullPath)) {
    return `Error: File not found: ${fullPath}`;
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return `Error: ${fullPath} is a directory. Use Glob or Bash ls instead.`;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  const offset = Math.max(0, (input.offset || 1) - 1);
  const limit = input.limit || lines.length;
  const slice = lines.slice(offset, offset + limit);

  return slice.map((line, i) => {
    const lineNum = String(offset + i + 1).padStart(6);
    return `${lineNum}\t${line}`;
  }).join('\n');
}

// --- Tool: Write ---

function toolWrite(input, cwd) {
  const fullPath = resolvePath(input.file_path, cwd);
  const dir = path.dirname(fullPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, input.content, 'utf-8');
  const lines = input.content.split('\n').length;
  return `Written: ${fullPath} (${lines} lines, ${input.content.length} bytes)`;
}

// --- Tool: Edit ---

function toolEdit(input, cwd) {
  const fullPath = resolvePath(input.file_path, cwd);

  if (!fs.existsSync(fullPath)) {
    return `Error: File not found: ${fullPath}`;
  }

  let content = fs.readFileSync(fullPath, 'utf-8');

  if (!content.includes(input.old_string)) {
    return `Error: old_string not found in ${fullPath}. Make sure it matches exactly (including whitespace and indentation).`;
  }

  const count = content.split(input.old_string).length - 1;

  if (!input.replace_all && count > 1) {
    return `Error: old_string found ${count} times in ${fullPath}. Provide more surrounding context to make it unique, or set replace_all: true.`;
  }

  if (input.replace_all) {
    content = content.split(input.old_string).join(input.new_string);
  } else {
    content = content.replace(input.old_string, input.new_string);
  }

  fs.writeFileSync(fullPath, content, 'utf-8');
  return `Edited: ${fullPath} (${count} replacement${count > 1 ? 's' : ''})`;
}

// --- Tool: Glob ---

function globToRegex(pattern) {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regex += '(?:.+/)?';
        i += 3;
        continue;
      }
      regex += '.*';
      i += 2;
      continue;
    }
    if (c === '*') { regex += '[^/]*'; }
    else if (c === '?') { regex += '[^/]'; }
    else if (c === '.') { regex += '\\.'; }
    else if (c === '{') { regex += '('; }
    else if (c === '}') { regex += ')'; }
    else if (c === ',') { regex += '|'; }
    else { regex += c; }
    i++;
  }
  return new RegExp('^' + regex + '$');
}

function toolGlob(input, cwd) {
  const basePath = resolvePath(input.path, cwd);
  const regex = globToRegex(input.pattern);
  const results = [];

  function walk(dir, depth) {
    if (depth > 20 || results.length > 500) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (regex.test(rel)) {
          results.push(fullPath);
        }
      }
    } catch (e) {}
  }

  walk(basePath, 0);

  if (results.length === 0) return 'No files found.';

  const display = results.slice(0, 200);
  let output = display.join('\n');
  if (results.length > 200) {
    output += `\n... and ${results.length - 200} more files`;
  }
  return output;
}

// --- Tool: Grep ---

function toolGrep(input, cwd) {
  const basePath = resolvePath(input.path, cwd);
  const contextLines = input.context || 0;

  let searchRegex;
  try {
    searchRegex = new RegExp(input.pattern, 'i');
  } catch (e) {
    return `Error: Invalid regex pattern: ${e.message}`;
  }

  // Build file filter regex
  const fileFilter = input.glob ? globToRegex(input.glob) : null;
  const results = [];
  const MAX = 150;

  function walk(dir, depth) {
    if (depth > 20 || results.length >= MAX) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= MAX) break;
        if (IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(basePath, fullPath);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else {
          // Skip binary files
          const ext = path.extname(entry.name).toLowerCase();
          if (BINARY_EXT.has(ext)) continue;

          // Apply file filter
          if (fileFilter && !fileFilter.test(rel) && !fileFilter.test(entry.name)) continue;

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            // Skip files that look binary
            if (content.includes('\0')) continue;

            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < MAX; i++) {
              if (searchRegex.test(lines[i])) {
                if (contextLines > 0) {
                  const start = Math.max(0, i - contextLines);
                  const end = Math.min(lines.length, i + contextLines + 1);
                  const contextBlock = lines.slice(start, end).map((l, j) => {
                    const lineNum = start + j + 1;
                    const marker = (start + j === i) ? '>' : ' ';
                    return `${marker} ${fullPath}:${lineNum}: ${l}`;
                  }).join('\n');
                  results.push(contextBlock);
                } else {
                  results.push(`${fullPath}:${i + 1}: ${lines[i].trimEnd()}`);
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  }

  walk(basePath, 0);

  if (results.length === 0) return 'No matches found.';
  let output = results.join('\n');
  if (results.length >= MAX) {
    output += `\n... (truncated at ${MAX} matches)`;
  }
  return output;
}

// --- Tool: Bash (native -> relay -> JS polyfill) ---

async function toolBash(input, cwd) {
  const command = input.command.trim();

  // 1. Try native child_process (works on Mac)
  try {
    const { execSync } = require('child_process');
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output || '(no output)';
  } catch (nativeError) {
    // child_process available but command itself failed — return the error output
    if (nativeError.stdout !== undefined || nativeError.stderr !== undefined) {
      return (nativeError.stderr || '') + (nativeError.stdout || '') || `Exit code: ${nativeError.status}`;
    }
    // child_process not available at all (iPad) — fall through
  }

  // 2. Try remote relay (if configured)
  const cfg = loadConfig();
  if (cfg.relayUrl) {
    try {
      const result = await execViaRelay(command, cwd, cfg.relayUrl, cfg.relayToken);
      return result;
    } catch (relayError) {
      // Relay failed — fall through to JS polyfill
    }
  }

  // 3. JS polyfill for iPad
  return jsShell(command, cwd);
}

// Async HTTP POST to relay server
function execViaRelay(command, cwd, relayUrl, relayToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ command, cwd, timeout: 30000 });
    const url = new URL('/exec', relayUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(relayToken ? { 'Authorization': `Bearer ${relayToken}` } : {}),
      },
      timeout: 35000,
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.stdout || parsed.output || data || '(no output)');
          } catch {
            resolve(data || '(no output)');
          }
        } else {
          reject(new Error(`Relay returned HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Relay request timed out')); });
    req.write(body);
    req.end();
  });
}

function jsShell(command, cwd) {
  // Handle && chains
  if (command.includes(' && ')) {
    const parts = command.split(' && ');
    let output = '';
    for (const part of parts) {
      const result = execSingle(part.trim(), cwd);
      if (result.error) return output + result.output;
      output += result.output;
    }
    return output || '(no output)';
  }

  // Handle pipes (basic: cmd1 | cmd2)
  if (command.includes(' | ')) {
    const parts = command.split(' | ');
    let input = '';
    for (const part of parts) {
      const result = execSingle(part.trim(), cwd, input);
      if (result.error) return result.output;
      input = result.output;
    }
    return input || '(no output)';
  }

  const result = execSingle(command, cwd);
  return result.output || '(no output)';
}

function execSingle(command, cwd, pipeInput) {
  // Handle output redirection
  let outputFile = null;
  let append = false;
  let cmd = command;

  const appendMatch = cmd.match(/^(.+?)\s*>>\s*(.+)$/);
  const writeMatch = cmd.match(/^(.+?)\s*>\s*(.+)$/);

  if (appendMatch) {
    cmd = appendMatch[1].trim();
    outputFile = appendMatch[2].trim();
    append = true;
  } else if (writeMatch) {
    cmd = writeMatch[1].trim();
    outputFile = writeMatch[2].trim();
  }

  const tokens = parseTokens(cmd);
  if (tokens.length === 0) return { output: '', error: false };

  const name = tokens[0];
  const args = tokens.slice(1);
  let output = '';
  let error = false;

  try {
    switch (name) {
      case 'ls': {
        const flagArgs = args.filter(a => a.startsWith('-'));
        const pathArgs = args.filter(a => !a.startsWith('-'));
        const target = pathArgs[0] ? resolvePath(pathArgs[0], cwd) : cwd;
        const flags = flagArgs.join('');
        const showAll = flags.includes('a');
        const showLong = flags.includes('l');
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const filtered = showAll ? entries : entries.filter(e => !e.name.startsWith('.'));

        if (showLong) {
          output = filtered.map(e => {
            const stat = fs.statSync(path.join(target, e.name));
            const type = e.isDirectory() ? 'd' : '-';
            const size = String(stat.size).padStart(8);
            const mtime = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
            return `${type} ${size} ${mtime} ${e.name}${e.isDirectory() ? '/' : ''}`;
          }).join('\n') + '\n';
        } else {
          output = filtered.map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n') + '\n';
        }
        break;
      }

      case 'cat': {
        if (pipeInput && args.length === 0) { output = pipeInput; break; }
        for (const arg of args) {
          output += fs.readFileSync(resolvePath(arg, cwd), 'utf-8');
        }
        break;
      }

      case 'head': {
        let n = 10, file = null;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-n' && args[i + 1]) { n = parseInt(args[++i]); }
          else if (args[i].match(/^-\d+$/)) { n = parseInt(args[i].slice(1)); }
          else { file = args[i]; }
        }
        const content = file ? fs.readFileSync(resolvePath(file, cwd), 'utf-8') : (pipeInput || '');
        output = content.split('\n').slice(0, n).join('\n') + '\n';
        break;
      }

      case 'tail': {
        let n = 10, file = null;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-n' && args[i + 1]) { n = parseInt(args[++i]); }
          else if (args[i].match(/^-\d+$/)) { n = parseInt(args[i].slice(1)); }
          else { file = args[i]; }
        }
        const content = file ? fs.readFileSync(resolvePath(file, cwd), 'utf-8') : (pipeInput || '');
        const lines = content.split('\n');
        output = lines.slice(-n).join('\n') + '\n';
        break;
      }

      case 'mkdir': {
        const recursive = args.some(a => a === '-p' || a === '-pv');
        const dirs = args.filter(a => !a.startsWith('-'));
        for (const d of dirs) {
          fs.mkdirSync(resolvePath(d, cwd), { recursive });
        }
        break;
      }

      case 'rm': {
        const flags = args.filter(a => a.startsWith('-')).join('');
        const recursive = flags.includes('r');
        const force = flags.includes('f');
        const targets = args.filter(a => !a.startsWith('-'));
        for (const t of targets) {
          fs.rmSync(resolvePath(t, cwd), { recursive, force });
        }
        break;
      }

      case 'cp': {
        const flags = args.filter(a => a.startsWith('-')).join('');
        const paths = args.filter(a => !a.startsWith('-'));
        if (paths.length < 2) { output = 'Error: cp requires source and destination\n'; error = true; break; }
        const src = resolvePath(paths[0], cwd);
        const dst = resolvePath(paths[1], cwd);
        if (flags.includes('r') && fs.statSync(src).isDirectory()) {
          copyDirSync(src, dst);
        } else {
          fs.copyFileSync(src, dst);
        }
        break;
      }

      case 'mv': {
        const paths = args.filter(a => !a.startsWith('-'));
        if (paths.length < 2) { output = 'Error: mv requires source and destination\n'; error = true; break; }
        fs.renameSync(resolvePath(paths[0], cwd), resolvePath(paths[1], cwd));
        break;
      }

      case 'touch': {
        for (const arg of args.filter(a => !a.startsWith('-'))) {
          const p = resolvePath(arg, cwd);
          if (fs.existsSync(p)) {
            const now = new Date();
            fs.utimesSync(p, now, now);
          } else {
            fs.writeFileSync(p, '');
          }
        }
        break;
      }

      case 'pwd': output = cwd + '\n'; break;

      case 'echo': output = args.join(' ') + '\n'; break;

      case 'printf': {
        // Very basic printf
        output = args.join(' ').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
        break;
      }

      case 'wc': {
        const flags = args.filter(a => a.startsWith('-')).join('');
        const files = args.filter(a => !a.startsWith('-'));
        const content = files.length > 0
          ? fs.readFileSync(resolvePath(files[0], cwd), 'utf-8')
          : (pipeInput || '');
        const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
        const words = content.split(/\s+/).filter(Boolean).length;
        const chars = content.length;
        if (flags.includes('l')) output = `${lines}\n`;
        else if (flags.includes('w')) output = `${words}\n`;
        else if (flags.includes('c')) output = `${chars}\n`;
        else output = `  ${lines}  ${words}  ${chars}${files[0] ? ' ' + files[0] : ''}\n`;
        break;
      }

      case 'sort': {
        const content = args.length > 0 && !args[0].startsWith('-')
          ? fs.readFileSync(resolvePath(args[0], cwd), 'utf-8')
          : (pipeInput || '');
        const lines = content.split('\n').filter(Boolean);
        const reverse = args.includes('-r');
        const numeric = args.includes('-n');
        lines.sort((a, b) => {
          if (numeric) return parseFloat(a) - parseFloat(b);
          return a.localeCompare(b);
        });
        if (reverse) lines.reverse();
        output = lines.join('\n') + '\n';
        break;
      }

      case 'uniq': {
        const content = pipeInput || '';
        const lines = content.split('\n');
        const unique = lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
        output = unique.join('\n');
        break;
      }

      case 'grep': {
        const flags = args.filter(a => a.startsWith('-')).join('');
        const nonFlags = args.filter(a => !a.startsWith('-'));
        const pattern = nonFlags[0];
        const file = nonFlags[1];
        const content = file
          ? fs.readFileSync(resolvePath(file, cwd), 'utf-8')
          : (pipeInput || '');
        const regex = new RegExp(pattern, flags.includes('i') ? 'i' : '');
        const invert = flags.includes('v');
        const lines = content.split('\n').filter(l => invert ? !regex.test(l) : regex.test(l));
        output = lines.join('\n') + '\n';
        break;
      }

      case 'sed': {
        // Basic s/old/new/g
        const sedExpr = args[0];
        const file = args[1];
        const match = sedExpr.match(/^s([\/|#])(.+?)\1(.+?)\1([gi]*)$/);
        if (!match) { output = 'Error: Only s/old/new/flags supported\n'; error = true; break; }
        const regex = new RegExp(match[2], match[4] || '');
        const replacement = match[3];
        const content = file
          ? fs.readFileSync(resolvePath(file, cwd), 'utf-8')
          : (pipeInput || '');
        output = content.replace(regex, replacement);
        if (!output.endsWith('\n')) output += '\n';
        break;
      }

      case 'find': {
        let searchPath = cwd;
        let namePattern = null;
        let typeFilter = null;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-name') { namePattern = args[++i]; }
          else if (args[i] === '-type') { typeFilter = args[++i]; }
          else if (!args[i].startsWith('-')) { searchPath = resolvePath(args[i], cwd); }
        }
        const found = [];
        function findWalk(dir, depth) {
          if (depth > 10 || found.length > 200) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (IGNORE_DIRS.has(entry.name)) continue;
              const fullPath = path.join(dir, entry.name);
              const nameMatch = !namePattern || simpleMatch(entry.name, namePattern);
              const typeMatch = !typeFilter ||
                (typeFilter === 'f' && entry.isFile()) ||
                (typeFilter === 'd' && entry.isDirectory());
              if (nameMatch && typeMatch) found.push(fullPath);
              if (entry.isDirectory()) findWalk(fullPath, depth + 1);
            }
          } catch (e) {}
        }
        findWalk(searchPath, 0);
        output = found.join('\n') + '\n';
        break;
      }

      case 'tree': {
        const target = args.filter(a => !a.startsWith('-'))[0];
        const dir = target ? resolvePath(target, cwd) : cwd;
        output = path.basename(dir) + '/\n';
        function printTree(d, prefix, depth) {
          if (depth > 4) return;
          try {
            const entries = fs.readdirSync(d, { withFileTypes: true })
              .filter(e => !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name))
              .sort((a, b) => a.name.localeCompare(b.name));
            entries.forEach((entry, i) => {
              const isLast = i === entries.length - 1;
              output += prefix + (isLast ? '└── ' : '├── ') + entry.name + (entry.isDirectory() ? '/' : '') + '\n';
              if (entry.isDirectory()) {
                printTree(path.join(d, entry.name), prefix + (isLast ? '    ' : '│   '), depth + 1);
              }
            });
          } catch (e) {}
        }
        printTree(dir, '', 0);
        break;
      }

      case 'env': {
        output = Object.entries(process.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n') + '\n';
        break;
      }

      case 'export': {
        for (const arg of args) {
          const eq = arg.indexOf('=');
          if (eq > 0) {
            process.env[arg.slice(0, eq)] = arg.slice(eq + 1);
          }
        }
        break;
      }

      case 'date': output = new Date().toString() + '\n'; break;
      case 'whoami': output = require('os').userInfo().username + '\n'; break;
      case 'uname': {
        const os = require('os');
        output = `${os.type()} ${os.release()} ${os.arch()}\n`;
        break;
      }
      case 'hostname': output = require('os').hostname() + '\n'; break;
      case 'true': break;
      case 'false': { error = true; break; }
      case 'test': case '[': {
        // Very basic test: -f file, -d dir, -e exists
        const tArgs = name === '[' ? args.slice(0, -1) : args; // remove trailing ]
        if (tArgs[0] === '-f') { error = !fs.existsSync(resolvePath(tArgs[1], cwd)) || !fs.statSync(resolvePath(tArgs[1], cwd)).isFile(); }
        else if (tArgs[0] === '-d') { error = !fs.existsSync(resolvePath(tArgs[1], cwd)) || !fs.statSync(resolvePath(tArgs[1], cwd)).isDirectory(); }
        else if (tArgs[0] === '-e') { error = !fs.existsSync(resolvePath(tArgs[1], cwd)); }
        else if (tArgs[0] === '-z') { error = (tArgs[1] || '').length !== 0; }
        else if (tArgs[0] === '-n') { error = (tArgs[1] || '').length === 0; }
        break;
      }
      case 'basename': output = path.basename(args[0] || '') + '\n'; break;
      case 'dirname': output = path.dirname(args[0] || '') + '\n'; break;
      case 'realpath': output = resolvePath(args[0] || '.', cwd) + '\n'; break;
      case 'stat': {
        const p = resolvePath(args[0], cwd);
        const s = fs.statSync(p);
        output = `  File: ${p}\n  Size: ${s.size}\n  Type: ${s.isDirectory() ? 'directory' : 'file'}\nModify: ${s.mtime.toISOString()}\n`;
        break;
      }
      case 'du': {
        const target = args.filter(a => !a.startsWith('-'))[0] || '.';
        const p = resolvePath(target, cwd);
        function duSize(dir) {
          let total = 0;
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fp = path.join(dir, entry.name);
              if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name)) {
                total += duSize(fp);
              } else if (entry.isFile()) {
                total += fs.statSync(fp).size;
              }
            }
          } catch (e) {}
          return total;
        }
        const bytes = duSize(p);
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        output = `${mb}M\t${target}\n`;
        break;
      }
      case 'xargs': {
        // Basic: pipe | xargs cmd
        if (!pipeInput) { output = 'Error: xargs needs pipe input\n'; error = true; break; }
        const xCmd = args.join(' ');
        const items = pipeInput.trim().split('\n').filter(Boolean);
        for (const item of items) {
          const result = execSingle(`${xCmd} ${item}`, cwd);
          output += result.output;
          if (result.error) { error = true; break; }
        }
        break;
      }

      default:
        output = `Command '${name}' not available in JS shell.\nAvailable: ls, cat, head, tail, mkdir, rm, cp, mv, touch, pwd, echo, wc, sort, uniq, grep, sed, find, tree, env, export, date, stat, du, basename, dirname, xargs, test\n`;
        error = true;
    }
  } catch (e) {
    output = `Error: ${e.message}\n`;
    error = true;
  }

  // Handle output redirection
  if (outputFile && !error) {
    const p = resolvePath(outputFile, cwd);
    if (append) fs.appendFileSync(p, output);
    else fs.writeFileSync(p, output);
    output = '';
  }

  return { output, error };
}

// --- Helpers ---

function simpleMatch(name, pattern) {
  const regex = new RegExp(
    '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(name);
}

function parseTokens(cmd) {
  const tokens = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];

    if (escape) { current += c; escape = false; continue; }
    if (c === '\\' && !inSingle) { escape = true; continue; }
    if (c === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (c === ' ' && !inSingle && !inDouble) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += c;
  }
  if (current) tokens.push(current);
  return tokens;
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// --- Tool: Git (isomorphic-git) ---

async function toolGit(input, cwd) {
  let git;
  try {
    git = require('isomorphic-git');
  } catch (e) {
    return 'Error: isomorphic-git is not installed. Run: npm install isomorphic-git';
  }

  const gitHttpModule = await (async () => {
    try { return await import('isomorphic-git/http/node/index.cjs'); } catch {}
    try { return { default: require('isomorphic-git/http/node') }; } catch {}
    return { default: null };
  })();
  const gitHttp = gitHttpModule ? gitHttpModule.default : null;

  const cfg = loadConfig();
  const args = input.args || {};
  const dir = args.dir ? resolvePath(args.dir, cwd) : cwd;

  const onAuth = () => ({
    username: cfg.githubToken || 'token',
    password: cfg.githubToken || '',
  });

  try {
    switch (input.subcommand) {
      case 'status': {
        const matrix = await git.statusMatrix({ fs, dir });
        if (matrix.length === 0) return 'Nothing to report.';
        const lines = matrix.map(([filepath, head, workdir, stage]) => {
          let status = '';
          if (head === 0 && workdir === 2) status = '?? (untracked)';
          else if (head === 1 && workdir === 2 && stage === 2) status = 'M  (modified, staged)';
          else if (head === 1 && workdir === 2 && stage === 1) status = ' M (modified, unstaged)';
          else if (head === 0 && workdir === 2 && stage === 2) status = 'A  (added)';
          else if (head === 1 && workdir === 0) status = 'D  (deleted)';
          else status = `${head}${workdir}${stage} (unknown)`;
          return `${status} ${filepath}`;
        });
        return lines.join('\n');
      }

      case 'add': {
        const filepath = args.filepath || '.';
        if (filepath === '.') {
          const matrix = await git.statusMatrix({ fs, dir });
          for (const [fp, head, workdir] of matrix) {
            if (workdir !== 1) {
              await git.add({ fs, dir, filepath: fp });
            }
          }
          return `Added all changes.`;
        } else {
          await git.add({ fs, dir, filepath });
          return `Added: ${filepath}`;
        }
      }

      case 'commit': {
        if (!args.message) return 'Error: commit requires args.message';
        const author = {
          name: args.authorName || cfg.authorName || 'claude-mobile',
          email: args.authorEmail || cfg.authorEmail || 'claude-mobile@localhost',
        };
        const sha = await git.commit({ fs, dir, message: args.message, author });
        return `Committed: ${sha}`;
      }

      case 'push': {
        if (!gitHttp) return 'Error: isomorphic-git HTTP module not available.';
        const remote = args.remote || 'origin';
        const branch = args.branch || await git.currentBranch({ fs, dir }) || 'main';
        const result = await git.push({ fs, http: gitHttp, dir, remote, remoteRef: branch, onAuth });
        return `Pushed to ${remote}/${branch}. ok: ${result.ok}, errors: ${JSON.stringify(result.errors)}`;
      }

      case 'pull': {
        if (!gitHttp) return 'Error: isomorphic-git HTTP module not available.';
        const remote = args.remote || 'origin';
        const branch = args.branch || await git.currentBranch({ fs, dir }) || 'main';
        const author = {
          name: args.authorName || cfg.authorName || 'claude-mobile',
          email: args.authorEmail || cfg.authorEmail || 'claude-mobile@localhost',
        };
        await git.pull({ fs, http: gitHttp, dir, remote, remoteRef: branch, author, onAuth });
        return `Pulled from ${remote}/${branch}.`;
      }

      case 'log': {
        const depth = args.depth || 10;
        const commits = await git.log({ fs, dir, depth });
        return commits.map(c => {
          const d = new Date(c.commit.author.timestamp * 1000).toISOString().slice(0, 10);
          return `${c.oid.slice(0, 7)} ${d} ${c.commit.message.split('\n')[0]}`;
        }).join('\n');
      }

      case 'diff': {
        // Show unstaged diff for a file or all files
        const filepath = args.filepath;
        if (filepath) {
          const headContent = await git.readBlob({ fs, dir, oid: await git.resolveRef({ fs, dir, ref: 'HEAD' }), filepath })
            .then(b => Buffer.from(b.blob).toString('utf-8'))
            .catch(() => '');
          const workContent = fs.existsSync(path.join(dir, filepath))
            ? fs.readFileSync(path.join(dir, filepath), 'utf-8')
            : '';
          if (headContent === workContent) return 'No changes.';
          // Simple unified diff
          const headLines = headContent.split('\n');
          const workLines = workContent.split('\n');
          let out = `--- a/${filepath}\n+++ b/${filepath}\n`;
          const maxLen = Math.max(headLines.length, workLines.length);
          for (let i = 0; i < maxLen; i++) {
            const h = headLines[i];
            const w = workLines[i];
            if (h !== w) {
              if (h !== undefined) out += `-${h}\n`;
              if (w !== undefined) out += `+${w}\n`;
            }
          }
          return out;
        }
        return 'Tip: provide args.filepath for a specific file diff.';
      }

      case 'branch': {
        if (args.create) {
          await git.branch({ fs, dir, ref: args.create });
          return `Created branch: ${args.create}`;
        }
        const branches = await git.listBranches({ fs, dir });
        const current = await git.currentBranch({ fs, dir });
        return branches.map(b => (b === current ? `* ${b}` : `  ${b}`)).join('\n');
      }

      case 'checkout': {
        if (!args.branch) return 'Error: checkout requires args.branch';
        await git.checkout({ fs, dir, ref: args.branch });
        return `Switched to branch: ${args.branch}`;
      }

      default:
        return `Error: Unknown git subcommand '${input.subcommand}'. Supported: status, add, commit, push, pull, log, diff, branch, checkout`;
    }
  } catch (e) {
    return `Git error: ${e.message}`;
  }
}

// --- Executor ---

async function executeTool(name, input, cwd) {
  switch (name) {
    case 'Read': return toolRead(input, cwd);
    case 'Write': return toolWrite(input, cwd);
    case 'Edit': return toolEdit(input, cwd);
    case 'Glob': return toolGlob(input, cwd);
    case 'Grep': return toolGrep(input, cwd);
    case 'Bash': return toolBash(input, cwd);
    case 'Git': return toolGit(input, cwd);
    default: return `Error: Unknown tool '${name}'`;
  }
}

module.exports = { toolDefinitions, executeTool };
