const fs = require('fs');
const path = require('path');
const os = require('os');

function loadConfig() {
  // Try config file
  const configPaths = [
    path.join(os.homedir(), '.claude-mobile', 'config.json'),
    path.join(os.homedir(), '.claude-mobile.json'),
  ];

  let fileConfig = {};
  for (const p of configPaths) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(p, 'utf-8'));
      break;
    } catch (e) {}
  }

  return {
    apiKey: process.env.ANTHROPIC_API_KEY || fileConfig.apiKey || '',
    model: process.env.CLAUDE_MODEL || fileConfig.model || 'claude-sonnet-4-6',
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || fileConfig.maxTokens || '16384'),
    relayUrl: process.env.RELAY_URL || fileConfig.relayUrl || null,
    relayToken: process.env.RELAY_TOKEN || fileConfig.relayToken || '',
    githubToken: process.env.GITHUB_TOKEN || fileConfig.githubToken || '',
  };
}

module.exports = { loadConfig };
