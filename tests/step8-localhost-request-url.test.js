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
  extractFunction('isLocalhostOAuthCallbackUrl'),
  extractFunction('normalizeLoopbackHostToLocalhost'),
  extractFunction('getErrorMessage'),
  extractFunction('requestStep8LocalhostCallback'),
].join('\n');

const api = new Function(`
const fetchCalls = [];
let shouldFail = false;

async function fetch(url, options) {
  fetchCalls.push({ url, options });
  if (shouldFail) {
    throw new Error('network down');
  }
  return { ok: true };
}

${bundle}

return {
  normalizeLoopbackHostToLocalhost,
  requestStep8LocalhostCallback,
  fetchCalls,
  setFetchFail(value) {
    shouldFail = Boolean(value);
  },
};
`)();

(async () => {
  const loopbackUrl = 'http://127.0.0.1:8317/codex/callback?code=abc&state=xyz';
  const localhostUrl = 'http://localhost:8317/codex/callback?code=abc&state=xyz';

  assert.strictEqual(
    api.normalizeLoopbackHostToLocalhost(loopbackUrl),
    localhostUrl,
    '127.0.0.1 应被替换为 localhost'
  );
  assert.strictEqual(
    api.normalizeLoopbackHostToLocalhost(localhostUrl),
    localhostUrl,
    'localhost 不应被改写'
  );

  const requestedUrl = await api.requestStep8LocalhostCallback(loopbackUrl);
  assert.strictEqual(requestedUrl, localhostUrl, 'Step 8 请求应使用 localhost 地址');
  assert.strictEqual(api.fetchCalls.length, 1, '应发起一次请求');
  assert.strictEqual(api.fetchCalls[0].url, localhostUrl, 'fetch 目标应为改写后的 localhost URL');
  assert.strictEqual(api.fetchCalls[0].options?.mode, 'no-cors', '应使用 no-cors 方式请求本地回调地址');

  let invalidError = null;
  try {
    await api.requestStep8LocalhostCallback('https://example.com/callback?code=abc&state=xyz');
  } catch (error) {
    invalidError = error;
  }
  assert.ok(invalidError, '无效回调地址应抛错');
  assert.strictEqual(
    invalidError.message,
    '步骤 8：捕获到的 localhost OAuth 回调地址无效，无法继续请求。',
    '无效地址错误信息应明确'
  );

  api.setFetchFail(true);
  let fetchError = null;
  try {
    await api.requestStep8LocalhostCallback(loopbackUrl);
  } catch (error) {
    fetchError = error;
  }
  assert.ok(fetchError, '请求失败时应抛错');
  assert.ok(
    fetchError.message.includes(localhostUrl) && fetchError.message.includes('network down'),
    '请求失败错误应包含 localhost 地址与原始错误'
  );

  console.log('step8 localhost request url tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
