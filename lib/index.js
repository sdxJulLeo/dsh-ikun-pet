/**
 * IKUN 桌宠 · Host 半。
 *
 * 职责只有两件事：
 *   1. 把包内的素材（8×9 精灵图 + 「你干嘛~」语音）通过 `webServer` 提供给浏览器；
 *   2. 把宿主进程里真实发生的 Agent 活动折叠成一个 `mode`，供浏览器半轮询。
 *
 * 状态来源分两层：事件层（最灵敏）与轮询层（最可靠）。二者都写进同一个
 * 幂等的 `setStatus`，因此任一层缺失都不会让桌宠卡在错误动作上。
 *
 * 本文件刻意不 import 任何 `@deepseek-ai/*` 运行时依赖：插件装在 profile 的
 * node_modules 下，这些包不一定能解析到，只用 Node 内建模块才不会有加载风险。
 */
import { readFile } from 'node:fs/promises';

/** 本插件在 `__ModuleLoader__.load({ id })` 与 Loader row 中使用的身份。 */
export const name = 'dsh-ikun-pet';

/** 素材与状态路由的公共前缀（不含尾斜杠，前缀匹配语义因实现而异）。 */
const ROUTE_PREFIX = '/ikun-pet';
/** 交给浏览器的素材基址，始终以 `/` 结尾以便直接拼接文件名。 */
const ASSET_BASE = `${ROUTE_PREFIX}/`;
/**
 * 桌宠只有**一张**立绘：所有状态差异都由客户端用动作、特效和气泡表达，
 * 宿主不再按状态分发图片。因此这里只有素材名，没有状态维度。
 */
const PET_ART = 'pet.webp';
const VOICE = 'voice.mp3';

/** 素材目录锚定在包根，随包一起分发，不依赖任何用户绝对路径。 */
const ASSET_DIR = new URL('../assets/', import.meta.url);

/** 白名单：请求名 -> Content-Type。任何白名单外的名字一律 404。 */
const ASSETS = new Map([
  [PET_ART, 'image/webp'],
  [VOICE, 'audio/mpeg'],
]);

/** 逐条注册的精确路由，避免前缀匹配语义带来的歧义。 */
const ROUTES = [
  `${ROUTE_PREFIX}/state`,
  `${ROUTE_PREFIX}/claim`,
  ...[...ASSETS.keys()].map((file) => `${ROUTE_PREFIX}/${file}`),
];

const DEFAULTS = {
  /** 宿主侧 Agent 状态轮询间隔（毫秒）。 */
  pollMs: 500,
  /** 任务完成后庆祝动作的持续时长（毫秒）。 */
  celebrateMs: 5200,
  /** 出错动作的持续时长（毫秒）。 */
  failedMs: 2800,
  /** 最后一次工具活动之后仍视为「干活中」的时长（毫秒）。 */
  recentToolMs: 2500,
  /** 彻底没事干多久之后，桌宠开始打瞌睡（毫秒）。 */
  sleepAfterMs: 75000,
  /** 过期清扫间隔（毫秒）。 */
  sweepMs: 400,
};

/**
 * 同源判定：浏览器同源 GET 通常不带 `Origin`，带了一般是跨站。
 * 只接受「没有 Origin」或「Origin 的 host 与 Host 头一致」的请求。
 */
