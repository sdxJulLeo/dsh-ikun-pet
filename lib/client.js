window.__ModuleLoader__.load({
	id: "dsh-ikun-pet",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");
		/*
		 * IKUN 桌宠 · Client 半（浏览器）。
		 *
		 * 这是一个手写的 `window.__ModuleLoader__.load` 闭包工厂包：脚本执行时只注册
		 * factory，所有副作用都发生在 factory 被物化时。这也是本文件必须以 banner
		 * 开头、以 footer 结尾的原因。因此这里不经过任何构建步骤，也只 `require('react')`
		 * 这一个平台种子模块。
		 *
		 * 设计要点：**只有一张立绘**。状态差异全部由三样东西表达——
		 *   1. 动作（每状态一套 transform keyframes，支点在身体底部）；
		 *   2. 特效（汗滴 / Z / 彩纸 / 思考点，纯 CSS 画的小元素）；
		 *   3. 气泡文案。
		 * 这样角色始终是同一个人，不会因为换图而「变脸」，也不会闪。
		 * 与外界的全部通信都走同源 `fetch('/ikun-pet/...')`——Host 半注册的自有路由。
		 */
		//#region 状态
		/** 气泡文案：状态的主要「可读」通道。 */
		const BUBBLES = {
			idle: '休息中~ 有事叫我',
			review: '让我想想…',
			working: '正在努力搬砖 🏀',
			waiting: '在等你回复哦~',
			failed: '呜…出错了 (._.)',
			celebrating: '完成啦！你干嘛~哎哟',
			sleeping: 'Zzz… 还在这儿哦',
		};
		const BUBBLE_DRAG = '呜哇~ 别拽我！';
		const BUBBLE_POKE = '诶嘿~ 你干嘛~';

		/**
		 * 动作：键 -> inline `animation` 字符串。
		 * 全部只动 transform（外加 filter），所以不会触发布局，合成器就能跑满帧。
		 */
		const MOTION = {
			idle: 'pet-breathe 3.6s ease-in-out infinite',
			review: 'pet-think 4.4s ease-in-out infinite',
			working: 'pet-dribble 0.56s cubic-bezier(0.34, 0.72, 0.42, 1) infinite',
			waiting: 'pet-peek 1.9s ease-in-out infinite',
			failed: 'pet-droop 1.8s ease-in-out infinite',
			celebrating: 'pet-cheer 0.78s cubic-bezier(0.3, 0.86, 0.36, 1) infinite',
			sleeping: 'pet-sleep 5s ease-in-out infinite',
			dragging: 'pet-dangle 0.4s ease-in-out infinite',
		};

		/** 与动作配套的地面阴影：只有真正离地的动作才需要缩放。 */
		const SHADOW = {
			working: 'pet-shadow-hop 0.56s cubic-bezier(0.34, 0.72, 0.42, 1) infinite',
			celebrating: 'pet-shadow-cheer 0.78s cubic-bezier(0.3, 0.86, 0.36, 1) infinite',
			dragging: 'pet-shadow-dangle 0.4s ease-in-out infinite',
		};

		/** 情绪滤镜：不换图也能让「沮丧 / 开心 / 困」读得出来。 */
		const FILTER = {
			working: 'saturate(1.06) contrast(1.02)',
			failed: 'saturate(0.45) brightness(0.93)',
			celebrating: 'saturate(1.18) brightness(1.05)',
			sleeping: 'saturate(0.8) brightness(0.9)',
		};

		/**
		 * 特效层：每个元素都是一个纯 CSS 画的小东西。
		 * `x` / `y` 是相对立绘框的百分比位置，`delay` 用来错开节奏。
		 */
		const EFFECTS = {
			idle: [],
			review: [
				{ kind: 'dot', x: 74, y: 22, delay: 0 },
				{ kind: 'dot', x: 81, y: 22, delay: 0.2 },
				{ kind: 'dot', x: 88, y: 22, delay: 0.4 },
			],
			working: [
				{ kind: 'sweat', x: 12, y: 34, delay: 0 },
				{ kind: 'sweat', x: 6, y: 50, delay: 0.28 },
			],
			waiting: [{ kind: 'mark', text: '?', x: 84, y: 12, delay: 0 }],
			failed: [
				{ kind: 'sweat', x: 14, y: 28, delay: 0 },
				{ kind: 'sweat', x: 84, y: 34, delay: 0.6 },
			],
			celebrating: [
				{ kind: 'confetti', x: 30, y: 30, dx: -34, dy: -34, rot: -140, delay: 0, hue: '#ff5d8f' },
				{ kind: 'confetti', x: 50, y: 24, dx: -8, dy: -46, rot: 120, delay: 0.12, hue: '#ffd23f' },
				{ kind: 'confetti', x: 70, y: 30, dx: 32, dy: -36, rot: 160, delay: 0.24, hue: '#4cc9f0' },
				{ kind: 'confetti', x: 22, y: 52, dx: -40, dy: -12, rot: -90, delay: 0.34, hue: '#8ac926' },
				{ kind: 'confetti', x: 78, y: 52, dx: 40, dy: -14, rot: 90, delay: 0.44, hue: '#b388ff' },
				{ kind: 'confetti', x: 50, y: 62, dx: 4, dy: -30, rot: 200, delay: 0.56, hue: '#ff8fab' },
			],
			sleeping: [
				{ kind: 'zzz', text: 'Z', x: 80, y: 30, delay: 0 },
				{ kind: 'zzz', text: 'Z', x: 86, y: 22, delay: 0.9 },
				{ kind: 'zzz', text: 'z', x: 91, y: 15, delay: 1.8 },
			],
			dragging: [],
		};
		//#endregion
		//#region 样式
		/** 组件样式：只作用于 `[data-ikun-pet-root]` 子树，颜色走语义 token。 */
		const CSS = `
[data-ikun-pet-root], [data-ikun-pet-root] *, [data-ikun-pet-root] *::before, [data-ikun-pet-root] *::after { box-sizing: border-box; }
[data-ikun-pet-root] {
  position: fixed;
  right: 26px;
  bottom: 16px;
  width: calc(210px * var(--ikun-scale, 1));
  height: calc(230px * var(--ikun-scale, 1));
  z-index: 900;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}
[data-ikun-pet-root][data-dragging="true"] { cursor: grabbing; }

[data-ikun-pet-shadow] {
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 54%;
  height: 12px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(0, 0, 0, 0.30), rgba(0, 0, 0, 0) 78%);
  pointer-events: none;
}

[data-ikun-pet-motion] {
  position: absolute;
  inset: 0;
  /* 支点放在身体底部：起跳、歪头、被拖走都以「站在地上」为基准，不会像贴纸一样飘。 */
  transform-origin: 50% 94%;
  will-change: transform;
}
[data-ikun-pet-art] {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center bottom;
  display: block;
  pointer-events: none;
  -webkit-user-drag: none;
  filter: drop-shadow(0 5px 10px rgba(0, 0, 0, 0.16));
  transition: filter 320ms ease;
}
[data-ikun-pet-root][data-ready="false"] [data-ikun-pet-art] { display: none; }
[data-ikun-pet-fallback] {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(104px * var(--ikun-scale, 1));
  line-height: 1;
}
[data-ikun-pet-root][data-ready="true"] [data-ikun-pet-fallback] { display: none; }

[data-ikun-pet-fx] { position: absolute; inset: 0; pointer-events: none; }
[data-ikun-pet-fx] > * { position: absolute; }

[data-fx="sweat"] {
  width: 9px;
  height: 9px;
  border-radius: 50% 50% 50% 0;
  background: linear-gradient(140deg, #8fd3ff, #3fa9f5);
  transform: rotate(-45deg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
  animation: fx-sweat 1.6s ease-out infinite;
}
[data-fx="dot"] {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary, #8a919c);
  animation: fx-dot 1.5s ease-in-out infinite;
}
[data-fx="mark"] {
  font: 700 20px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', system-ui, sans-serif;
  color: var(--dsw-alias-brand-primary, #4d6bfe);
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.7);
  animation: fx-mark 1.4s ease-in-out infinite;
}
[data-fx="zzz"] {
  font: 700 17px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  color: var(--dsw-alias-label-secondary, #7b8290);
  animation: fx-zzz 2.8s ease-out infinite;
}
[data-fx="confetti"] {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  animation: fx-confetti 1.5s ease-out infinite;
}

[data-ikun-pet-bubble] {
  position: absolute;
  left: 50%;
  bottom: calc(100% - 26px);
  transform: translateX(-50%);
  max-width: 230px;
  padding: 6px 11px;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
  background: var(--dsw-alias-bg-overlay, rgba(255, 255, 255, 0.96));
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 12.5px;
  line-height: 1.45;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  text-align: center;
  white-space: nowrap;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  pointer-events: none;
  animation: pet-pop 200ms ease-out;
}
[data-ikun-pet-bubble]::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--dsw-alias-bg-overlay, rgba(255, 255, 255, 0.96));
}

[data-ikun-pet-menu] {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  min-width: 176px;
  padding: 8px;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
  background: var(--dsw-alias-bg-overlay, #fff);
  color: var(--dsw-alias-label-primary, #1f2328);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  font-size: 12.5px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  cursor: default;
}
[data-ikun-pet-menu] label { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 6px; cursor: pointer; }
[data-ikun-pet-menu] button {
  width: 100%;
  margin-top: 4px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.1));
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
[data-ikun-pet-menu] button:hover { background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05)); }
[data-ikun-pet-menu] input[type="range"] { width: 86px; }
[data-ikun-pet-menu] kbd {
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  opacity: .5;
}

/* ---- 动作 ---- */
@keyframes pet-breathe {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  50% { transform: translateY(-5px) scale(1.008, 1.022); }
}
@keyframes pet-think {
  0%, 100% { transform: rotate(-5deg) translateY(0); }
  32% { transform: rotate(-6.5deg) translateY(-3px); }
  68% { transform: rotate(5deg) translateY(-1px); }
}
@keyframes pet-dribble {
  0%, 100% { transform: translateY(0) scale(1.05, 0.93); }
  28% { transform: translateY(-19px) scale(0.97, 1.06); }
  56% { transform: translateY(-5px) scale(1.01, 0.99); }
  76% { transform: translateY(0) scale(1.07, 0.91); }
}
@keyframes pet-peek {
  0%, 100% { transform: translateY(-2px) rotate(-3deg); }
  36% { transform: translateY(-10px) rotate(1deg) scale(1.022, 1); }
  70% { transform: translateY(-2px) rotate(3.5deg); }
}
@keyframes pet-droop {
  0%, 52%, 100% { transform: translateY(8px) rotate(-5deg) scale(0.975, 0.955); }
  10% { transform: translateY(9px) rotate(-8.5deg) scale(0.975, 0.955); }
  20% { transform: translateY(7px) rotate(-1.5deg) scale(0.98, 0.96); }
  32% { transform: translateY(9px) rotate(-7deg) scale(0.975, 0.955); }
}
@keyframes pet-cheer {
  0% { transform: translateY(0) scale(1.06, 0.92); }
  14% { transform: translateY(5px) scale(1.13, 0.85); }
  40% { transform: translateY(-42px) scale(0.94, 1.1) rotate(-7deg); }
  64% { transform: translateY(-14px) scale(0.99, 1.02) rotate(5deg); }
  84% { transform: translateY(0) scale(1.09, 0.89); }
  100% { transform: translateY(0) scale(1.06, 0.92); }
}
@keyframes pet-sleep {
  0%, 100% { transform: translateY(2px) rotate(-2deg) scale(1, 1); }
  50% { transform: translateY(9px) rotate(-2deg) scale(1.035, 0.962); }
}
@keyframes pet-dangle {
  0%, 100% { transform: rotate(-9deg) translateY(0) scale(1.02, 0.98); }
  50% { transform: rotate(-2deg) translateY(-11px) scale(0.99, 1.02); }
}
@keyframes pet-shadow-hop {
  0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.85; }
  28% { transform: translateX(-50%) scale(0.76); opacity: 0.42; }
  56% { transform: translateX(-50%) scale(0.93); opacity: 0.7; }
}
@keyframes pet-shadow-cheer {
  0% { transform: translateX(-50%) scale(1); opacity: 0.9; }
  14% { transform: translateX(-50%) scale(1.08); opacity: 0.95; }
  40% { transform: translateX(-50%) scale(0.62); opacity: 0.28; }
  64% { transform: translateX(-50%) scale(0.9); opacity: 0.66; }
  100% { transform: translateX(-50%) scale(1); opacity: 0.9; }
}
@keyframes pet-shadow-dangle {
  0%, 100% { transform: translateX(-50%) scale(1); opacity: 0.8; }
  50% { transform: translateX(-50%) scale(0.84); opacity: 0.5; }
}
@keyframes pet-pop {
  from { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.96); }
  to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}

/* ---- 特效 ---- */
@keyframes fx-sweat {
  0% { opacity: 0; transform: translate(0, 0) rotate(-45deg) scale(0.4); }
  18% { opacity: 0.95; }
  100% { opacity: 0; transform: translate(16px, -44px) rotate(-45deg) scale(1.05); }
}
@keyframes fx-dot {
  0%, 70%, 100% { opacity: 0.22; transform: translateY(0); }
  35% { opacity: 1; transform: translateY(-5px); }
}
@keyframes fx-mark {
  0%, 100% { opacity: 0.55; transform: translateY(0) rotate(-6deg); }
  45% { opacity: 1; transform: translateY(-7px) rotate(8deg); }
}
@keyframes fx-zzz {
  0% { opacity: 0; transform: translate(0, 0) scale(0.6); }
  22% { opacity: 0.92; }
  100% { opacity: 0; transform: translate(13px, -54px) scale(1.15); }
}
@keyframes fx-confetti {
  0% { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.5); }
  16% { opacity: 1; }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  [data-ikun-pet-motion], [data-ikun-pet-shadow], [data-ikun-pet-fx] > * { animation: none !important; }
  [data-ikun-pet-bubble] { animation: none; }
  [data-ikun-pet-art] { transition: none; }
}
`;
		/** 样式只注入一次；返回拆除函数，随插件卸载一起清理。 */
		function installStyles() {
			const TAG_ATTR = 'data-plugin-css';
			const TAG_ID = 'dsh-ikun-pet/pet.css';
			document.querySelectorAll('style[' + TAG_ATTR + '="' + TAG_ID + '"]').forEach((el) => el.remove());
			const tag = document.createElement('style');
			tag.dataset.plugin = 'dsh-ikun-pet';
			tag.setAttribute(TAG_ATTR, TAG_ID);
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion
		//#region 偏好（localStorage）
		const PREFS_KEY = 'dsh-ikun-pet:prefs:v3';
		const DEFAULT_PREFS = { scale: 1, muted: false, bubble: true, effects: true, left: null, top: null };
		/** 读取本地偏好；任何损坏的存储都退回默认值而不是抛错。 */
		function loadPrefs() {
			try {
				const raw = window.localStorage.getItem(PREFS_KEY);
				if (raw === null) return { ...DEFAULT_PREFS };
				const parsed = JSON.parse(raw);
				if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
				const scale = typeof parsed.scale === 'number' && parsed.scale >= 0.5 && parsed.scale <= 2 ? parsed.scale : DEFAULT_PREFS.scale;
				const left = typeof parsed.left === 'number' && Number.isFinite(parsed.left) ? parsed.left : null;
				const top = typeof parsed.top === 'number' && Number.isFinite(parsed.top) ? parsed.top : null;
				return {
					scale,
					left,
					top,
					muted: parsed.muted === true,
					bubble: parsed.bubble !== false,
					effects: parsed.effects !== false,
				};
			} catch {
				return { ...DEFAULT_PREFS };
			}
		}
		function savePrefs(prefs) {
			try {
				window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
			} catch {
				// 隐私模式下写不进去也不该影响桌宠
			}
		}
		/** 极简外部 store：保证 getSnapshot 返回稳定引用，避免 React 无限重渲染。 */
		function createPrefsStore() {
			let snapshot = loadPrefs();
			const listeners = new Set();
			return {
				getSnapshot: () => snapshot,
				subscribe(fn) {
					listeners.add(fn);
					return () => listeners.delete(fn);
				},
				update(patch) {
					snapshot = { ...snapshot, ...patch };
					savePrefs(snapshot);
					for (const fn of listeners) fn();
				},
			};
		}
		//#endregion
		//#region 语音
		/**
		 * 语音播放器。浏览器自动播放策略要求先有一次用户手势，因此这里做了
		 * 「静音预热」解锁：页面任何一次点击/按键之后，完成音就能可靠播放。
		 */
		function createVoice() {
			let audio = null;
			let src = null;
			let unlocked = false;
			let pending = false;
			const ensure = () => {
				if (audio === null) {
					audio = new Audio();
					audio.preload = 'auto';
					audio.volume = 0.85;
				}
				if (src !== null && audio.src !== src) audio.src = src;
				return audio;
			};
			/** Host 半报的语音地址是权威值；还没报出来之前不播。 */
			const setSource = (next) => {
				if (typeof next !== 'string' || next.length === 0 || next === src) return;
				src = next;
				if (audio !== null) audio.src = src;
			};
			const unlock = () => {
				if (unlocked || src === null) return;
				const el = ensure();
				el.muted = true;
				const done = () => {
					el.pause();
					try { el.currentTime = 0; } catch { /* 尚未 seekable */ }
					el.muted = false;
					unlocked = true;
					if (pending) {
						pending = false;
						play();
					}
				};
				const started = el.play();
				if (started !== undefined && typeof started.then === 'function') started.then(done, () => { el.muted = false; });
				else done();
			};
			const play = () => {
				if (src === null) return;
				const el = ensure();
				try {
					el.currentTime = 0;
				} catch { /* ignore */ }
				const started = el.play();
				if (started !== undefined && typeof started.catch === 'function') {
					started.catch(() => {
						// 还没解锁：记下来，等第一次手势后补放。
						if (!unlocked) {
							unlocked = true; // 只补一次，避免手势风暴
							pending = true;
						}
					});
				}
			};
			return { unlock, play, setSource, isUnlocked: () => unlocked };
		}
		//#endregion
		//#region 状态轮询
		/**
		 * 轮询 Host 半的 `/ikun-pet/state`。只有内容真的变了才 setState，
		 * 否则 500ms 一次的快照会把 React 拖进无意义的重渲染。
		 */
		function useHostState(intervalMs) {
			const [state, setState] = React.useState(null);
			const lastRef = React.useRef('');
			React.useEffect(() => {
				let alive = true;
				const tick = async () => {
					try {
						const res = await fetch('/ikun-pet/state', { credentials: 'same-origin' });
						if (!res.ok) return;
						const next = await res.json();
						if (!alive || next === null || typeof next !== 'object') return;
						const key = String(next.mode) + '|' + String(next.seq) + '|' + String(next.celebrateSeq) + '|' + String(next.ready) + '|' + String(next.pet);
						if (key === lastRef.current) return;
						lastRef.current = key;
						setState(next);
					} catch {
						// 宿主重启或短暂断连：下一拍继续
					}
				};
				tick();
				const timer = window.setInterval(tick, intervalMs);
				return () => {
					alive = false;
					window.clearInterval(timer);
				};
			}, [intervalMs]);
			return state;
		}
		//#endregion
		//#region 组件
		function IkunPet(props) {
			const { prefs, voice } = props;
			const state = useHostState(props.pollMs);
			const stored = React.useSyncExternalStore(prefs.subscribe, prefs.getSnapshot, prefs.getSnapshot);
			const [dragging, setDragging] = React.useState(false);
			const [reaction, setReaction] = React.useState(false);
			const [menuOpen, setMenuOpen] = React.useState(false);
			const [dragPosition, setDragPosition] = React.useState(null);
			const dragRef = React.useRef(null);
			const rootRef = React.useRef(null);
			const reactionTimer = React.useRef(null);
			const playedSeq = React.useRef(-1);

			const mode = state !== null && typeof state.mode === 'string' ? state.mode : 'idle';
			// `pet` 是当前 Host 半的字段。旧版本（按状态给七张图）只会给 `artwork`，
			// 这里退回它里面的 idle，这样在「插件包已更新、宿主还没重启」的窗口期里
			// 刷新页面也不会掉回 emoji——只是暂时用旧素材跑新动作。
			const petUrl = state !== null && typeof state.pet === 'string'
				? state.pet
				: (state !== null && state.artwork !== null && typeof state.artwork === 'object' && typeof state.artwork.idle === 'string'
					? state.artwork.idle
					: null);
			const voiceUrl = state !== null && typeof state.voice === 'string' ? state.voice : null;
			const ready = petUrl !== null;

			// 每次「完成」由 Host 递增 celebrateSeq：认领成功才出声，多窗口只响一次。
			React.useEffect(() => {
				if (state === null) return;
				const seq = typeof state.celebrateSeq === 'number' ? state.celebrateSeq : 0;
				if (seq <= 0 || playedSeq.current === seq) return;
				playedSeq.current = seq;
				if (stored.muted) return;
				let cancelled = false;
				fetch('/ikun-pet/claim', {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ seq }),
				}).then(
					(res) => (res.ok ? res.json() : { play: true }),
					() => ({ play: true }),
				).then((verdict) => {
					if (!cancelled && verdict !== null && verdict.play !== false) voice.play();
				});
				return () => {
					cancelled = true;
				};
			}, [state, stored.muted, voice]);

			React.useEffect(() => {
				voice.setSource(voiceUrl);
			}, [voice, voiceUrl]);

			// 完成音需要一次用户手势才能播放：在 document 上等着第一次交互。
			React.useEffect(() => {
				const handler = () => voice.unlock();
				document.addEventListener('pointerdown', handler, true);
				document.addEventListener('keydown', handler, true);
				return () => {
					document.removeEventListener('pointerdown', handler, true);
					document.removeEventListener('keydown', handler, true);
				};
			}, [voice]);

			React.useEffect(() => () => {
				if (reactionTimer.current !== null) window.clearTimeout(reactionTimer.current);
			}, []);

			// 展示状态：拖动 > 点击反应 > Host 模式。
			const shown = dragging ? 'dragging' : (reaction ? 'celebrating' : mode);
			const bubble = dragging
				? BUBBLE_DRAG
				: (reaction ? BUBBLE_POKE : (BUBBLES[mode] ?? BUBBLES.idle));

			const size = { width: 210 * stored.scale, height: 230 * stored.scale };

			const react = () => {
				setReaction(true);
				if (reactionTimer.current !== null) window.clearTimeout(reactionTimer.current);
				reactionTimer.current = window.setTimeout(() => {
					reactionTimer.current = null;
					setReaction(false);
				}, 2400);
			};

			const clamp = (left, top) => {
				const maxLeft = Math.max(0, window.innerWidth - size.width);
				const maxTop = Math.max(0, window.innerHeight - size.height);
				return { left: Math.min(Math.max(left, 0), maxLeft), top: Math.min(Math.max(top, 0), maxTop) };
			};

			const onPointerDown = (event) => {
				if (event.button !== 0) return;
				const target = event.target;
				if (target !== null && target.closest !== undefined && target.closest('[data-ikun-pet-menu]') !== null) return;
				const el = rootRef.current;
				if (el === null) return;
				const rect = el.getBoundingClientRect();
				try {
					el.setPointerCapture(event.pointerId);
				} catch { /* 某些环境不支持捕获 */ }
				dragRef.current = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
				setDragging(true);
			};

			const onPointerMove = (event) => {
				const drag = dragRef.current;
				if (drag === null) return;
				const dx = event.clientX - drag.x;
				const dy = event.clientY - drag.y;
				if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
				setDragPosition(clamp(drag.left + dx, drag.top + dy));
			};

			const onPointerUp = () => {
				const drag = dragRef.current;
				dragRef.current = null;
				setDragging(false);
				if (drag !== null && drag.moved) {
					setDragPosition((current) => {
						if (current !== null) prefs.update({ left: current.left, top: current.top });
						return current;
					});
					return;
				}
				setDragPosition(null);
				if (drag !== null) {
					react();
					if (!stored.muted) voice.play();
				}
			};

			const onContextMenu = (event) => {
				event.preventDefault();
				setMenuOpen((open) => !open);
			};

			const rootStyle = { '--ikun-scale': String(stored.scale), ...size };
			const placed = dragPosition ?? (stored.left !== null && stored.top !== null
				? clamp(stored.left, stored.top)
				: null);
			if (placed !== null) {
				rootStyle.left = placed.left + 'px';
				rootStyle.top = placed.top + 'px';
				rootStyle.right = 'auto';
				rootStyle.bottom = 'auto';
			}

			const art = React.createElement('img', {
				'data-ikun-pet-art': '',
				src: petUrl ?? undefined,
				alt: '',
				draggable: false,
				style: { filter: (FILTER[shown] ?? '') + ' drop-shadow(0 5px 10px rgba(0,0,0,.16))' },
			});

			// 特效层：只渲染当前状态需要的几个纯 CSS 小元素。
			const effects = stored.effects ? (EFFECTS[shown] ?? []) : [];
			const fxNodes = effects.map((fx, index) => {
				const style = { left: fx.x + '%', top: fx.y + '%', animationDelay: (fx.delay ?? 0) + 's' };
				if (fx.kind === 'confetti') {
					style.background = fx.hue;
					style['--dx'] = fx.dx + 'px';
					style['--dy'] = fx.dy + 'px';
					style['--rot'] = fx.rot + 'deg';
				}
				return React.createElement('i', {
					key: fx.kind + '-' + index,
					'data-fx': fx.kind,
					style,
				}, fx.text ?? null);
			});

			const children = [
				React.createElement('div', { key: 'shadow', 'data-ikun-pet-shadow': '', style: { animation: SHADOW[shown] ?? 'none' } }),
				React.createElement('div', { key: 'motion', 'data-ikun-pet-motion': '', style: { animation: MOTION[shown] ?? MOTION.idle } }, [
					art,
					React.createElement('div', { key: 'fx', 'data-ikun-pet-fx': '' }, fxNodes),
				]),
				React.createElement('div', { key: 'fallback', 'data-ikun-pet-fallback': '' }, '🐤'),
			];
			if (stored.bubble && !menuOpen) {
				children.push(React.createElement('div', { key: 'bubble', 'data-ikun-pet-bubble': '' }, bubble));
			}
			if (menuOpen) {
				children.push(React.createElement('div', {
					key: 'menu',
					'data-ikun-pet-menu': '',
					onPointerDown: (event) => event.stopPropagation(),
				}, [
					React.createElement('label', { key: 'size' }, [
						React.createElement('span', { key: 'label' }, '大小'),
						React.createElement('input', {
							key: 'input',
							type: 'range',
							min: '0.5',
							max: '2',
							step: '0.05',
							value: String(stored.scale),
							onChange: (event) => prefs.update({ scale: Number(event.target.value) }),
						}),
					]),
					React.createElement('label', { key: 'muted' }, [
						React.createElement('span', { key: 'label' }, '静音'),
						React.createElement('input', {
							key: 'input',
							type: 'checkbox',
							checked: stored.muted,
							onChange: (event) => prefs.update({ muted: event.target.checked }),
						}),
					]),
					React.createElement('label', { key: 'bubble' }, [
						React.createElement('span', { key: 'label' }, '气泡'),
						React.createElement('input', {
							key: 'input',
							type: 'checkbox',
							checked: stored.bubble,
							onChange: (event) => prefs.update({ bubble: event.target.checked }),
						}),
					]),
					React.createElement('label', { key: 'effects' }, [
						React.createElement('span', { key: 'label' }, '特效'),
						React.createElement('input', {
							key: 'input',
							type: 'checkbox',
							checked: stored.effects,
							onChange: (event) => prefs.update({ effects: event.target.checked }),
						}),
					]),
					React.createElement('button', {
						key: 'reset',
						type: 'button',
						onClick: () => {
							prefs.update({ left: null, top: null });
							setMenuOpen(false);
						},
					}, '回到右下角'),
					React.createElement('button', {
						key: 'close',
						type: 'button',
						onClick: () => setMenuOpen(false),
					}, '关闭菜单'),
				]));
			}

			return React.createElement('div', {
				ref: rootRef,
				'data-ikun-pet-root': '',
				'data-ready': ready ? 'true' : 'false',
				'data-dragging': dragging ? 'true' : 'false',
				'data-muted': stored.muted ? 'true' : 'false',
				'data-mode': mode,
				'data-shown': shown,
				style: rootStyle,
				title: 'IKUN 桌宠 · 拖动移动 · 单击打招呼 · 右键设置',
				onPointerDown,
				onPointerMove,
				onPointerUp,
				onPointerCancel: onPointerUp,
				onContextMenu,
			}, children);
		}
		//#endregion
		//#region 插件入口
		/** Cordis 服务依赖：`slots` 是前端扩展的唯一入口。 */
		const inject = ['slots'];
		function apply(ctx) {
			ctx.effect(installStyles, 'ikun-pet: stylesheet');
			const prefs = createPrefsStore();
			const voice = createVoice();
			ctx.slots.inject('shell.overlay', () => ctx.slots.register({
				name: 'shell.overlay',
				id: 'ikun-pet',
				order: 90,
				label: 'IKUN 桌宠',
				inject: () => ({ prefs, voice, pollMs: 500 }),
			}, IkunPet));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
