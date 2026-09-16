import type { NoticeCandidate, TimetableEntry } from '../src/shared/contract'

/**
 * 演示模式的固定样例。
 * 只在 SCHEDULE_MODE=demo 时使用，响应里会带上 mode: 'demo'，界面必须标明。
 * 样例刻意覆盖缺教室、缺周次、单双周和时间冲突几种需要用户处理的情况。
 */
export const DEMO_TIMETABLE: TimetableEntry[] = [
  entry({ courseName: '高等数学 A', teacher: '王敏', room: 'A101', weekday: 1, startPeriod: 1, endPeriod: 2, weeksText: '1-16周', sourceText: '高等数学A 王敏 A101 1-16周' }),
  entry({ courseName: '高等数学 A', teacher: '王敏', room: 'B203', weekday: 4, startPeriod: 3, endPeriod: 4, weeksText: '1-16周', sourceText: '高等数学A 王敏 B203 1-16周' }),
  entry({ courseName: '大学英语', teacher: '李文静', room: 'C305', weekday: 2, startPeriod: 3, endPeriod: 4, weeksText: '1-16周', sourceText: '大学英语 李文静 C305 1-16周' }),
  // 图片未写周次：核对页必须标记「周次待确认」，不能默认全学期。
  entry({ courseName: '线性代数', teacher: '张涛', room: 'A208', weekday: 3, startPeriod: 1, endPeriod: 2, sourceText: '线性代数 张涛 A208' }),
  // 教室缺失，允许保存但显示「教室待补充」。
  entry({ courseName: '大学物理', teacher: '陈立', weekday: 3, startPeriod: 5, endPeriod: 6, weeksText: '单周 1-15周', uncertainFields: ['room'], sourceText: '大学物理 陈立 单周1-15周' }),
  // 与大学物理同星期同节次但双周，没有共同周次，不应误报冲突。
  entry({ courseName: '体育（篮球）', teacher: '刘强', room: '体育馆 2 号场', weekday: 3, startPeriod: 5, endPeriod: 6, weeksText: '双周 2-14周', sourceText: '体育(篮球) 刘强 体育馆2号场 双周2-14周' }),
  // 与大学英语时间重叠，且课程名识别不确定。
  entry({ courseName: '程序设计基础', teacher: '周颖', room: 'D112', weekday: 2, startPeriod: 4, endPeriod: 5, weeksText: '2-12周', uncertainFields: ['courseName'], sourceText: '程序设计基础 周颖 D112 2-12周' }),
  entry({ courseName: '思想道德与法治', teacher: '孙红', room: 'E401', weekday: 5, startPeriod: 7, endPeriod: 8, weeksText: '1-8周', sourceText: '思想道德与法治 孙红 E401 1-8周' }),
]

function entry(partial: Partial<TimetableEntry>): TimetableEntry {
  return {
    courseName: null,
    teacher: null,
    room: null,
    weekday: null,
    startPeriod: null,
    endPeriod: null,
    weeksText: null,
    uncertainFields: [],
    sourceText: null,
    ...partial,
  }
}

/**
 * 演示模式的通知解析：不调用模型，用几条正则覆盖最常见的句式。
 * 它只用于跑通链路，解析能力远不及真实模型，界面会标明这是演示结果。
 */
const DATE_EXPR = /(?:本|这|该|此|下下|下|上上|上)?(?:个)?(?:周|星期|礼拜)[一二三四五六日天]|今天|明天|后天|昨天/g

export function demoNotice(text: string): NoticeCandidate[] {
  const base: NoticeCandidate = {
    kind: 'unknown',
    courseHint: null,
    originalDateText: null,
    originalDate: null,
    originalPeriodStart: null,
    originalPeriodEnd: null,
    targetDateText: null,
    targetDate: null,
    targetPeriodStart: null,
    targetPeriodEnd: null,
    room: null,
    sourceText: text.trim().slice(0, 200),
    notes: '演示模式的解析结果，仅用于跑通流程，请逐项核对。',
  }

  const dates = [...text.matchAll(DATE_EXPR)].map((m) => ({ text: m[0], index: m.index ?? 0 }))
  const moveAt = text.search(/补到|调到|改到|挪到|顺延到/)

  // 「补到」之后的第一个日期是目标日期，之前的是原日期。
  const target = moveAt >= 0 ? dates.find((d) => d.index > moveAt) : undefined
  const original = dates.find((d) => d !== target)

  const periods = text.match(/第\s*([0-9一二三四五六七八九十]+)\s*[-–—~～至到]\s*([0-9一二三四五六七八九十]+)\s*节/)
  const room = text.match(/(?:教室)?(?:改为|改成|调整为|变更为|换到|改到)\s*([A-Za-z0-9\u4e00-\u9fa5]{2,12}?)(?=[，。；,;]|$)/)

  // 课程称呼取「停课/调课」前面的一段，去掉前缀的日期表达。
  const hintMatch = text.match(/([\u4e00-\u9fa5A-Za-z0-9（）()]{2,16}?)(?=停课|不上课|调课|停一次)/)
  let courseHint = hintMatch?.[1] ?? null
  if (courseHint && original && courseHint.startsWith(original.text)) {
    courseHint = courseHint.slice(original.text.length) || null
  }
  if (courseHint) courseHint = courseHint.replace(/^[，,。的]+/, '') || null

  const digits = (value: string | undefined) => {
    if (!value) return null
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
    if (/^\d+$/.test(value)) return Number(value)
    return map[value] ?? null
  }

  const item: NoticeCandidate = {
    ...base,
    courseHint,
    originalDateText: original?.text ?? null,
    targetDateText: target?.text ?? null,
    room: room?.[1] ?? null,
    targetPeriodStart: digits(periods?.[1]),
    targetPeriodEnd: digits(periods?.[2]),
  }

  if (target) return [{ ...item, kind: 'move' }]
  if (/停课|不上课/.test(text)) return [{ ...item, kind: 'cancel' }]
  if (item.room) return [{ ...item, kind: 'room' }]
  if (/补课/.test(text) && original) {
    return [{ ...item, kind: 'makeup', targetDateText: original.text, originalDateText: null }]
  }
  return []
}
