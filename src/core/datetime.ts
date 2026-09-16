import type { DateStr, TimeStr, Weekday } from '../types'

export const TIMEZONE = 'Asia/Shanghai'
const DAY_MS = 86400000

/**
 * 把日历日期映射成一个稳定的 UTC 时间戳，仅用于「相差多少天」这类计算。
 * 文档 §6.1 要求按日历日计算，不能直接用本地毫秒差，否则夏令时会算错。
 */
function dayStamp(date: DateStr): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromStamp(stamp: number): DateStr {
  const dt = new Date(stamp)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isValidDate(date: string): date is DateStr {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const stamp = dayStamp(date)
  return !Number.isNaN(stamp) && fromStamp(stamp) === date
}

/** b 比 a 晚多少个日历日，可为负。 */
export function diffDays(a: DateStr, b: DateStr): number {
  return Math.round((dayStamp(b) - dayStamp(a)) / DAY_MS)
}

export function addDays(date: DateStr, days: number): DateStr {
  return fromStamp(dayStamp(date) + days * DAY_MS)
}

/** ISO 星期，1 = 周一 … 7 = 周日。 */
export function isoWeekday(date: DateStr): Weekday {
  const day = new Date(dayStamp(date)).getUTCDay()
  return (day === 0 ? 7 : day) as Weekday
}

/** 该日期所在自然周的周一。一周从周一开始，见 §6.1。 */
export function mondayOf(date: DateStr): DateStr {
  return addDays(date, 1 - isoWeekday(date))
}

/* ---------- 当前时刻，统一按学期时区解读 ---------- */

export function todayIn(timezone = TIMEZONE, at: Date = new Date()): DateStr {
  // en-CA 的短日期格式就是 YYYY-MM-DD。
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

export function clockIn(timezone = TIMEZONE, at: Date = new Date()): TimeStr {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
}

/* ---------- 时间字符串 ---------- */

export function toMinutes(time: TimeStr): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function isValidTime(time: string): time is TimeStr {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false
  return true
}

/* ---------- 展示格式 ---------- */

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

export function weekdayLabel(weekday: Weekday): string {
  return WEEKDAY_LABELS[weekday - 1]
}

/** "9月7日" */
export function shortDateLabel(date: DateStr): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}月${d}日`
}

/** "2026年9月7日 周一" */
export function fullDateLabel(date: DateStr): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y}年${m}月${d}日 ${weekdayLabel(isoWeekday(date))}`
}
