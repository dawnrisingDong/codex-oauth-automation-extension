const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map(marker => source.indexOf(marker))
    .find(index => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end++) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

const bundle = [
  extractFunction('parseUrlSafely'),
  extractFunction('closeStep8LoopbackCallbackTabs'),
].join('\n');

const api = new Function(`
const closeCalls = [];

async function closeLocalhostCallbackTabs(url) {
  closeCalls.push(url);
  return 1;
}

${bundle}

return {
  closeStep8LoopbackCallbackTabs,
  closeCalls,
};
`)();

(async () => {
  const loopbackUrl = 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz';
  const localhostUrl = 'http://localhost:8317/codex/callback?code=abc&state=xyz';

  const closedLoopback = await api.closeStep8LoopbackCallbackTabs(loopbackUrl);
  assert.strictEqual(closedLoopback, 1, '127.0.0.1 回调页应触发清理');
  assert.deepStrictEqual(api.closeCalls, [loopbackUrl], '应按原始 127.0.0.1 URL 清理');

  const closedLocalhost = await api.closeStep8LoopbackCallbackTabs(localhostUrl);
  assert.strictEqual(closedLocalhost, 0, 'localhost 回调页应保留，不应触发清理');
  assert.deepStrictEqual(api.closeCalls, [loopbackUrl], 'localhost 不应增加清理调用');

  console.log('step8 loopback tab cleanup tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
