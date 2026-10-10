/**
 * IKUN 桌宠自检：不依赖 DSH 运行时，用手写的假 Cordis ctx 驱动 Host 半。
 *
 * 覆盖三件事：
 *   1. 包契约（package.json / cordis.patch.yml / client bundle 封装）；
 *   2. Host 半的状态机（空闲 → 思考 → 干活 → 完成 → 庆祝/出错）；
 *   3. /ikun-pet/* 路由（状态 JSON、素材字节、完成音认领去重）。
 *
 * 运行：node test/selftest.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFile(new URL(rel, ROOT), 'utf8');

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (error) {
    results.push(['FAIL', `${label} — ${error.message}`]);
  }
};

// ----------------------------------------------------------------- 假 Cordis ctx
function createHarness(plugin, config) {
  const listeners = new Map();
  const disposers = [];
  const warnings = [];
  const logs = [];
  const routes = [];
  const state = { agents: [] };

  const webServer = {
    host: '127.0.0.1',
    port: 0,
    register(route) {
      routes.push(route);
      return () => {
        const index = routes.indexOf(route);
        if (index >= 0) routes.splice(index, 1);
      };
    },
  };

  const services = {
    webServer,
    agents: { list: () => state.agents },
  };

  const ctx = {
    logger: {
      info: (message) => logs.push(String(message)),
      warn: (message) => warnings.push(String(message)),
    },
    get: (name) => services[name],
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
      return () => {};
    },
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return () => {};
    },
    inject(dependencies, callback) {
      callback(ctx);
      return () => {};
    },
  };

  const emit = (name, payload) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  /** 驱动一个 waterfall 监听，返回 next() 的结果。 */
  const waterfall = (name, payload, next = () => Promise.resolve('ok')) => {
    const list = listeners.get(name) ?? [];
    return list.reduceRight(
      (acc, listener) => () => listener(payload, acc),
      next,
    )();
  };

  plugin.apply(ctx, config);

  return { ctx, routes, warnings, logs, state, emit, waterfall, webServer, disposers };
}

// ----------------------------------------------------------------- 启动 HTTP
async function serve(routes) {
  const byPath = new Map(routes.map((r) => [r.path, r]));
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = byPath.get(url.pathname) ?? routes.find((r) => r.kind === 'prefix' && url.pathname.startsWith(r.path));
    if (route === undefined) {
      res.writeHead(404).end();
      return;
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ----------------------------------------------------------------- 开始
const pkg = JSON.parse(await read('package.json'));
const patch = await read('cordis.patch.yml');
const clientSource = await read('lib/client.js');
const hostModule = await import(new URL('lib/index.js', ROOT).href);

await check('package.json: dsh.client.platform 必须是 web', () => {
  assert.equal(pkg.dsh.client.platform, 'web');
});

await check('package.json: exports["./client"] 指向 lib/client.js', () => {
  assert.equal(pkg.exports['./client'], './lib/client.js');
});

await check('package.json: files 覆盖 client bundle、全部立绘与语音', () => {
  for (const entry of ['lib/index.js', 'lib/client.js', 'assets/*.webp', 'assets/voice.mp3', 'cordis.patch.yml']) {
    assert.ok(pkg.files.includes(entry), `files 缺少 ${entry}`);
  }
});

await check('cordis.patch.yml: insert 的 name 与包名一致', () => {
  assert.match(patch, /-\s*insert:/);
  assert.ok(patch.includes(`name: ${pkg.name}`), 'insert 行未使用包名');
});

await check('lib/index.js: 导出 apply 与 name', () => {
  assert.equal(typeof hostModule.apply, 'function');
  assert.equal(hostModule.name, pkg.name);
});

await check('lib/index.js: 不 import 任何 @deepseek-ai/* 运行时依赖', async () => {
  const source = await read('lib/index.js');
  const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  for (const specifier of imports) {
    assert.ok(!specifier.startsWith('@deepseek-ai/'), `越界依赖：${specifier}`);
  }
});

await check('lib/client.js: ModuleLoader banner/footer 与 id 正确', () => {
  const head = clientSource.slice(0, clientSource.indexOf('\n'));
  assert.equal(head, 'window.__ModuleLoader__.load({');
  assert.ok(clientSource.includes(`id: "${pkg.name}"`), 'bundle id 与包名不一致');
  assert.ok(/return module\.exports;\s*\}\s*\}\);\s*$/.test(clientSource), 'bundle footer 缺失');
  assert.ok(/exports\.apply = apply;/.test(clientSource), '未导出 apply');
  assert.ok(/exports\.inject = inject;/.test(clientSource), '未导出 inject');
});

