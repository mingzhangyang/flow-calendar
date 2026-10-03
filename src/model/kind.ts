import type { CalEvent, Kind } from './types';

/** 类型的名字（界面上用） */
export const KIND_NAMES: Record<Kind, string> = { focus: '专注', learn: '学习', meet: '会议', habit: '习惯' };

const KINDS = Object.keys(KIND_NAMES) as Kind[];

/**
 * 按标题猜类型。先看像不像习惯（跑步、冥想……），再看像不像会议、学习；都不像就算专注。
 * 只是个起点，猜错了在表单里改。
 */
const RULES: [Kind, RegExp][] = [
  ['habit', /跑步|晨跑|夜跑|健身|锻炼|运动|游泳|瑜伽|冥想|打卡|浇花|浇水|散步|早起|日记|拉伸|练琴|run|jog|gym|workout|yoga|meditat|journal|walk/i],
  ['meet', /开会|会议|组会|会谈|会面|会见|会诊|例会|晨会|周会|月会|年会|董事会|股东会|听证会|发布会|研讨会|茶话会|家长会|评审|讨论|电话|面试|沟通|同步|对齐|访谈|拜访|约见|见面|聚餐|1\s*[:：]\s*1|一对一|meeting|call|sync|review|interview|standup|1on1/i],
  ['learn', /读|学|课|论文|书|讲座|背单词|练习|网课|研究|study|read|course|learn|lecture|class|paper/i],
];

export function guessKind(title: string): Kind {
  for (const [kind, re] of RULES) if (re.test(title)) return kind;
  return 'focus';
}

/** 日程的类型：自己选过的为准，否则按标题猜 */
export function kindOf(ev: Pick<CalEvent, 'title' | 'kind'>): Kind {
  return ev.kind && KINDS.includes(ev.kind) ? ev.kind : guessKind(ev.title);
}
