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
  /** 自己选的类型；没选时按标题猜（见 kind.ts） */
  kind?: Kind;
}

/** 日程的类型：专注、学习、会议、习惯。各个世界按它换比喻（农场：耕地、播种、赶集、浇树） */
export type Kind = 'focus' | 'learn' | 'meet' | 'habit';

export interface PrepItem {
  text: string;
  done: boolean;
}

/** 日程相对“现在”的状态 */
export type EventState = 'future' | 'soon' | 'live' | 'ended';

export interface EventView extends CalEvent {
  state: EventState;
}

/** 登山的目标：一句话和截止的时刻（那天傍晚 18:00） */
export interface Goal {
  title: string;
  due: number;
  /** 什么时候出发（第一次设这个目标的时刻）；回望时从这里画起 */
  start?: number;
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
  /** 自己设的目标；没设时为 null（登山模式用，其他世界可以不管） */
  goal: Goal | null;
}