await check('lib/client.js: 只 require 平台种子模块', () => {
  const requireCalls = [...clientSource.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  const platform = new Set([
    'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
    '@deepseek-ai/dsh-client-schema-form', '@deepseek-ai/dsh-client-runtime/client',
  ]);
  for (const specifier of requireCalls) {
    assert.ok(platform.has(specifier), `非平台模块 require：${specifier}`);
  }
});

await check('lib/client.js: 可被解析（语法）', async () => {
  const require = createRequire(import.meta.url);
  void require;
  // 在受控的假 window 下真正执行一次 bundle，确保 factory 可注册。
  let registered = null;
  const previousWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: { load: (entry) => { registered = entry; } },
  };
  try {
    const { runInThisContext } = await import('node:vm');
    runInThisContext(clientSource, { filename: 'client.js' });
  } finally {
    globalThis.window = previousWindow;
  }
  assert.ok(registered !== null, 'bundle 未调用 __ModuleLoader__.load');
  assert.equal(registered.id, pkg.name);
  assert.equal(typeof registered.factory, 'function');
});

// ----------------------------------------------------------------- 状态机
const harness = createHarness(hostModule);
const { server, base } = await serve(harness.routes);
const getState = async () => (await fetch(`${base}/ikun-pet/state`)).json();

await check('四条精确路由都已注册到 /ikun-pet/*', () => {
  const paths = harness.routes.map((r) => r.path).sort();
  assert.deepEqual(paths, [
    '/ikun-pet/claim',
    '/ikun-pet/pet.webp',
    '/ikun-pet/state',
    '/ikun-pet/voice.mp3',
  ]);
  for (const route of harness.routes) assert.equal(route.kind, 'exact');
});

// 复刻 dsh-host-webserver 的 match()：前缀匹配要求 `pathname.startsWith(prefix + '/')`，
// 因此带尾斜杠的前缀永远匹配不上自己下面的路径。这条断言把那个坑钉住。
await check('路由按 dsh-host-webserver 的真实匹配语义可命中', () => {
  const match = (pathname) => {
    const exact = new Map(harness.routes.filter((r) => r.kind === 'exact').map((r) => [r.path, r]));
    const prefixes = new Map(harness.routes.filter((r) => r.kind === 'prefix').map((r) => [r.path, r]));
    const hit = exact.get(pathname);
    if (hit !== undefined) return hit;
    let best;
    for (const [prefix, route] of prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
      if (best === undefined || prefix.length > best.path.length) best = route;
    }
    return best;
  };
  for (const route of harness.routes) {
    assert.ok(match(route.path) !== undefined, `${route.path} 无法被 webserver 匹配到`);
  }
  // 反证：带尾斜杠的前缀在真实语义下匹配不到 `/ikun-pet/state`。
  const trailing = '/ikun-pet/';
  assert.ok('/ikun-pet/state' !== trailing && !'/ikun-pet/state'.startsWith(`${trailing}/`));
});

await check('初始状态是 idle，且只暴露一张立绘', async () => {
  await sleep(80); // 素材预热是异步的，等它跑完再看
  const state = await getState();
  assert.equal(state.mode, 'idle');
  assert.equal(state.celebrateSeq, 0);
  assert.equal(state.pet, '/ikun-pet/pet.webp', '应当只有一张立绘');
  assert.equal(state.voice, '/ikun-pet/voice.mp3');
  assert.equal(state.ready, true);
  assert.deepEqual(state.missing, []);
});

// 回归：`ready` 曾经写成「缓存里有没有全部素材」，而缓存只在被请求时才填充，
// 客户端又要等 ready 才去请求图片——两边互等，桌宠永远停在 emoji。
// 这条断言在一个**从没被请求过任何素材**的冷实例上检查 ready，把自锁钉死。
await check('冷启动即为 ready（不依赖任何人先请求素材）', async () => {
  const cold = createHarness(hostModule);
  assert.ok(cold.routes.length > 0, '路由未注册');
  const { server: coldServer, base: coldBase } = await serve(cold.routes);
  try {
    await sleep(80); // 等启动时的素材预热跑完
    const state = await (await fetch(`${coldBase}/ikun-pet/state`)).json();
    assert.equal(state.ready, true, '冷启动 ready 不为 true —— 自锁回来了');
    assert.equal(state.pet, '/ikun-pet/pet.webp');
    assert.deepEqual(state.missing, [], '冷启动就缺素材');
    assert.equal(state.voice, '/ikun-pet/voice.mp3');
    assert.equal(state.debug.cachedAssets, 2, `预热只缓存了 ${state.debug.cachedAssets} 个文件`);
  } finally {
    coldServer.close();
  }
});

