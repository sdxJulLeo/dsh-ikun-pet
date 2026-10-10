/**
 * IKUN 桌宠 Client 半渲染自检。
 *
 * 不装浏览器：用一套最小 React 运行时 + 假 DOM 真正执行 `lib/client.js`，
 * 把 Host 端每个 mode 渲染一遍，断言**同一张立绘**上跑的是不同动作、
 * 不同特效、不同滤镜与不同气泡，外加完成音行为。
 *
 * 运行：node test/client-render.test.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInThisContext } from 'node:vm';

const ROOT = new URL('../', import.meta.url);
const PACKAGE_NAME = 'dsh-ikun-pet';
const PET_URL = '/ikun-pet/pet.webp';

/** 每个 mode 期望的动作、特效种类与滤镜。 */
const EXPECTED = {
  idle: { motion: 'pet-breathe', fx: [], filter: '' },
  review: { motion: 'pet-think', fx: ['dot', 'dot', 'dot'], filter: '' },
  working: { motion: 'pet-dribble', fx: ['sweat', 'sweat'], filter: 'saturate(1.06)' },
  waiting: { motion: 'pet-peek', fx: ['mark'], filter: '' },
  failed: { motion: 'pet-droop', fx: ['sweat', 'sweat'], filter: 'saturate(0.45)' },
  celebrating: { motion: 'pet-cheer', fx: ['confetti', 'confetti', 'confetti', 'confetti', 'confetti', 'confetti'], filter: 'saturate(1.18)' },
  sleeping: { motion: 'pet-sleep', fx: ['zzz', 'zzz', 'zzz'], filter: 'saturate(0.8)' },
};

const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(['PASS', label]);
  } catch (error) {
    results.push(['FAIL', `${label} — ${error.message}`]);
  }
};

// --------------------------------------------------------------- 假 DOM
const styleTags = [];
const createFakeElement = (tagName) => {
  const element = {
    tagName,
    dataset: {},
    attributes: {},
    textContent: '',
    setAttribute(name, value) {
      element.attributes[name] = value;
    },
    getAttribute(name) {
      return element.attributes[name];
    },
    remove() {
      const index = styleTags.indexOf(element);
      if (index >= 0) styleTags.splice(index, 1);
    },
  };
  return element;
};
const fakeDocument = {
  head: {
    appendChild(tag) {
      styleTags.push(tag);
      return tag;
    },
  },
  createElement: createFakeElement,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
};

const playedAudio = [];
class FakeAudio {
  constructor() {
    this.src = '';
    this.volume = 1;
    this.muted = false;
    this.currentTime = 0;
    this.preload = 'none';
  }
  play() {
    playedAudio.push(this);
    return Promise.resolve();
  }
  pause() {}
}

