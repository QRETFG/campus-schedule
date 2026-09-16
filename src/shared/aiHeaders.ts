/**
 * 自定义模型配置通过同源应用服务端转发。单独放在无依赖文件中，避免前端
 * 为几个 header 常量打包 zod。
 */
export const AI_CONFIG_HEADERS = {
  format: 'x-schedule-ai-format',
  baseUrl: 'x-schedule-ai-base-url',
  apiKey: 'x-schedule-ai-key',
  model: 'x-schedule-ai-model',
} as const