await check('立绘缺失时 ready=false、missing 记账、pet=null', async () => {
  // 真的做一份「故意漏掉立绘」的副本再 import：ASSET_DIR 由 import.meta.url 推导，
  // 所以副本会去自己的 assets/ 找图，这是对降级路径最诚实的验法。
  const { mkdir, copyFile, readdir, rm } = await import('node:fs/promises');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const sandboxPath = path.join(ROOT.pathname.replace(/^\//, ''), 'test', '.tmp-crippled');
  await rm(sandboxPath, { recursive: true, force: true });
  await mkdir(path.join(sandboxPath, 'lib'), { recursive: true });
  await mkdir(path.join(sandboxPath, 'assets'), { recursive: true });
  await copyFile(new URL('lib/index.js', ROOT), path.join(sandboxPath, 'lib', 'index.js'));
  for (const name of await readdir(new URL('assets/', ROOT))) {
    if (name === 'pet.webp') continue; // 故意漏掉立绘，只留语音
    await copyFile(new URL(`assets/${name}`, ROOT), path.join(sandboxPath, 'assets', name));
  }

  const crippled = await import(pathToFileURL(path.join(sandboxPath, 'lib', 'index.js')).href);
  const cripple = createHarness(crippled);
  const { server: crippleServer, base: crippleBase } = await serve(cripple.routes);
  try {
    await sleep(80);
    const state = await (await fetch(`${crippleBase}/ikun-pet/state`)).json();
    assert.equal(state.pet, null, '立绘没读出来却仍给出 URL');
    assert.equal(state.ready, false);
    assert.deepEqual(state.missing, ['pet.webp']);
    assert.equal(state.voice, '/ikun-pet/voice.mp3', '语音还在就不该被一起拖下水');
  } finally {
    crippleServer.close();
    await rm(sandboxPath, { recursive: true, force: true });
  }
});

await check('立绘路由返回真实 WebP 字节', async () => {
  const state = await getState();
  const res = await fetch(base + state.pet);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.ok(bytes.length > 20000, '立绘过小');
});

await check('语音路由返回真实 mp3 字节', async () => {
  const voice = await fetch(`${base}/ikun-pet/voice.mp3`);
  assert.equal(voice.status, 200);
  assert.equal(voice.headers.get('content-type'), 'audio/mpeg');
  const voiceBytes = Buffer.from(await voice.arrayBuffer());
  assert.ok(voiceBytes.length > 20000, '语音文件过小');
  assert.ok(
    voiceBytes.subarray(0, 3).toString('ascii') === 'ID3' || (voiceBytes[0] === 0xff && (voiceBytes[1] & 0xe0) === 0xe0),
    '既不是 ID3 也不是 MPEG 帧同步',
  );
});

await check('白名单外的素材名返回 404', async () => {
  const res = await fetch(`${base}/ikun-pet/../package.json`);
  assert.ok(res.status === 404 || res.status === 403, `期望 404/403，实际 ${res.status}`);
});

await check('跨站 Origin 被拒绝', async () => {
  const res = await fetch(`${base}/ikun-pet/state`, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

await check('Agent 运行中 -> review（思考）', async () => {
  const agent = { status: 'idle' };
  harness.state.agents.push(agent);
  harness.emit('agent/status', { agent, status: 'running' });
  await sleep(20);
  harness.emit('agent/status', { agent, status: 'running' });
  harness.emit('agent/status', { agent, status: 'running' });
  harness.emit('agent/status', { agent, status: 'running' });
  const state = await getState();
  assert.equal(state.mode, 'review');
});

await check('工具执行中 -> working', async () => {
  let release = null;
  const running = harness.waterfall('tools/execute', { name: 'read' }, () => new Promise((resolve) => { release = resolve; }));
  const state = await getState();
  assert.equal(state.mode, 'working');
  release('done');
  await running;
});

await check('Agent 全部停下 -> celebrating 且 celebrateSeq 递增', async () => {
  const before = await getState();
  harness.emit('agent/status', { agent: harness.state.agents[0], status: 'idle' });
  await sleep(20);
  const after = await getState();
  assert.equal(after.mode, 'celebrating');
  assert.equal(after.celebrateSeq, before.celebrateSeq + 1);
});

await check('完成音认领只成功一次（多窗口去重）', async () => {
  const { celebrateSeq } = await getState();
  const post = (seq) => fetch(`${base}/ikun-pet/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seq }),
  }).then((res) => res.json());
  assert.deepEqual(await post(celebrateSeq), { play: true, seq: celebrateSeq });
  assert.deepEqual(await post(celebrateSeq), { play: false, seq: celebrateSeq });
  assert.deepEqual(await post(celebrateSeq - 1), { play: false, seq: celebrateSeq - 1 });
});

await check('出错 -> failed，且不再补庆祝', async () => {
  const agent = harness.state.agents[0];
  harness.emit('agent/status', { agent, status: 'running' });
  harness.emit('agent/error', { agent, turn: 1, step: 0, error: new Error('boom') });
  await sleep(20);
  assert.equal((await getState()).mode, 'failed');
  const beforeCelebrate = (await getState()).celebrateSeq;
  harness.emit('agent/status', { agent, status: 'idle' });
  await sleep(20);
  const state = await getState();
  assert.equal(state.mode, 'failed');
  assert.equal(state.celebrateSeq, beforeCelebrate);
});

// failed 窗口（2800ms）是全局的，等它过期再验后面的模式，否则测的是它的优先级。
await check('failed 窗口过期后回落到 idle', async () => {
  await sleep(3200);
  assert.equal((await getState()).mode, 'idle');
});

let releaseApproval = null;
await check('审批等待 -> waiting', async () => {
  harness.emit('agent/status', { agent: harness.state.agents[0], status: 'running' });
  const pending = harness.waterfall('approval/request', { agent: harness.state.agents[0] }, () => new Promise((resolve) => { releaseApproval = resolve; }));
  void pending;
  await sleep(20);
  assert.equal((await getState()).mode, 'waiting');
});

await check('审批结束后离开 waiting', async () => {
  releaseApproval('approved');
  await sleep(30);
  assert.notEqual((await getState()).mode, 'waiting');
});

await check('轮询兜底：Agent 状态未经事件也能被发现', async () => {
  harness.emit('agent/status', { agent: harness.state.agents[0], status: 'idle' });
  await sleep(5600); // 等庆祝窗口过期
  assert.equal((await getState()).mode, 'idle');

  // 只改底层状态、不发任何事件：只有轮询能发现它。
  harness.state.agents[0].status = 'running';
  await sleep(800);
  assert.equal((await getState()).mode, 'review');

  // 再只改底层状态回到 idle：轮询本身应当触发一次「完成」。
  const before = await getState();
  harness.state.agents[0].status = 'idle';
  await sleep(800);
  const after = await getState();
  assert.equal(after.mode, 'celebrating');
  assert.equal(after.celebrateSeq, before.celebrateSeq + 1);
});

await check('状态快照包含 debug 诊断字段', async () => {
  const state = await getState();
  assert.equal(typeof state.debug.runningCount, 'number');
  assert.equal(typeof state.debug.toolsInFlight, 'number');
  assert.equal(typeof state.debug.idleMs, 'number');
  assert.equal(typeof state.ready, 'boolean');
  assert.ok(state.debug.celebrateCount >= 1);
  assert.ok(state.debug.errorCount >= 1);
});

server.close();

// 打瞌睡是「空闲够久」触发的，用一份 sleepAfterMs 很短的实例单独验，免得拖慢上面。
await check('空闲够久 -> sleeping，且一有动静立刻醒', async () => {
  const sleeper = createHarness(hostModule, { sleepAfterMs: 400 });
  const { server: sleeperServer, base: sleeperBase } = await serve(sleeper.routes);
  const read = async () => (await fetch(`${sleeperBase}/ikun-pet/state`)).json();
  try {
    assert.equal((await read()).mode, 'idle');
    await sleep(900);
    assert.equal((await read()).mode, 'sleeping');

    const agent = { status: 'idle' };
    sleeper.state.agents.push(agent);
    sleeper.emit('agent/status', { agent, status: 'running' });
    await sleep(30);
    assert.equal((await read()).mode, 'review');
  } finally {
    sleeperServer.close();
  }
});

// ----------------------------------------------------------------- 汇总
let failed = 0;
for (const [status, label] of results) {
  if (status === 'FAIL') failed += 1;
  console.log(`${status === 'PASS' ? '  ok' : 'FAIL'}  ${label}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (harness.warnings.length > 0) console.log('warnings:', harness.warnings);
process.exit(failed === 0 ? 0 : 1);
