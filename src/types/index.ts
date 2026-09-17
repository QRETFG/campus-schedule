/** 数据对象定义，对应产品设计文档 §7。 */

/** 形如 "2026-09-07" 的当地日历日期。 */
export type DateStr = string
/** 形如 "08:00" 的 24 小时制时间。 */
export type TimeStr = string
/** ISO 星期：1 = 周一 … 7 = 周日。 */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface Semester {
  id: string
  name: string
  /** 第 1 教学周的周一，不是任意开学日期。 */
  firstWeekMonday: DateStr
  totalWeeks: number
  timezone: string
}

export interface PeriodTime {
  period: number
  start: TimeStr
  end: TimeStr
}

export interface Course {
  id: string
  name: string
  teacher?: string
  /** 调色板索引，保证同一课程颜色稳定。 */
  colorIndex: number
}

/** 周次规则；保存时统一展开为实际周次集合存入 weeks。 */
export type WeekRuleKind = 'all' | 'range' | 'odd' | 'even' | 'custom'

export interface WeekRule {
  kind: WeekRuleKind
  /** range / odd / even 使用的区间。 */
  from?: number
  to?: number
  /** custom 使用的原始输入，例如 "1-4,6,8-12"。 */
  custom?: string
}

export interface RecurringSlot {
  id: string
  courseId: string
  weekday: Weekday
  startPeriod: number
  endPeriod: number
  /** 展开、去重、排序后的实际周次集合。 */
  weeks: number[]
  /** 保留规则用于回显编辑表单。 */
  rule: WeekRule
  room?: string
}

export type ChangeType = 'cancel' | 'room' | 'move'

/** 单次变更，见 §6.3。一个「原课程实例」最多一份当前有效的变更。 */
export interface SingleChange {
  id: string
  slotId: string
  /** 被调整的那一次课的原始日期。 */
  originalDate: DateStr
  type: ChangeType
  /** type = 'move' 时的目标。 */
  targetDate?: DateStr
  targetStartPeriod?: number
  targetEndPeriod?: number
  /** type = 'room' 或 'move' 时可覆盖教室。 */
  roomOverride?: string
  note?: string
}

/** 一次性补课，只在指定日期生效。 */
export interface OneOffClass {
  id: string
  courseId: string
  date: DateStr
  startPeriod: number
  endPeriod: number
  room?: string
}

/** 一次批量写入的记录，用于撤销；只针对该批变更，不做整份快照回滚。 */
export interface AppliedBatchEntry {
  kind: 'change' | 'oneoff'
  /** 本批实际写入的值，撤销时用来确认这条记录之后没有被改过。 */
  written: SingleChange | OneOffClass
  /** 本批覆盖掉的原有单次变更；撤销时恢复它。 */
  replaced?: SingleChange
}

export interface AppliedBatch {
  id: string
  appliedAt: string
  source: 'notice'
  entries: AppliedBatchEntry[]
}

export interface AppData {
  /** 数据结构版本，用于加载旧数据时迁移。缺失视为 1。 */
  schemaVersion?: number
  semester: Semester
  periods: PeriodTime[]
  courses: Course[]
  slots: RecurringSlot[]
  changes: SingleChange[]
  oneOffs: OneOffClass[]
  /** 最近一次批量应用的通知变更，供撤销使用。 */
  lastBatch?: AppliedBatch
}

/** 当前数据结构版本。 */
export const SCHEMA_VERSION = 2

/**
 * 一个部署实例中的全部学期。业务计算仍然只接收单个 AppData，避免不同
 * 学期的课程、作息和临时调整互相串联。
 */
export interface ScheduleWorkspace {
  workspaceVersion: number
  semesters: AppData[]
}

export const WORKSPACE_VERSION = 1

/**
 * 备份格式版本。
 * 1 = 首版；2 = 增加 schemaVersion 与 lastBatch；3 = 支持多个学期。
 * 旧版本可以直接升级读取。
 */
export const BACKUP_FORMAT_VERSION = 3

export interface Backup {
  formatVersion: number
  exportedAt: string
  data: ScheduleWorkspace
}

/* ---------- 解算结果：某一天实际发生的课程 ---------- */

export type InstanceOrigin = 'recurring' | 'oneoff' | 'moved-in'
/** 在原时段不再上课的两种情况，仅在当日列表中保留记录。 */
export type InstanceState = 'normal' | 'cancelled' | 'moved-out'

export interface ClassInstance {
  /** 同一天内稳定唯一。 */
  key: string
  courseId: string
  courseName: string
  teacher?: string
  colorIndex: number
  date: DateStr
  weekday: Weekday
  startPeriod: number
  endPeriod: number
  startTime: TimeStr
  endTime: TimeStr
  room?: string
  origin: InstanceOrigin
  state: InstanceState
  slotId?: string
  oneOffId?: string
  changeId?: string
  /** moved-in 时记录来源日期，用于「由 X 月 X 日调入」。 */
  movedFrom?: DateStr
  /** moved-out 时记录去向日期。 */
  movedTo?: DateStr
  /** 本次教室与重复安排不同。 */
  roomChanged?: boolean
  /** 引用的节次在当前作息表中已不存在时为 false，见 §6.4。 */
  timeValid: boolean
}
