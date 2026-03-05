#!/usr/bin/env python3
"""claude-mobile — Claude Code for iPad
Browser calls Anthropic API directly (CORS). Server handles tools only.
"""
import http.server, json, os, glob, re, subprocess, threading

CWD = os.getcwd()
CWD_LOCK = threading.Lock()

# Load HTML from index.html in the same directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(SCRIPT_DIR, 'index.html'), 'r') as f:
    HTML_CONTENT = f.read()


def resolve_path(path):
    if os.path.isabs(path):
        return path
    with CWD_LOCK:
        return os.path.join(CWD, path)


def tool_read(inp):
    file_path = resolve_path(inp['file_path'])
    offset = inp.get('offset')
    limit = inp.get('limit')
    try:
        with open(file_path, 'r', errors='replace') as f:
            lines = f.readlines()
        if offset is not None:
            start = max(0, int(offset) - 1)
            lines = lines[start:]
        if limit is not None:
            lines = lines[:int(limit)]
        result = ''
        start_num = int(offset) if offset else 1
        for i, line in enumerate(lines):
            result += f'{start_num + i:6}\t{line}'
        return result if result else '(empty file)'
    except FileNotFoundError:
        return f'Error: File not found: {file_path}'
    except PermissionError:
        return f'Error: Permission denied: {file_path}'
    except Exception as e:
        return f'Error: {e}'


def tool_write(inp):
    file_path = resolve_path(inp['file_path'])
    content = inp['content']
    try:
        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
        with open(file_path, 'w') as f:
            f.write(content)
        return f'File written: {file_path} ({len(content.encode())} bytes)'
    except PermissionError:
        return f'Error: Permission denied: {file_path}'
    except Exception as e:
        return f'Error: {e}'


def tool_edit(inp):
    file_path = resolve_path(inp['file_path'])
    old_string = inp['old_string']
    new_string = inp['new_string']
    try:
        with open(file_path, 'r', errors='replace') as f:
            content = f.read()
        count = content.count(old_string)
        if count == 0:
            return f'Error: old_string not found in {file_path}'
        if count > 1:
            return f'Error: old_string appears {count} times in {file_path} (ambiguous)'
        new_content = content.replace(old_string, new_string, 1)
        with open(file_path, 'w') as f:
            f.write(new_content)
        return f'File edited: {file_path}'
    except FileNotFoundError:
        return f'Error: File not found: {file_path}'
    except PermissionError:
        return f'Error: Permission denied: {file_path}'
    except Exception as e:
        return f'Error: {e}'


def tool_glob(inp):
    pattern = inp['pattern']
    base_path = inp.get('path')
    if base_path is None:
        with CWD_LOCK:
            base_path = CWD
    else:
        base_path = resolve_path(base_path)
    full_pattern = os.path.join(base_path, pattern) if not os.path.isabs(pattern) else pattern
    try:
        matches = glob.glob(full_pattern, recursive=True)[:200]
        return '\n'.join(matches) if matches else '(no matches)'
    except Exception as e:
        return f'Error: {e}'


def tool_grep(inp):
    pattern = inp['pattern']
    base_path = inp.get('path')
    include = inp.get('include')
    if base_path is None:
        with CWD_LOCK:
            base_path = CWD
    else:
        base_path = resolve_path(base_path)
    try:
        regex = re.compile(pattern)
    except re.error as e:
        return f'Error: Invalid regex: {e}'

    import fnmatch
    results = []
    for dirpath, dirnames, filenames in os.walk(base_path):
        dirnames[:] = [d for d in dirnames if d not in ('.git', 'node_modules', '.next', '__pycache__')]
        for filename in filenames:
            if include and not fnmatch.fnmatch(filename, include):
                continue
            filepath = os.path.join(dirpath, filename)
            try:
                with open(filepath, 'rb') as f:
                    if b'\x00' in f.read(1024):
                        continue
                with open(filepath, 'r', errors='replace') as f:
                    for lineno, line in enumerate(f, 1):
                        if regex.search(line):
                            results.append(f'{filepath}:{lineno}:{line.rstrip()}')
                            if len(results) >= 100:
                                return '\n'.join(results)
            except Exception:
                continue
    return '\n'.join(results) if results else '(no matches)'


