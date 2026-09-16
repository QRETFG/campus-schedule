import type { DateStr, Semester, Weekday } from '../types'
import { addDays, isValidDate, isoWeekday, mondayOf } from './datetime'
import { mondayOfWeek, semesterPhaseOf } from './weeks'

/**
 * 通知里的日期表达解析。
 *
 * 模型只负责把原文片段挑出来，真正的日期换算在这里用确定性代码完成，
 * 基准是用户填写的通知发布日期，并遵循「一周从周一开始」的教学周规则。
 */

export interface ResolvedNoticeDate {
  date?: DateStr
  /** 解析依据，展示给用户核对，例如「以通知发布日 2026-09-16 所在周计算」。 */
  basis?: string
  /**
   * 表达式本身有歧义（例如只写「周四」没说明哪一周），
   * 已按最常见含义解析，但界面必须提示用户确认。
   */
  assumed?: boolean
  /** 无法解析时的原因。 */
  reason?: string
}

const WEEKDAY_CHARS: Record<string, Weekday> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** 把「十二」「十五」这类中文数字转成整数；不支持超过 99。 */
export function parseChineseNumber(text: string): number | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  if (!/^[零一二两三四五六七八九十]+$/.test(trimmed)) return undefined

  const tenIndex = trimmed.indexOf('十')
  if (tenIndex === -1) {
    let value = 0
    for (const ch of trimmed) {
      const digit = CN_DIGITS[ch]
      if (digit === undefined) return undefined
      value = value * 10 + digit
    }
    return value
  }
  const highText = trimmed.slice(0, tenIndex)
  const lowText = trimmed.slice(tenIndex + 1)
  const high = highText ? CN_DIGITS[highText] : 1
  const low = lowText ? CN_DIGITS[lowText] : 0
  if (high === undefined || low === undefined) return undefined
  return high * 10 + low
}

/** 该周（周一起算）的第 n 天。 */
function dayOfWeekContaining(reference: DateStr, weekday: Weekday, weekOffset: number): DateStr {
  return addDays(mondayOf(reference), weekOffset * 7 + (weekday - 1))
}

function weekOffsetOf(prefix: string): number | undefined {
  if (!prefix) return undefined
  if (/^(本|这|该|此)(个)?$/.test(prefix)) return 0
  if (/^下下(个)?$/.test(prefix)) return 2
  if (/^下(个)?$/.test(prefix)) return 1
  if (/^上上(个)?$/.test(prefix)) return -2
  if (/^上(个)?$/.test(prefix)) return -1
  return undefined
}

/** 从通知发布日推断「M月D日」属于哪一年：优先落在学期内，其次取最接近发布日的一年。 */
function inferYear(month: number, day: number, noticeDate: DateStr, semester: Semester): DateStr | undefined {
  const baseYear = Number(noticeDate.slice(0, 4))
  const candidates: DateStr[] = []
  for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    if (isValidDate(candidate)) candidates.push(candidate)
  }
  if (!candidates.length) return undefined

  const inSemester = candidates.filter((d) => semesterPhaseOf(semester, d) === 'during')
  const pool = inSemester.length ? inSemester : candidates
  return pool.reduce((best, current) => {
    const bestGap = Math.abs(Date.parse(best) - Date.parse(noticeDate))
    const gap = Math.abs(Date.parse(current) - Date.parse(noticeDate))
    return gap < bestGap ? current : best
  })
}

/**
 * 解析一个日期表达。
 * 返回 date 为空时说明无法确定，调用方应要求用户补充。
 */
