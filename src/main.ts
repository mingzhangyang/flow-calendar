import './styles.css';
import type { CalEvent, Frame, Goal } from './model/types';
import { Viewport } from './model/viewport';
import { nextStateChange, prepLeft, withStates } from './model/states';
import { fmtDay, fmtTime, HOUR, MINUTE } from './model/time';
import { openStore } from './data/store';
import { Sheet } from './ui/sheet';
import { ListView } from './ui/list';
import { GoalForm } from './ui/goal';
import { type Theme, themeAt } from './model/daylight';
import { type World, GOAL_HIT } from './worlds/world';
import { HikeWorld } from './worlds/hike';
import { ClimbWorld, summitOf } from './worlds/climb';
import { FarmWorld } from './worlds/farm';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const viewport = new Viewport();
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
viewport.reducedMotion = motionQuery.matches;
motionQuery.addEventListener('change', () => { viewport.reducedMotion = motionQuery.matches; });

/* ---------- 模式 ----------
 * 每种模式是一个世界。切换时只换世界，时间模型和数据不动；选过的模式记在本机。
 */
const WORLDS: Record<string, () => World> = {
  hike: () => new HikeWorld(() => requestRender()),
  climb: () => new ClimbWorld(() => requestRender()),
  farm: () => new FarmWorld(() => requestRender()),
};
const made = new Map<string, World>();
let world: World = useWorld(readMode());

function readMode(): string {
  try {
    const m = localStorage.getItem('flow.mode');
    // 只认自己定义的模式（`in` 会把 toString 之类继承来的也算进去）
    if (m && Object.prototype.hasOwnProperty.call(WORLDS, m)) return m;
  } catch { /* 读不到就用默认 */ }
  return 'hike';
}

function useWorld(id: string): World {
  let w = made.get(id);
  if (!w) { w = WORLDS[id](); made.set(id, w); }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === id));
  }
  (document.getElementById('goal-btn') as HTMLButtonElement).hidden = id !== 'climb';
  (document.getElementById('overview') as HTMLButtonElement).hidden = !w.setOverview;
  return w;
}

document.getElementById('modes')!.addEventListener('click', e => {
  const id = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]')?.dataset.mode;
  if (!id || id === world.id) return;
  setOverview(false);
  // 换下来的世界不再重画，过渡停在半路；直接收回，下次切回来就是平常的样子
  world.setOverview?.(false, true);
  world = useWorld(id);
  try { localStorage.setItem('flow.mode', id); } catch { /* 记不住也没关系 */ }
  lastDescription = '';
  resize();
});

/* ---------- 日程数据 ----------
 * 存在本机（IndexedDB）。启动时全部读进来，改动后重新读一遍。
 */
let events: CalEvent[] = [];
/** 登山的目标（山顶的旗） */
let goal: Goal | null = null;
let sheet: Sheet | null = null;
let list: ListView | null = null;
let goalForm: GoalForm | null = null;
const note = document.getElementById('note') as HTMLElement;

openStore().then(async store => {
  events = await store.all();
  goal = await store.goal();
  goalForm = new GoalForm({
    store,
    changed(g) {
      goal = g;
      requestRender();
    },
  });
  sheet = new Sheet({
    store,
    find: id => events.find(e => e.id === id),
    async changed() {
      events = await store.all();
      showNote(store.persistent);
      list?.forceRefresh();
      requestRender();
    },
  });
  list = new ListView({
    events: () => events,
    openDetail: id => sheet?.openDetail(id),
    async importFile(file) {
      let result;
      try {
        const { parseIcs } = await import('./data/ics');
        result = parseIcs(await file.text());
      } catch {
        return '这个文件读不出来。请选一个 .ics 日历文件（比如从 Google 日历导出的）。';
      }
      if (!result.events.length) return '文件里没有找到日程。';
      const { added, updated } = await store.importMany(result.events);
      events = await store.all();
      showNote(store.persistent);
      requestRender();
      let text = `导入好了：新加 ${added} 条`;
      if (updated) text += `，更新 ${updated} 条（已写的准备事项和结论都保留）`;
      text += '。';
      if (result.recurring) text += `其中 ${result.recurring} 个重复日程，展开了往回 30 天到往后一年。`;
      if (result.dropped) text += `太多了，有 ${result.dropped} 次没有导入。`;
      return text;
    },
  });
  showNote(store.persistent);
  requestRender();
});

function showNote(persistent: boolean) {
  const text = !persistent
    ? '这个浏览器不能在本机保存，关掉页面后日程不会保留。'
    : events.length ? '' : '还没有日程。点右下角的“新建”添加一个，或者在“列表”里导入日历文件。';
  note.textContent = text;
  note.hidden = !text;
}

document.getElementById('open-list')!.addEventListener('click', () => list?.open());

function openGoal() {
  goalForm?.open(goal, summitOf(Date.now(), null).ms);
}
document.getElementById('goal-btn')!.addEventListener('click', openGoal);

/* ---------- 回望（登山、农场） ----------
 * 拉远看全貌（登山是整座山，农场是近五周的月历）。拉远时视角先回到“现在”，期间不能拖。
 */