def tool_bash(inp):
    global CWD
    command = inp.get('command', '').strip()
    if not command:
        return ''

    cd_match = re.match(r'^cd\s*(.*)', command)
    if cd_match:
        target = cd_match.group(1).strip().strip('"').strip("'")
        if not target or target == '~':
            target = os.path.expanduser('~')
        elif target == '-':
            with CWD_LOCK:
                return f'Current directory: {CWD}'
        else:
            target = os.path.expanduser(target)
            if not os.path.isabs(target):
                with CWD_LOCK:
                    target = os.path.normpath(os.path.join(CWD, target))
        target = os.path.normpath(target)
        if os.path.isdir(target):
            with CWD_LOCK:
                CWD = target
            return f'Changed directory to: {target}'
        return f'Error: cd: no such directory: {target}'

    with CWD_LOCK:
        cwd = CWD
    try:
        result = subprocess.run(command, shell=True, cwd=cwd,
                                capture_output=True, text=True, timeout=30)
        output = result.stdout + result.stderr
        if len(output) > 10000:
            output = output[:10000] + '\n...(truncated)'
        return output if output else '(no output)'
    except subprocess.TimeoutExpired:
        return 'Error: Command timed out after 30 seconds'
    except Exception as e:
        return f'Error: {e}'


def tool_git(inp):
    subcommand = inp.get('subcommand', 'status')
    args = inp.get('args', {}) or {}
    git_args = [subcommand]

    if subcommand == 'add':
        git_args.append(args.get('filepath', '.'))
    elif subcommand == 'commit':
        git_args.extend(['-m', args.get('message', 'update')])
    elif subcommand in ('push', 'pull'):
        git_args.append(args.get('remote', 'origin'))
        if args.get('branch'):
            git_args.append(args['branch'])
    elif subcommand == 'log':
        depth = args.get('depth', 10)
        git_args.extend(['--oneline', f'-{depth}'])
    elif subcommand == 'branch' and args.get('create'):
        git_args = ['checkout', '-b', args['create']]
    elif subcommand == 'checkout' and args.get('branch'):
        git_args.append(args['branch'])

    with CWD_LOCK:
        cwd = CWD
    try:
        result = subprocess.run(['git'] + git_args, cwd=cwd,
                                capture_output=True, text=True, timeout=30)
        output = (result.stdout + result.stderr).strip()
        return output if output else '(no output)'
    except subprocess.TimeoutExpired:
        return 'Error: git command timed out'
    except Exception as e:
        return f'Error: {e}'


TOOLS = {
    'Read': tool_read, 'Write': tool_write, 'Edit': tool_edit,
    'Glob': tool_glob, 'Grep': tool_grep, 'Bash': tool_bash, 'Git': tool_git,
}


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/':
            body = HTML_CONTENT.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)
        elif self.path == '/api/status':
            with CWD_LOCK:
                cwd = CWD
            self._json({'ok': True, 'cwd': cwd})
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def do_POST(self):
        if self.path == '/api/tool':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
                name = data.get('name', '')
                inp = data.get('input', {})
                fn = TOOLS.get(name)
                if not fn:
                    self._json({'result': f'Error: Unknown tool: {name}'})
                    return
                try:
                    result = fn(inp)
                except Exception as e:
                    result = f'Error: {e}'
                self._json({'result': result})
            except json.JSONDecodeError:
                self._json({'result': 'Error: Invalid JSON'})
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def _json(self, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 3000))
    server = Server(('127.0.0.1', PORT), Handler)
    print(f'claude-mobile on http://localhost:{PORT}')
    server.serve_forever()
