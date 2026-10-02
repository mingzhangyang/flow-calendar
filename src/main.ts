import './styles.css';
import type { CalEvent, Frame } from './model/types';
import { Viewport } from './model/viewport';
import { nextStateChange, withStates } from './model/states';
import { fmtDay, fmtTime, startOfDay, HOUR, MINUTE } from './model/time';
import { demoEvents } from './model/demo';
import { type Theme, themeAt } from './model/daylight';
import type { World } from './worlds/world';
import { RiverWorld } from './worlds/river';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const viewport = new Viewport();
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
viewport.reducedMotion = motionQuery.matches;
motionQuery.addEventListener('change', () => { viewport.reducedMotion = motionQuery.matches; });
const world: World = new RiverWorld();

// 第 3 步换成本地数据库
let events: CalEvent[] = demoEvents(Date.now());
let eventsDay = startOfDay(Date.now());

/* ---------- 尺寸 ---------- */

function readInsets() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const insets = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  probe.remove();
  return insets;
}

function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  world.resize(r.width, r.height, readInsets());
  requestRender();
}

/* ---------- 按需重绘 ----------
 * 只有三种情况会画：
 *   1. 视角在动、或世界有过渡动画 → 逐帧画
 *   2. 时间往前走了一点 → 按世界给的间隔画一次（河流约每 20 秒）
 *   3. 尺寸变化、页面重新可见、某个日程改变状态 → 立刻画一次
 * 页面在后台时完全不画。
 */
let rafId = 0;
let idleTimer = 0;
let redraws = 0;

function requestRender() {
  if (!rafId) rafId = requestAnimationFrame(render);
}

function makeFrame(now: number): Frame {
  if (startOfDay(now) !== eventsDay) {
    events = demoEvents(now);
    eventsDay = startOfDay(now);
  }
  return { now, view: viewport.viewTime(now), events: withStates(events, now) };
}

function render() {
  rafId = 0;
  const now = Date.now();
  viewport.update(performance.now());
  const frame = makeFrame(now);
  applyTheme(themeAt(now));
  world.draw(ctx, frame);
  redraws++;
  describe(frame);
  showViewing(frame);
  canvas.classList.add('ready');

  if (viewport.isMoving() || world.isAnimating(frame)) {
    requestRender();
  } else {
    scheduleIdle(frame, now);
  }
}

function scheduleIdle(frame: Frame, now: number) {
  clearTimeout(idleTimer);
  if (document.hidden) return;
  const toNextMinute = MINUTE - (now % MINUTE) + 30; // 时间标签换分钟
  const toStateChange = nextStateChange(events, now) - now + 30;
  const toReturn = viewport.wakeIn(performance.now()) + 16; // 停留结束，开始回到“现在”
  const wait = Math.min(world.idleRedrawMs(frame), toNextMinute, toStateChange, toReturn);
  idleTimer = window.setTimeout(requestRender, Math.max(toReturn < 1000 ? toReturn : 1000, wait));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(idleTimer);
  else requestRender();
});

/* ---------- 拖动、滚轮、键盘 ----------
 * 往下拖，把远处的日子拉近 → 去未来；往上推 → 回看过去。
 * 松手后顺势滑一段，停一会儿，再慢慢回到“现在”。
 */
let dragId: number | null = null;
let lastY = 0;

const localY = (e: { clientY: number }) => e.clientY - canvas.getBoundingClientRect().top;

canvas.addEventListener('pointerdown', e => {
  if (dragId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
  dragId = e.pointerId;
  lastY = localY(e);
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
  viewport.grab(performance.now());
  requestRender();
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== dragId) return;
  const y = localY(e);
  viewport.dragBy(world.dragHours(lastY, y - lastY), performance.now());
  lastY = y;
  requestRender();
});

function endDrag(e: PointerEvent) {
  if (e.pointerId !== dragId) return;
  dragId = null;
  canvas.classList.remove('dragging');
  viewport.release(performance.now());
  requestRender();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (dragId !== null) return;
  // 滚轮按行或按页滚动时换成像素；往下滚 = 往未来
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
  viewport.scrollBy(world.dragHours(localY(e), e.deltaY * unit), performance.now());
  requestRender();
}, { passive: false });

const KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 24, PageUp: -24 };
window.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || dragId !== null) return;
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button')) return;
  const t = performance.now();
  if (e.key in KEYS) viewport.nudge(KEYS[e.key], t);
  else if (e.key === 'Home' || e.key === 'Escape') viewport.home(t);
  else return;
  e.preventDefault();
  requestRender();
});

/* ---------- “正在看”提示 ----------
 * 视角离开“现在”时，顶部显示正在看的时间；点一下立刻回来。
 */
const viewing = document.getElementById('viewing') as HTMLButtonElement;
const viewingWhen = viewing.querySelector('.when') as HTMLElement;
viewing.addEventListener('click', () => {
  viewport.home(performance.now());
  requestRender();
});

let viewingText = '';
function showViewing(f: Frame) {
  const away = viewport.away;
  viewing.classList.toggle('show', away);
  if (!away) return;
  // 取整到 5 分钟，拖动时文字不至于乱跳
  const t = Math.round(f.view / (5 * MINUTE)) * 5 * MINUTE;
  const text = `${fmtDay(t)} ${fmtTime(t)}`;
  if (text !== viewingText) {
    viewingWhen.textContent = text;
    viewingText = text;
  }
}

/* ---------- 界面明暗 ----------
 * 跟着真实的现在，而不是视角：拖去看今晚时，河会变暗，
 * 但面板和按钮仍然是此刻该有的样子。
 */
let currentTheme: Theme | null = null;
const themeMeta = document.querySelector('meta[name="theme-color"]');
function applyTheme(theme: Theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  themeMeta?.setAttribute('content', theme === 'light' ? '#D9E6EC' : '#070C10');
}

/* ---------- 给读屏软件的文字说明 ---------- */

let lastDescription = '';
function describe(f: Frame) {
  const live = f.events.filter(e => e.state === 'live');
  const next = f.events.find(e => e.state === 'soon' || e.state === 'future');
  let text = `河流视图。现在是${fmtDay(f.now)} ${fmtTime(f.now)}。`;
  if (Math.abs(f.view - f.now) > HOUR / 4) text += `正在看${fmtDay(f.view)} ${fmtTime(f.view)}。`;
  if (live.length) text += `正在进行：${live.map(e => e.title).join('、')}。`;
  if (next) text += `下一个日程：${next.title}，${fmtDay(next.start)} ${fmtTime(next.start)} 开始。`;
  text += '上下拖动可以去看未来或回看过去，方向键按小时移动，Home 键回到现在。';
  if (text !== lastDescription) {
    canvas.setAttribute('aria-label', text);
    lastDescription = text;
  }
}

/* ---------- 启动 ---------- */

window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(canvas);
resize();

// 调试用：在控制台输入 __flow.redraws 查看已经重画了几次
(window as unknown as { __flow: object }).__flow = { get redraws() { return redraws; } };
