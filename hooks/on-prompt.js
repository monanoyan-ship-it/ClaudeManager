#!/usr/bin/env node
// UserPromptSubmit hook - reads stdin, POSTs to ClaudeManager API, writes stdout
const http = require('http');

const API_URL = 'http://127.0.0.1:41847/api/hooks/prompt';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
    // Timeout safety - if no data within 2s, resolve empty
    setTimeout(() => resolve({}), 2000);
  });
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 4000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.on('timeout', () => { req.destroy(); resolve({}); });
    req.write(postData);
    req.end();
  });
}

async function main() {
  const input = await readStdin();
  const result = await postJSON(API_URL, input);

  // Write result to stdout for Claude Code
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

main().catch(() => process.exit(0));
