/** 一条日程。时间都用毫秒时间戳（与时区无关），显示时再换成本地时间。 */
export interface CalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  notes?: string;
  /** 会前准备事项，临近时提醒 */
  prep?: PrepItem[];
  /** 结束后写下的一两句结论；写了就成了一条记录 */
  outcome?: string;
}

export interface PrepItem {
  text: string;
  done: boolean;
}

/** 日程相对“现在”的状态 */
export type EventState = 'future' | 'soon' | 'live' | 'ended';

export interface EventView extends CalEvent {
  state: EventState;
}

/**
 * 每次重绘时，时间模型交给世界的一份快照。
 * 世界只读它，不改它；也不需要知道数据从哪来。
 */
export interface Frame {
  /** 真实的现在 */
  now: number;
  /** 视角所在的时间（现在 + 拖动偏移） */
  view: number;
  events: EventView[];
}