function isTrusted(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** 读取至多 `limit` 字节的请求体，用于 `POST /ikun-pet/claim`。 */
async function readJsonBody(req, limit = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS };
  if (config !== null && typeof config === 'object') {
    for (const key of Object.keys(DEFAULTS)) {
      const value = config[key];
      if (typeof value === 'number' && Number.isFinite(value)) cfg[key] = value;
    }
  }

  // ---------------------------------------------------------------- 素材缓存
  /** @type {Map<string, Buffer>} */
  const cache = new Map();
  /** @type {Set<string>} 读不出来的素材名，用于把「为什么桌宠不显示」讲清楚。 */
  const missing = new Set();
  const loadAsset = async (file) => {
    const hit = cache.get(file);
    if (hit !== undefined) return hit;
    const bytes = await readFile(new URL(file, ASSET_DIR));
    cache.set(file, bytes);
    missing.delete(file);
    return bytes;
  };

  /**
   * 启动时一次性把素材读齐。
   *
   * 这里曾经踩过一个自锁：`ready` 原本写成「缓存里是否已有全部素材」，而缓存只在
   * 有人请求素材时才填充——客户端又要等 `ready === true` 才去请求图片。两边互等，
   * 桌宠永远停在 emoji 兜底。所以 `ready` 必须反映「文件到底读不读得出来」，
   * 而不是「有没有人请求过」。单个文件读失败只记进 `missing`，不影响其余素材。
   */
  const warm = (async () => {
    for (const file of ASSETS.keys()) {
      try {
        await loadAsset(file);
      } catch (error) {
        missing.add(file);
        ctx.logger?.warn?.(`[ikun-pet] 素材读不出来（${file}）：${String(error)}`);
      }
    }
    const detail = missing.size === 0 ? '全部就绪' : `缺失 ${[...missing].join(', ')}`;
    ctx.logger?.info?.(`[ikun-pet] 素材 ${cache.size}/${ASSETS.size} —— ${detail}`);
  })();
  // warm 内部已经逐个 try/catch，这个 catch 只是不让它变成未处理的 rejection。
  warm.catch(() => {});

  // ------------------------------------------------------------ 状态机内部量
  /** @type {WeakMap<object, 'running' | 'idle'>} 每个 Agent 上一次已知状态。 */
  const agentStatus = new WeakMap();
  /** @type {Set<object>} 见过的 Agent，轮询早于事件时用它兜底。 */
  const agentSeen = new Set();
  let runningCount = 0;
  let toolsInFlight = 0;
  let lastToolAt = 0;
  let waiting = 0;
  let errorUntil = 0;
  let celebrateUntil = 0;
  let mode = 'idle';
  /** 模式变更版本号；客户端据此判断「这次是不是新状态」。 */
  let seq = 0;
  /** 每次需要播放语音就 +1；客户端按它做「恰好响一次」的去重。 */
  let celebrateSeq = 0;
  let errorSeq = 0;
  /** 已被某个页面认领播放的 celebrateSeq，避免多窗口重响。 */
  let claimedSeq = 0;
  let celebrateCount = 0;
  let errorCount = 0;
  let lastPlayError = null;
  let source = 'init';
  /** 最后一次「有事情发生」的时刻，用来决定什么时候开始打瞌睡。 */
  let lastActivityAt = Date.now();

  const now = () => Date.now();
  const anyRunning = () => runningCount > 0;
  const touch = () => {
    lastActivityAt = now();
  };

  const deriveMode = () => {
    const t = now();
    if (t < errorUntil) return 'failed';
    if (t < celebrateUntil) return 'celebrating';
    if (waiting > 0) return 'waiting';
    if (toolsInFlight > 0 || t - lastToolAt < cfg.recentToolMs) return 'working';
    if (anyRunning()) return 'review';
    // 彻底闲下来够久就睡，睡着的桌宠比一直抖动的桌宠讨喜。
    if (t - lastActivityAt >= cfg.sleepAfterMs) return 'sleeping';
    return 'idle';
  };

  const refresh = () => {
    const next = deriveMode();
    if (next === mode) return;
    mode = next;
    seq += 1;
  };

  /** 工具/轮询都可能调用：状态没变就什么都不做。 */
  const setStatus = (agent, status) => {
    if (agent === null || agent === undefined) return;
    if (status !== 'running' && status !== 'idle') return;
    const prev = agentStatus.get(agent);
    if (prev === status) return;
    agentStatus.set(agent, status);
    agentSeen.add(agent);
    touch();
    if (prev === 'running') runningCount = Math.max(0, runningCount - 1);
    if (status === 'running') {
      runningCount += 1;
      // 新活儿开始了，立刻收起庆祝，别让桌宠一直挥手。
      celebrateUntil = 0;
    }
    if (prev === 'running' && status === 'idle' && runningCount === 0) {
      onAllIdle();
    }
    refresh();
  };

  /** 整台机器从「有人在跑」回到「都停了」——这就是任务完成。 */
  const onAllIdle = () => {
    const t = now();
    if (t < errorUntil) return; // 这一轮是报错结束的，走 failed 分支
    if (waiting > 0) return; // 还卡在审批/提问上，不算完成
    if (toolsInFlight > 0) return; // 工具还没收尾
    celebrateUntil = t + cfg.celebrateMs;
    celebrateSeq += 1;
    celebrateCount += 1;
    refresh();
  };

  const showFailed = () => {
    touch();
    errorUntil = now() + cfg.failedMs;
    errorSeq += 1;
    errorCount += 1;
    // 出错的当轮不再补一次庆祝。
    celebrateUntil = 0;
    refresh();
  };

  const beginTool = () => {
    touch();
    toolsInFlight += 1;
    lastToolAt = now();
    refresh();
  };

  const endTool = () => {
    touch();
    toolsInFlight = Math.max(0, toolsInFlight - 1);
    lastToolAt = now();
    refresh();
  };

  /** 包一层 waterfall 监听：无论 next() 成功、失败还是抛错都要收尾。 */
  const aroundWaterfall = (onStart, onSettle) => (payload, next) => {
    try {
      onStart(payload);
    } catch (error) {
      ctx.logger?.warn?.(`[ikun-pet] observer failed: ${String(error)}`);
    }
    let result;
    try {
      result = next();
    } catch (error) {
      onSettle(payload);
      throw error;
    }
    return Promise.resolve(result).then(
      (value) => {
        onSettle(payload);
        return value;
      },
      (error) => {
        onSettle(payload);
        throw error;
      },
    );
  };

  // ------------------------------------------------------------------ 事件层
  ctx.on('agent/status', (payload) => {
    source = 'event';
    if (payload === null || typeof payload !== 'object') return;
    setStatus(payload.agent, payload.status);
  });

  ctx.on('agent/error', (payload) => {
    if (payload === null || typeof payload !== 'object') return;
    showFailed();
  });

  ctx.on('agent/request-error', aroundWaterfall(() => showFailed(), () => {}));

  ctx.on('tools/execute', aroundWaterfall(() => beginTool(), () => endTool()));

  ctx.on('approval/request', aroundWaterfall(
    () => {
      touch();
      waiting += 1;
      refresh();
    },
    () => {
      waiting = Math.max(0, waiting - 1);
      refresh();
    },
  ));

  ctx.on('user-questions/request', aroundWaterfall(
    () => {
      touch();
      waiting += 1;
      refresh();
    },
    () => {
      waiting = Math.max(0, waiting - 1);
      refresh();
    },
  ));

  // ------------------------------------------------------------------ 轮询层
  const agentsService = () => {
    try {
      return ctx.get('agents');
    } catch {
      return undefined;
    }
  };

  const poll = () => {
    const agents = agentsService();
    if (agents === undefined || typeof agents.list !== 'function') return;
    let list;
    try {
      list = agents.list();
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    for (const agent of list) {
      let status = 'idle';
      try {
        status = agent?.status === 'running' ? 'running' : 'idle';
      } catch {
        status = 'idle';
      }
      setStatus(agent, status);
    }
  };

  /** 过期清扫：漏掉一个 result 事件也不会让桌宠永远停在「干活中」。 */
  const sweep = () => {
    const t = now();
    if (toolsInFlight > 0 && t - lastToolAt > cfg.recentToolMs * 4) toolsInFlight = 0;
    if (errorUntil !== 0 && t > errorUntil + cfg.failedMs) errorUntil = 0;
    if (celebrateUntil !== 0 && t > celebrateUntil + cfg.celebrateMs) celebrateUntil = 0;
    refresh();
  };

  poll();
  refresh();

  const pollTimer = setInterval(poll, Math.max(120, cfg.pollMs));
  const sweepTimer = setInterval(sweep, Math.max(120, cfg.sweepMs));
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  ctx.effect(() => () => {
    clearInterval(pollTimer);
    clearInterval(sweepTimer);
  }, 'ikun-pet: agent activity timers');

  // ------------------------------------------------------------------ 路由层
  const snapshot = () => ({
    mode,
    seq,
    celebrateSeq,
    errorSeq,
    assetBase: ASSET_BASE,
    // 只有一张立绘。读不出来时客户端退回 emoji，并把 missing 报出来便于排查。
    pet: cache.has(PET_ART) ? `${ASSET_BASE}${PET_ART}` : null,
    voice: cache.has(VOICE) ? `${ASSET_BASE}${VOICE}` : null,
    ready: cache.has(PET_ART),
    missing: [...missing],
    debug: {
      runningCount,
      toolsInFlight,
      waiting,
      idleMs: now() - lastActivityAt,
      celebrating: now() < celebrateUntil,
      failing: now() < errorUntil,
      celebrateCount,
      errorCount,
      agentsSeen: agentSeen.size,
      cachedAssets: cache.size,
      source: `${source}+poll`,
      lastPlayError,
    },
  });

  const sendJson = (res, status, value) => {
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  };

  const handleAsset = async (req, res, file) => {
    const type = ASSETS.get(file);
    if (type === undefined) {
      res.writeHead(404).end();
      return;
    }
    let bytes;
    try {
      bytes = await loadAsset(file);
    } catch (error) {
      ctx.logger?.warn?.(`[ikun-pet] asset read failed (${file}): ${String(error)}`);
      res.writeHead(404).end();
      return;
    }
    const etag = `"ikun-${file}-${bytes.length}"`;
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    };
    const inm = req.headers['if-none-match'];
    if (typeof inm === 'string' && inm.split(',').some((v) => v.trim() === etag || v.trim() === '*')) {
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };

  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.get('webServer');
    if (server === undefined || typeof server.register !== 'function') {
      ctx.logger?.warn?.('[ikun-pet] webServer 不可用，桌宠素材无法提供');
      return;
    }

    const handler = async (req, res) => {
      if (!isTrusted(req)) {
        res.writeHead(403).end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname;

      if (route === `${ROUTE_PREFIX}/state` && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(res, 200, snapshot());
        return;
      }

      // 多窗口去重：只有第一个认领某次完成的页面负责放声音。
      if (route === `${ROUTE_PREFIX}/claim` && req.method === 'POST') {
        let wanted = 0;
        try {
          const body = await readJsonBody(req);
          if (typeof body.seq === 'number' && Number.isFinite(body.seq)) wanted = body.seq;
        } catch {
          sendJson(res, 400, { play: false, reason: 'bad-body' });
          return;
        }
        const play = wanted > claimedSeq;
        if (play) claimedSeq = wanted;
        sendJson(res, 200, { play, seq: wanted });
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        await handleAsset(req, res, route.slice(ROUTE_PREFIX.length + 1));
        return;
      }

      res.writeHead(405, { Allow: 'GET, HEAD, POST' }).end();
    };

    webCtx.effect(() => {
      const registered = ROUTES.map((path) => server.register({ kind: 'exact', path, handler }));
      return () => {
        for (const dispose of registered) dispose();
      };
    }, 'ikun-pet: assets and state routes');
  });

  ctx.logger?.info?.('[ikun-pet] IKUN 桌宠已就绪（模式 /ikun-pet/state）');
}
