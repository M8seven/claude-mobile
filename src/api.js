const https = require('https');

class AnthropicAPI {
  constructor(apiKey, model, maxTokens) {
    this.apiKey = apiKey;
    this.model = model;
    this.maxTokens = maxTokens;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }

  async *stream(messages, systemPrompt, tools) {
    const body = JSON.stringify({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages,
      tools,
      stream: true,
    });

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      }, resolve);
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (response.statusCode !== 200) {
      const data = await collectBody(response);
      let msg = `API error ${response.statusCode}`;
      try {
        const parsed = JSON.parse(data);
        msg = parsed.error?.message || msg;
      } catch (e) {}
      throw new Error(msg);
    }

    let buffer = '';

    for await (const chunk of response) {
      buffer += chunk.toString();

      // SSE events are separated by double newline
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep incomplete part

      for (const part of parts) {
        if (!part.trim()) continue;

        const lines = part.split('\n');
        let data = null;

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            data = line.slice(6);
          }
        }

        if (!data || data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);

          // Track usage
          if (event.type === 'message_start' && event.message?.usage) {
            this.totalInputTokens += event.message.usage.input_tokens || 0;
          }
          if (event.type === 'message_delta' && event.usage) {
            this.totalOutputTokens += event.usage.output_tokens || 0;
          }

          yield event;
        } catch (e) {}
      }
    }
  }

  getUsage() {
    return {
      input: this.totalInputTokens,
      output: this.totalOutputTokens,
    };
  }
}

function collectBody(response) {
  return new Promise((resolve, reject) => {
    let data = '';
    response.on('data', (chunk) => data += chunk);
    response.on('end', () => resolve(data));
    response.on('error', reject);
  });
}

module.exports = { AnthropicAPI };