const claimed = [];
let hostState = null;
const fakeFetch = async (url, init) => {
  const target = String(url);
  if (target.endsWith('/ikun-pet/state')) {
    return { ok: true, status: 200, json: async () => hostState };
  }
  if (target.endsWith('/ikun-pet/claim')) {
    const seq = JSON.parse(init.body).seq;
    claimed.push(seq);
    return { ok: true, status: 200, json: async () => ({ play: true, seq }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

/** 构造一份 Host 半真实会返回的状态快照。 */
const makeState = (mode, overrides = {}) => ({
  mode,
  seq: 1,
  celebrateSeq: 0,
  errorSeq: 0,
  assetBase: '/ikun-pet/',
  pet: PET_URL,
  voice: '/ikun-pet/voice.mp3',
  ready: true,
  missing: [],
  debug: {},
  ...overrides,
});

const localStorageData = new Map();
const fakeLocalStorage = {
  getItem: (key) => (localStorageData.has(key) ? localStorageData.get(key) : null),
  setItem: (key, value) => localStorageData.set(key, String(value)),
};

// --------------------------------------------------------------- 最小 React
function createReactRuntime() {
  let instance = { hooks: [], cursor: 0, dirty: false };
  let pendingEffects = [];

  const reset = () => {
    instance = { hooks: [], cursor: 0, dirty: false };
    pendingEffects = [];
  };
  const slot = (index, create) => {
    if (instance.hooks[index] === undefined) instance.hooks[index] = create();
    return instance.hooks[index];
  };

  const React = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) };
      if (children.length === 1) merged.children = children[0];
      else if (children.length > 1) merged.children = children;
      if (typeof type === 'function') return type(merged);
      return { type, props: merged };
    },
    useState(initial) {
      const index = instance.cursor++;
      const hook = slot(index, () => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [hook.value, (next) => {
        const value = typeof next === 'function' ? next(hook.value) : next;
        if (Object.is(value, hook.value)) return;
        hook.value = value;
        instance.dirty = true;
      }];
    },
    useRef(initial) {
      const index = instance.cursor++;
      return slot(index, () => ({ current: initial }));
    },
    useEffect(effect, deps) {
      const index = instance.cursor++;
      const hook = slot(index, () => ({ deps: undefined, cleanup: undefined }));
      const changed = hook.deps === undefined || deps === undefined
        || deps.length !== hook.deps.length
        || deps.some((value, i) => !Object.is(value, hook.deps[i]));
      if (!changed) return;
      if (typeof hook.cleanup === 'function') pendingEffects.push(hook.cleanup);
      hook.deps = deps;
      hook.cleanup = undefined;
      pendingEffects.push(() => {
        hook.cleanup = effect();
      });
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };

  /** 渲染到稳定：跑新 effect、让 Promise 结算、必要时重渲染。 */
  const flush = async (render) => {
    let tree = null;
    for (let round = 0; round < 60; round += 1) {
      instance.dirty = false;
      instance.cursor = 0;
      tree = render();
      const queue = pendingEffects;
      pendingEffects = [];
      for (const run of queue) run();
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!instance.dirty) return tree;
    }
    throw new Error('渲染未在 60 轮内稳定');
  };

  return { React, flush, reset };
}

// --------------------------------------------------------------- 环境装配
const clientSource = await readFile(new URL('lib/client.js', ROOT), 'utf8');

let registered = null;
const runtime = createReactRuntime();
const restore = [];
const installGlobals = () => {
  const globals = {
    window: {
      __ModuleLoader__: { load: (entry) => { registered = entry; } },
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      localStorage: fakeLocalStorage,
      innerWidth: 1440,
      innerHeight: 900,
    },
    document: fakeDocument,
    Audio: FakeAudio,
    fetch: fakeFetch,
  };
  for (const [key, value] of Object.entries(globals)) {
    restore.push([key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
};
const uninstallGlobals = () => {
  for (const [key, descriptor] of restore.reverse()) {
    if (descriptor === undefined) delete globalThis[key];
    else Object.defineProperty(globalThis, key, descriptor);
  }
};

installGlobals();
runInThisContext(clientSource, { filename: 'client.js' });

const moduleExports = registered.factory((specifier) => {
  if (specifier === 'react') return runtime.React;
  throw new Error(`bundle 请求了非平台模块：${specifier}`);
});

// --------------------------------------------------------------- 工具
function findNode(tree, attribute) {
  if (tree === null || typeof tree !== 'object') return null;
  const props = tree.props ?? {};
  if (props[attribute] !== undefined) return tree;
  const children = props.children;
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
  for (const child of list) {
    const hit = findNode(child, attribute);
    if (hit !== null) return hit;
  }
  return null;
}
function findAll(tree, attribute, out = []) {
  if (tree === null || typeof tree !== 'object') return out;
  const props = tree.props ?? {};
  if (props[attribute] !== undefined) out.push(tree);
  const children = props.children;
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
  for (const child of list) findAll(child, attribute, out);
  return out;
}
const textOf = (node) => {
  const children = node?.props?.children;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === 'string').join('');
  return '';
};
const fxKinds = (tree) => findAll(tree, 'data-fx').map((node) => node.props['data-fx']);

/** 用插件自己的 apply() 装配一次桌宠，返回可反复重渲染的驱动函数。 */
async function mountPet() {
  const entries = [];
  const ctx = {
    effect: (fn) => {
      fn();
    },
    slots: {
      inject: (key, callback) => {
        entries.push({ key, disposer: callback() });
      },
      register: (options, component) => {
        entries.push({ options, component });
        return () => {};
      },
    },
  };
  moduleExports.apply(ctx);
  const entry = entries.find((s) => s.options?.name === 'shell.overlay');
  assert.ok(entry !== undefined, 'apply 未注册 shell.overlay');
  // 注意顺序：插件自己的 inject() 也带 pollMs，必须放在前面，否则覆盖不掉。
  const props = { ...entry.options.inject(), pollMs: 30 };
  runtime.reset();
  /** 同一个组件实例重渲染：@param state 新的 Host 快照。 */
  const flush = async (state) => {
    if (state !== undefined) {
      hostState = state;
      // 组件是通过 30ms 轮询拿到快照的，先让它真的取回去再渲染。
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return runtime.flush(() => entry.component(props));
  };
  return { flush };
}

/** 装一次、渲染一次（每次都是全新实例）。 */
async function renderPet(state) {
  const { flush } = await mountPet();
  return flush(state);
}

// --------------------------------------------------------------- 断言
await check('bundle 注册的 factory 产出 apply/inject', () => {
  assert.equal(registered.id, PACKAGE_NAME);
  assert.equal(typeof moduleExports.apply, 'function');
  assert.deepEqual(moduleExports.inject, ['slots']);
});

await check('注入样式只带本插件的归属标记', async () => {
  await renderPet(makeState('idle'));
  assert.ok(styleTags.length >= 1, '未注入样式');
  assert.equal(styleTags[0].dataset.plugin, PACKAGE_NAME);
  assert.ok(styleTags[0].textContent.includes('[data-ikun-pet-root]'));
});

for (const [mode, expected] of Object.entries(EXPECTED)) {
  await check(`mode=${mode} -> 动作 ${expected.motion} + ${expected.fx.length} 个特效`, async () => {
    const tree = await renderPet(makeState(mode));
    const motion = findNode(tree, 'data-ikun-pet-motion');
    assert.ok(String(motion.props.style.animation).includes(expected.motion), `动作是 ${motion.props.style.animation}`);
    assert.deepEqual(fxKinds(tree), expected.fx, `特效是 ${JSON.stringify(fxKinds(tree))}`);
    assert.equal(findNode(tree, 'data-ikun-pet-root').props['data-mode'], mode);
  });
}

await check('每个 mode 都是同一张立绘，只是动作不同', async () => {
  const seen = new Set();
  for (const mode of Object.keys(EXPECTED)) {
    const tree = await renderPet(makeState(mode));
    const art = findNode(tree, 'data-ikun-pet-art');
    assert.equal(art.props.src, PET_URL, `${mode} 换了素材`);
    seen.add(art.props.src);
  }
  assert.equal(seen.size, 1, '立绘不止一张 —— 退回了「换图表示状态」');
});

await check('七种动作互不重复', async () => {
  const motions = new Set(Object.values(EXPECTED).map((e) => e.motion));
  assert.equal(motions.size, 7);
  for (const motion of motions) {
    const tree = await renderPet(makeState('idle'));
    assert.ok(String(findNode(tree, 'data-ikun-pet-motion').props.style.animation).length > 0);
  }
});

await check('情绪滤镜：沮丧去饱和、开心提饱和、困了压暗', async () => {
  for (const [mode, expected] of Object.entries(EXPECTED)) {
    const tree = await renderPet(makeState(mode));
    const filter = String(findNode(tree, 'data-ikun-pet-art').props.style.filter);
    if (expected.filter === '') {
      assert.ok(!filter.includes('saturate(0.4'), `${mode} 不该去饱和：${filter}`);
    } else {
      assert.ok(filter.includes(expected.filter), `${mode} 滤镜是 ${filter}`);
    }
  }
});

await check('地面阴影只给真正离地的动作', async () => {
  const idle = String(findNode(await renderPet(makeState('idle')), 'data-ikun-pet-shadow').props.style.animation);
  assert.equal(idle, 'none');
  for (const [mode, keyframe] of [['working', 'pet-shadow-hop'], ['celebrating', 'pet-shadow-cheer']]) {
    const anim = String(findNode(await renderPet(makeState(mode)), 'data-ikun-pet-shadow').props.style.animation);
    assert.ok(anim.includes(keyframe), `${mode} 阴影是 ${anim}`);
  }
});

await check('气泡文案逐状态可读', async () => {
  const expected = {
    idle: '休息中', review: '想想', working: '搬砖', waiting: '等你', failed: '出错', celebrating: '你干嘛', sleeping: 'Zzz',
  };
  for (const [mode, keyword] of Object.entries(expected)) {
    const tree = await renderPet(makeState(mode));
    const bubble = textOf(findNode(tree, 'data-ikun-pet-bubble'));
    assert.ok(bubble.includes(keyword), `${mode} 气泡是「${bubble}」`);
  }
});

await check('立绘缺失时退回 emoji，而不是破图', async () => {
  const tree = await renderPet(makeState('idle', { pet: null, ready: false, missing: ['pet.webp'] }));
  assert.equal(findNode(tree, 'data-ikun-pet-root').props['data-ready'], 'false');
  assert.equal(findNode(tree, 'data-ikun-pet-art').props.src, undefined);
});

await check('过渡期兼容：宿主还是旧的 artwork 字段时也能显示', async () => {
  // 「插件包已更新、宿主还没重启」的窗口期：旧宿主只给 artwork，不给 pet。
  const legacy = makeState('working');
  delete legacy.pet;
  legacy.artwork = { idle: '/ikun-pet/idle.webp', working: '/ikun-pet/working.webp' };
  const tree = await renderPet(legacy);
  assert.equal(findNode(tree, 'data-ikun-pet-root').props['data-ready'], 'true', '掉了 emoji，过渡期体验断裂');
  assert.equal(findNode(tree, 'data-ikun-pet-art').props.src, '/ikun-pet/idle.webp');
  // 动作仍然按新逻辑走。
  assert.ok(String(findNode(tree, 'data-ikun-pet-motion').props.style.animation).includes('pet-dribble'));
});

await check('完成音：celebrateSeq 递增时认领并播放一次', async () => {
  const before = playedAudio.length;
  await renderPet(makeState('celebrating', { seq: 5, celebrateSeq: 1 }));
  assert.deepEqual(claimed, [1], `认领序列异常：${JSON.stringify(claimed)}`);
  assert.equal(playedAudio.length, before + 1, '未播放完成音');
});

await check('同一个 celebrateSeq 不会重播（同一实例内）', async () => {
  const { flush } = await mountPet();
  const before = playedAudio.length;
  claimed.length = 0;
  await flush(makeState('celebrating', { seq: 5, celebrateSeq: 1 }));
  assert.deepEqual(claimed, [1]);
  assert.equal(playedAudio.length, before + 1);

  // 同一实例、同样的 celebrateSeq，只是快照换了个身份：不该再认领。
  await flush(makeState('celebrating', { seq: 6, celebrateSeq: 1 }));
  assert.deepEqual(claimed, [1], '重复认领了同一个 seq');
  assert.equal(playedAudio.length, before + 1);

  // 下一个完成序号才该再次出声。
  await flush(makeState('celebrating', { seq: 7, celebrateSeq: 2 }));
  assert.deepEqual(claimed, [1, 2]);
  assert.equal(playedAudio.length, before + 2);
});

await check('静音时不认领也不出声', async () => {
  localStorageData.set('dsh-ikun-pet:prefs:v3', JSON.stringify({ muted: true }));
  const before = playedAudio.length;
  claimed.length = 0;
  await renderPet(makeState('celebrating', { seq: 8, celebrateSeq: 3 }));
  assert.deepEqual(claimed, []);
  assert.equal(playedAudio.length, before);
  localStorageData.clear();
});

await check('特效可整体关闭', async () => {
  localStorageData.set('dsh-ikun-pet:prefs:v3', JSON.stringify({ effects: false }));
  const tree = await renderPet(makeState('celebrating'));
  assert.deepEqual(fxKinds(tree), [], '关了特效却还在渲染');
  localStorageData.clear();
});

uninstallGlobals();

let failed = 0;
for (const [status, label] of results) {
  if (status === 'FAIL') failed += 1;
  console.log(`${status === 'PASS' ? '  ok' : 'FAIL'}  ${label}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