export function resolveNoticeDate(
  text: string | undefined,
  noticeDate: DateStr,
  semester: Semester,
): ResolvedNoticeDate {
  const raw = (text ?? '').trim()
  if (!raw) return { reason: '通知里没有写明日期' }
  if (!isValidDate(noticeDate)) return { reason: '通知发布日期无效' }

  const normalized = raw.replace(/\s+/g, '')

  // 完整日期
  const iso = normalized.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/)
  if (iso) {
    const candidate = `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
    return isValidDate(candidate)
      ? { date: candidate, basis: '通知里写了完整日期' }
      : { reason: `「${raw}」不是有效日期` }
  }

  // 第 N 周 周X（以教学周编号为准）
  const teachingWeek = normalized.match(/第([0-9零一二两三四五六七八九十]+)(?:教学)?周(?:的)?(?:周|星期|礼拜)([一二三四五六日天1-7])/)
  if (teachingWeek) {
    const week = parseChineseNumber(teachingWeek[1])
    const weekday = WEEKDAY_CHARS[teachingWeek[2]]
    if (!week || !weekday) return { reason: `无法解析「${raw}」` }
    if (week < 1 || week > semester.totalWeeks) {
      return { reason: `第 ${week} 周超出本学期范围（共 ${semester.totalWeeks} 周）` }
    }
    return {
      date: addDays(mondayOfWeek(semester, week), weekday - 1),
      basis: `按教学周编号计算，第 ${week} 周`,
    }
  }

  // 今天 / 明天 / 后天 / 昨天 / 前天
  const relativeDay: Array<[RegExp, number, string]> = [
    [/^(今天|今日|本日)/, 0, '通知发布当天'],
    [/^(明天|明日)/, 1, '通知发布日的第二天'],
    [/^(后天)/, 2, '通知发布日的第三天'],
    [/^(大后天)/, 3, '通知发布日的第四天'],
    [/^(昨天|昨日)/, -1, '通知发布日的前一天'],
    [/^(前天)/, -2, '通知发布日的前两天'],
  ]
  for (const [pattern, offset, basis] of relativeDay) {
    if (pattern.test(normalized)) {
      return { date: addDays(noticeDate, offset), basis: `${basis}（${noticeDate}）` }
    }
  }

  // 本周X / 下周X / 上周X / 裸周X
  const weekly = normalized.match(/^(本|这|该|此|下下|下|上上|上)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])/)
  if (weekly) {
    const weekday = WEEKDAY_CHARS[weekly[2]]
    if (!weekday) return { reason: `无法解析「${raw}」` }
    const prefix = weekly[1] ?? ''
    if (!prefix) {
      // 「周四」没说明哪一周：按通知发布日所在周解析，但标记为需要确认。
      return {
        date: dayOfWeekContaining(noticeDate, weekday, 0),
        basis: `未写明哪一周，按通知发布日 ${noticeDate} 所在周计算`,
        assumed: true,
      }
    }
    const offset = weekOffsetOf(prefix)
    if (offset === undefined) return { reason: `无法解析「${raw}」` }
    return {
      date: dayOfWeekContaining(noticeDate, weekday, offset),
      basis: `以通知发布日 ${noticeDate} 所在周为基准${offset ? `，${offset > 0 ? '往后' : '往前'} ${Math.abs(offset)} 周` : ''}`,
    }
  }

  // M月D日 / M月D号
  const monthDay = normalized.match(/([0-9零一二两三四五六七八九十]+)月([0-9零一二两三四五六七八九十]+)[日号]/)
  if (monthDay) {
    const month = parseChineseNumber(monthDay[1])
    const day = parseChineseNumber(monthDay[2])
    if (!month || !day) return { reason: `无法解析「${raw}」` }
    const date = inferYear(month, day, noticeDate, semester)
    return date
      ? { date, basis: `按通知发布日 ${noticeDate} 推断年份` }
      : { reason: `「${raw}」不是有效日期` }
  }

  // M/D 或 M-D
  const slash = normalized.match(/^(\d{1,2})[/-](\d{1,2})$/)
  if (slash) {
    const date = inferYear(Number(slash[1]), Number(slash[2]), noticeDate, semester)
    return date
      ? { date, basis: `按通知发布日 ${noticeDate} 推断年份` }
      : { reason: `「${raw}」不是有效日期` }
  }

  return { reason: `无法从「${raw}」确定具体日期` }
}

/** 从一段文本里取出起止节次，例如「第 5-6 节」「第五节」。 */
export function parsePeriodRange(
  text: string | undefined,
): { start: number; end: number } | undefined {
  const raw = (text ?? '').replace(/\s+/g, '')
  if (!raw) return undefined
  const range = raw.match(/第?([0-9零一二两三四五六七八九十]+)[-–—~～至到]([0-9零一二两三四五六七八九十]+)节/)
  if (range) {
    const start = parseChineseNumber(range[1])
    const end = parseChineseNumber(range[2])
    if (start && end) return { start, end }
  }
  const single = raw.match(/第([0-9零一二两三四五六七八九十]+)节/)
  if (single) {
    const value = parseChineseNumber(single[1])
    if (value) return { start: value, end: value }
  }
  return undefined
}

export { isoWeekday }
