# claude-mobile

**Claude Code for iPad.** The first working agentic AI coding tool that runs entirely on iPad.

Tell Claude what you want. It reads your code, edits files, searches your codebase, commits and pushes to GitHub — autonomously, from your iPad.

## What It Does

- **Agentic loop** — Claude plans, executes, and verifies changes in a loop (up to 50 iterations)
- **7 tools** — Read, Write, Edit, Glob, Grep, Bash, Git — all running locally
- **Real streaming** — token-by-token SSE, see Claude think in real time
- **Git integration** — clone, commit, push, pull via isomorphic-git (no native git needed)
- **Shell polyfill** — ~25 Unix commands in pure JS for environments without native shell
- **Multiple interfaces** — Web UI, CLI, or Python server + browser

## Quick Start

### Web UI (Node.js — recommended)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node web.js
# Open http://localhost:3000
```

### Python Server + Browser

```bash
python3 claude-mobile.py
# Open http://localhost:3000
# Enter your API key in the browser
```

### CLI

```bash
# Set key in ~/.claude-mobile/config.json or ANTHROPIC_API_KEY env var
echo '{"apiKey": "sk-ant-..."}' > ~/.claude-mobile/config.json
node cli.js /path/to/your/project
```

## On iPad (via a-Shell)

```bash
# Clone the repo
git clone https://github.com/M8seven/claude-mobile.git
cd claude-mobile
npm install

# Run
export ANTHROPIC_API_KEY=sk-ant-...
node web.js
```

Then open `http://localhost:3000` in Safari.

## Architecture

```
iPad (a-Shell)                        Anthropic API
+---------------------+              +---------------+
|  web.js             |              |  Claude API   |
|  - HTTP server      |  ← SSE →    |  (streaming)  |
|  - API proxy        |              +---------------+
|  - Tool execution   |
|  - File I/O, Git    |
+---------+-----------+
          |
  localhost:3000
          |
+---------+-----------+
|  Browser (Safari)   |
|  - Chat UI          |
|  - Markdown render  |
|  - Tool call display|
+---------+-----------+
```

## We Need Help

We've hit iPad platform limitations that prevent a seamless single-app experience. We're looking for collaborators — iOS developers, WebAssembly experts, anyone who's pushed iPad to its limits.

**Read the full story:** [Issue #1 — We Built Claude Code for iPad](https://github.com/M8seven/claude-mobile/issues/1)

## Author

[@M8seven](https://github.com/M8seven)

## License

MIT
