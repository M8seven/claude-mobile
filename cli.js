#!/usr/bin/env node

const readline = require('readline');
const path = require('path');
const { Agent } = require('./src/agent');
const { loadConfig } = require('./src/config');

async function main() {
  const config = loadConfig();

  if (!config.apiKey) {
    console.error('\x1b[31mNo API key found.\x1b[0m');
    console.error('Set ANTHROPIC_API_KEY env var or create ~/.claude-mobile/config.json:');
    console.error('  { "apiKey": "sk-ant-..." }');
    process.exit(1);
  }

  // First non-flag arg is the working directory
  const cwd = process.argv.find((a, i) => i >= 2 && !a.startsWith('-')) || process.cwd();
  const resolvedCwd = path.resolve(cwd);

  const agent = new Agent(config, resolvedCwd);

  console.log(`\x1b[1;36mclaude-mobile\x1b[0m \x1b[38;5;245mv0.1.0\x1b[0m`);
  console.log(`\x1b[38;5;245m${resolvedCwd}\x1b[0m`);
  console.log(`\x1b[38;5;245m${config.model} · /clear /usage /exit\x1b[0m\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\x1b[1;35m>\x1b[0m ',
  });

  let inputBuffer = '';
  let multiline = false;

  rl.prompt();

  rl.on('line', async (line) => {
    // Multiline input: end with empty line
    if (multiline) {
      if (line === '') {
        multiline = false;
        const input = inputBuffer.trim();
        inputBuffer = '';
        if (input) await processInput(agent, rl, input);
        else rl.prompt();
      } else {
        inputBuffer += line + '\n';
        process.stdout.write('\x1b[38;5;245m..\x1b[0m ');
      }
      return;
    }

    const input = line.trim();

    if (!input) { rl.prompt(); return; }

    // Commands
    if (input === '/exit' || input === '/quit' || input === '/q') {
      console.log('Bye.');
      process.exit(0);
    }

    if (input === '/clear' || input === '/c') {
      agent.clearHistory();
      rl.prompt();
      return;
    }

    if (input === '/usage' || input === '/u') {
      const usage = agent.api.getUsage();
      console.log(`Input: ${usage.input} tokens`);
      console.log(`Output: ${usage.output} tokens`);
      rl.prompt();
      return;
    }

    if (input === '/multi' || input === '/m') {
      multiline = true;
      inputBuffer = '';
      console.log('\x1b[38;5;245mMultiline mode. Empty line to send.\x1b[0m');
      process.stdout.write('\x1b[38;5;245m..\x1b[0m ');
      return;
    }

    if (input === '/help' || input === '/h') {
      console.log(`Commands:
  /clear, /c   Clear conversation history
  /multi, /m   Multiline input mode
  /usage, /u   Show token usage
  /exit, /q    Quit`);
      rl.prompt();
      return;
    }

    await processInput(agent, rl, input);
  });

  rl.on('close', () => {
    console.log('\nBye.');
    process.exit(0);
  });
}

async function processInput(agent, rl, input) {
  try {
    rl.pause();
    await agent.run(input);
    console.log('');
    rl.resume();
    rl.prompt();
  } catch (err) {
    console.error(`\n\x1b[31mError: ${err.message}\x1b[0m\n`);
    rl.resume();
    rl.prompt();
  }
}

main().catch((err) => {
  console.error(`\x1b[31mFatal: ${err.message}\x1b[0m`);
  process.exit(1);
});