let overview = false;
const overviewBtn = document.getElementById('overview') as HTMLButtonElement;
function setOverview(on: boolean) {
  if (on === overview) return;
  overview = on;
  if (on) viewport.home(performance.now());
  world.setOverview?.(on, viewport.reducedMotion);
  overviewBtn.textContent = on ? '回到眼前' : '回望';
  overviewBtn.setAttribute('aria-pressed', String(on));
  lastDescription = '';
  requestRender();
}
overviewBtn.addEventListener('click', () => setOverview(!overview));

document.getElementById('add')!.addEventListener('click', () => {
  // 新建的日程默认放在正在看的时间
  sheet?.openNew(viewport.viewTime(Date.now()));
});

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
 *   2. 时间往前走了一点 → 按世界给的间隔画一次（远足约每 20 秒）
 *   3. 尺寸变化、页面重新可见、某个日程改变状态、素材加载好 → 立刻画一次
 * 页面在后台时完全不画。
 */
let rafId = 0;
let idleTimer = 0;
let redraws = 0;

function requestRender() {
  if (!rafId) rafId = requestAnimationFrame(render);
}

function makeFrame(now: number): Frame {
  return { now, view: viewport.viewTime(now), events: withStates(events, now), goal };
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
  list?.refresh(now);
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
let lastX = 0;
let lastY = 0;
/** 按下的位置和时刻：没怎么动就松手，算作点一下 */
let down = { x: 0, y: 0, t: 0, moved: 0 };

const localX = (e: { clientX: number }) => e.clientX - canvas.getBoundingClientRect().left;
const localY = (e: { clientY: number }) => e.clientY - canvas.getBoundingClientRect().top;

canvas.addEventListener('pointerdown', e => {
  if (dragId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
  dragId = e.pointerId;
  lastX = localX(e);
  lastY = localY(e);
  down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
  // 回望时视角正回到现在，不让拖动打断；点一下仍然能打开详情
  if (!overview) viewport.grab(performance.now());
  requestRender();
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== dragId) return;
  const x = localX(e), y = localY(e);
  down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
  if (!overview) viewport.dragBy(world.dragHours(lastX, lastY, x - lastX, y - lastY), performance.now());
  lastX = x;
  lastY = y;
  requestRender();
});

function endDrag(e: PointerEvent) {
  if (e.pointerId !== dragId) return;
  dragId = null;
  canvas.classList.remove('dragging');
  if (!overview) viewport.release(performance.now());
  requestRender();
  // 点一下光点：打开详情
  if (e.type === 'pointerup' && down.moved < 8 && performance.now() - down.t < 600) {
    const r = canvas.getBoundingClientRect();
    const id = world.hitTest(e.clientX - r.left, e.clientY - r.top);
    if (id === GOAL_HIT) openGoal();
    else if (id) sheet?.openDetail(id);
  }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (dragId !== null || overview) return;
  // 滚轮按行或按页滚动时换成像素；往下滚、往右滚 = 往未来
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
  viewport.scrollBy(world.dragHours(localX(e), localY(e), -e.deltaX * unit, e.deltaY * unit), performance.now());
  requestRender();
}, { passive: false });

const KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 24, PageUp: -24 };
window.addEventListener('keydown', e => {
  if (e.altKey || e.ctrlKey || e.metaKey || dragId !== null || sheet?.isOpen || list?.isOpen || goalForm?.isOpen) return;
  if (overview) {
    // 回望时不移动视角；Esc 回到眼前。点过“回望”后焦点还在那个按钮上，所以先于下面的过滤处理
    if (e.key !== 'Escape') return;
    setOverview(false);
    e.preventDefault();
    return;
  }
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
 * 跟着真实的现在，而不是视角：拖去看今晚时，画面会变暗，
 * 但面板和按钮仍然是此刻该有的样子。
 */
let currentTheme: Theme | null = null;
const themeMeta = document.querySelector('meta[name="theme-color"]');
function applyTheme(theme: Theme) {
  if (theme === currentTheme) return;
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  themeMeta?.setAttribute('content', theme === 'light' ? '#E4D6B8' : '#26232A');
}

/* ---------- 给读屏软件的文字说明 ---------- */

let lastDescription = '';
function describe(f: Frame) {
  const live = f.events.filter(e => e.state === 'live');
  const next = f.events.find(e => e.state === 'soon' || e.state === 'future');
  let text = `${world.name}视图。现在是${fmtDay(f.now)} ${fmtTime(f.now)}。`;
  if (Math.abs(f.view - f.now) > HOUR / 4) text += `正在看${fmtDay(f.view)} ${fmtTime(f.view)}。`;
  if (live.length) text += `正在进行：${live.map(e => e.title).join('、')}。`;
  if (next) text += `下一个日程：${next.title}，${fmtDay(next.start)} ${fmtTime(next.start)} 开始。`;
  if (next?.state === 'soon' && prepLeft(next)) text += `还有 ${prepLeft(next)} 项准备没做完。`;
  text += world.describe?.(f) ?? '';
  if (overview) {
    // 回望时不能拖、方向键也不动，说明要和实际一致
    text += '正在回望，这时不能拖动。按 Esc 或左下角的“回到眼前”回来。';
  } else {
    text += world.id === 'climb' ? '左右或上下拖动' : '上下拖动';
    text += '可以去看未来或回看过去，方向键按小时移动，Home 键回到现在。';
  }
  text += '右上角的“列表”按钮可以按列表查看和搜索全部日程，左上角可以切换远足、登山、农场三种模式。';
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
