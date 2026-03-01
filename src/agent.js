const { AnthropicAPI } = require('./api');
const { toolDefinitions, executeTool } = require('./tools');
const os = require('os');
const path = require('path');

const SYSTEM_PROMPT = `You are Claude, an AI coding assistant running via claude-mobile.
You help users with software engineering tasks: writing, debugging, refactoring, and exploring code.

# Tools
- Use Read/Write/Edit for file operations (preferred over Bash cat/echo)
- Use Glob to find files by pattern
- Use Grep to search file contents
- Use Bash for shell commands
- Use Git for git operations (status, add, commit, push, pull, log, diff, branch, checkout)

# Bash environment
The Bash tool uses a three-tier fallback:
1. Native shell (Mac/Linux) — full shell support
2. Remote relay server (if configured via RELAY_URL) — executes commands on a connected Mac
3. JS polyfill (iPad offline) — supports: ls, cat, head, tail, mkdir, rm, cp, mv, touch, pwd, echo, wc, sort, uniq, grep, sed, find, tree, env, export, date, stat, du, basename, dirname, xargs, test
Piping (cmd1 | cmd2) and chaining (cmd1 && cmd2) are supported.
Output redirection (> and >>) is supported.

# Git tool
Use the Git tool for version control. Subcommands: status, add, commit, push, pull, log, diff, branch, checkout.
Examples:
- Git status: { subcommand: "status" }
- Git add all: { subcommand: "add", args: { filepath: "." } }
- Git commit: { subcommand: "commit", args: { message: "feat: add feature" } }
- Git push: { subcommand: "push", args: { remote: "origin", branch: "main" } }
- Git log: { subcommand: "log", args: { depth: 10 } }
- Git branch: { subcommand: "branch" } or { subcommand: "branch", args: { create: "feature-x" } }
- Git checkout: { subcommand: "checkout", args: { branch: "main" } }

# Guidelines
- Read files before editing
- Make minimal, focused changes
- Use Glob and Grep to explore before making changes
- Be concise`;

class Agent {
  constructor(config, cwd) {
    this.api = new AnthropicAPI(config.apiKey, config.model, config.maxTokens);
    this.cwd = path.resolve(cwd);
    this.messages = [];
  }

  clearHistory() {
    this.messages = [];
    console.log('\x1b[2mHistory cleared.\x1b[0m');
  }

  getSystemPrompt() {
    return SYSTEM_PROMPT + `\n\n# Environment\n- Platform: ${os.platform()} ${os.arch()}\n- Working directory: ${this.cwd}\n- Date: ${new Date().toISOString().slice(0, 10)}`;
  }

  async run(userInput) {
    this.messages.push({ role: 'user', content: userInput });

    let iterations = 0;
    const MAX_ITERATIONS = 50;

    while (iterations++ < MAX_ITERATIONS) {
      const contentBlocks = [];
      let currentBlockIndex = -1;
      let textBuffer = '';
      let inputJsonBuffer = '';
      let currentBlockType = null;
      let currentBlockId = null;
      let currentBlockName = null;
      let stopReason = null;
      let hasOutput = false;

      try {
        for await (const event of this.api.stream(
          this.messages,
          this.getSystemPrompt(),
          toolDefinitions
        )) {
          switch (event.type) {
            case 'content_block_start':
              currentBlockIndex = event.index;
              if (event.content_block.type === 'text') {
                currentBlockType = 'text';
                textBuffer = '';
              } else if (event.content_block.type === 'tool_use') {
                currentBlockType = 'tool_use';
                currentBlockId = event.content_block.id;
                currentBlockName = event.content_block.name;
                inputJsonBuffer = '';
              }
              break;

            case 'content_block_delta':
              if (event.delta.type === 'text_delta') {
                textBuffer += event.delta.text;
                process.stdout.write(event.delta.text);
                hasOutput = true;
              } else if (event.delta.type === 'input_json_delta') {
                inputJsonBuffer += event.delta.partial_json;
              }
              break;

            case 'content_block_stop':
              if (currentBlockType === 'text') {
                contentBlocks.push({ type: 'text', text: textBuffer });
              } else if (currentBlockType === 'tool_use') {
                let parsedInput = {};
                try { parsedInput = JSON.parse(inputJsonBuffer); } catch (e) {}
                contentBlocks.push({
                  type: 'tool_use',
                  id: currentBlockId,
                  name: currentBlockName,
                  input: parsedInput,
                });
              }
              currentBlockType = null;
              break;

            case 'message_delta':
              if (event.delta && event.delta.stop_reason) {
                stopReason = event.delta.stop_reason;
              }
              break;
          }
        }
      } catch (err) {
        if (hasOutput) process.stdout.write('\n');
        throw err;
      }

      // Save assistant message
      this.messages.push({ role: 'assistant', content: contentBlocks });

      // If no tool calls, we're done
      if (stopReason !== 'tool_use') {
        if (hasOutput) process.stdout.write('\n');
        break;
      }

      // Execute tool calls
      const toolCalls = contentBlocks.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const call of toolCalls) {
        // Print tool invocation
        const label = formatToolLabel(call);
        process.stdout.write(`\n\x1b[38;5;245m ─ \x1b[33m${call.name}\x1b[38;5;245m ${label}\x1b[0m`);

        const startTime = Date.now();
        const result = await executeTool(call.name, call.input, this.cwd);
        const elapsed = Date.now() - startTime;

        // Show timing for slow operations
        if (elapsed > 500) {
          process.stdout.write(`\x1b[38;5;245m (${(elapsed / 1000).toFixed(1)}s)\x1b[0m`);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      process.stdout.write('\n\n');

      // Add tool results and continue the loop
      this.messages.push({ role: 'user', content: toolResults });
    }

    // Show usage
    const usage = this.api.getUsage();
    process.stdout.write(`\x1b[38;5;245m[tokens: ${formatNum(usage.input)}in / ${formatNum(usage.output)}out]\x1b[0m\n`);
  }
}

function formatToolLabel(call) {
  switch (call.name) {
    case 'Read': return call.input.file_path || '';
    case 'Write': return call.input.file_path || '';
    case 'Edit': return call.input.file_path || '';
    case 'Glob': return call.input.pattern || '';
    case 'Grep': return `/${call.input.pattern}/${call.input.glob ? ' ' + call.input.glob : ''}`;
    case 'Bash': return truncate(call.input.command || '', 60);
    case 'Git': {
      const a = call.input.args || {};
      const detail = a.message || a.filepath || a.branch || a.create || a.remote || '';
      return `${call.input.subcommand || ''}${detail ? ' ' + detail : ''}`;
    }
    default: return '';
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function formatNum(n) {
  if (n > 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n > 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

module.exports = { Agent };
