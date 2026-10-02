import './styles.css';
import type { CalEvent, Frame } from './model/types';
import { Viewport } from './model/viewport';
import { nextStateChange, withStates } from './model/states';
import { fmtDay, fmtTime, startOfDay, MINUTE } from './model/time';
import { demoEvents } from './model/demo';
import { type Theme, themeAt } from './model/daylight';
import type { World } from './worlds/world';
import { RiverWorld } from './worlds/river';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const viewport = new Viewport();
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
  const frame = makeFrame(now);
  applyTheme(themeAt(now));
  world.draw(ctx, frame);
  redraws++;
  describe(frame);
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
  const wait = Math.min(world.idleRedrawMs(frame), toNextMinute, toStateChange);
  idleTimer = window.setTimeout(requestRender, Math.max(1000, wait));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(idleTimer);
  else requestRender();
});

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
  if (live.length) text += `正在进行：${live.map(e => e.title).join('、')}。`;
  if (next) text += `下一个日程：${next.title}，${fmtDay(next.start)} ${fmtTime(next.start)} 开始。`;
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
