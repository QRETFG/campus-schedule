# 智能大学课表 Web MVP

面向大学生的个人网页课表，手机端优先，兼容桌面浏览器。可以同时保存多个学期并独立切换展示；全部学期由部署实例轻量持久化，并在浏览器保留本机副本，不需要注册登录。

需求依据：`docs/智能大学课表-Web-MVP-产品设计文档.md`。

## 快速开始

```bash
npm install
cp .env.example .env     # 可选：配置服务端默认模型
npm run dev              # 同时启动前端 (5173) 和服务端 (8787)
```

只想跑课表本身、不碰识别功能时，`npm run dev:web` 即可；识别和通知解析入口会显示「服务未配置」并引导手动录入。

| 命令 | 说明 |
|---|---|
| `npm run dev` | 并行启动前端与服务端，前端把 `/api` 代理到服务端 |
| `npm run dev:web` | 只启动前端 |
| `npm run dev:api` | 只启动服务端 |
| `npm run build` | 类型检查 + 前端构建到 `dist/` |
| `npm start` | 生产模式：服务端同时托管 `dist/` 和 `/api` |
| `npm test` | 全部测试 |

> **WSL 注意**：在 `/mnt/*` 挂载盘上，Vite 和 tsx 的文件监听不生效（inotify 不上报 Windows 盘的变更），改完代码需要重启 `npm run dev`。

## Docker 部署

镜像同时包含前端静态文件和 API 服务，只需暴露一个端口。服务器安装 Docker 与 Docker Compose 后，在项目目录执行：

```bash
cp .env.example .env
# 按需编辑 .env；不使用服务端默认模型时可以不填 API Key
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8787/api/health
```

浏览器访问 `http://服务器地址:8787`。更新代码后再次执行 `docker compose up -d --build` 即可滚动替换容器；查看日志使用 `docker compose logs -f schedule`，停止使用 `docker compose down`。

宿主机端口可通过 `.env` 中的 `SCHEDULE_HTTP_PORT` 修改，容器内部固定监听 8787。模型格式、URL、模型 ID、API Key、限流和 4 分 30 秒上游超时都会从同一份 `.env` 注入容器。没有服务端密钥时课表功能仍可使用，也可以在网页设置中填写会话级自定义 OpenAI 配置。

全部学期的共享课表保存在 Docker 命名卷 `schedule-data` 的 `/app/data/schedule.json` 中，重新构建或替换容器不会丢失。不要使用 `docker compose down -v`，该命令会连同课表数据卷一起删除。需要额外备份时可以执行：

```bash
docker compose cp schedule:/app/data/schedule.json ./schedule-server-backup.json
```

若前面还有 Nginx、宝塔或云平台网关，需要把请求体上限设为至少 15 MB，并把读取/发送超时设为至少 310 秒，否则代理可能先于应用的 5 分钟等待上限断开。例如 Nginx：

```nginx
client_max_body_size 15m;
proxy_read_timeout 310s;
proxy_send_timeout 310s;
```

### 镜像内置的首次课表

全新部署尚无云端记录时，首个连接设备会用自己的已有本地课表初始化；本地也为空时，自动导入项目内置课表：`2026-2027 学年第一学期`、12 节作息、7 门课程和 13 组重复安排。云端一旦初始化，后续设备以云端版本为准，之后的修改、备份恢复或主动清空也不会被默认值覆盖。

首次打开时，浏览器会先读取云端共享课表；服务器尚未初始化时，才会用内置课表创建第一版云端数据。可以从页面顶部或“设置 → 学期管理”添加、切换学期；每个学期的课程、作息和单次调整互相隔离。当前展示的学期是设备本地偏好，不会因为另一台设备切换页面而改变。每次编辑都会立即写入本机副本并上传，页面打开期间每 30 秒以及重新切回页面时检查更新；版本未变化时返回 304，不重复传输整份课表。断网时仍可使用本机副本，恢复后自动补同步。

当前是单用户共享模式：同一部署地址下所有设备看到并修改同一份课表，没有账号隔离或合并编辑；两台设备同时修改时，以服务端最后收到的完整版本为准。初始课表也会进入公开的前端资源。部署到公网时请使用防火墙、反向代理认证或其他访问控制，避免无关人员读取或覆盖课表。

## 模型配置与真实识别

项目支持三种上游接口格式：

| 格式 | 服务端配置值 | 上游端点 |
|---|---|---|
| Anthropic Messages | `anthropic` | 由 Anthropic SDK 调用 |
| OpenAI Responses API | `openai-responses` | `<BASE_URL>/responses` |
| OpenAI Chat Completions API | `openai-chat-completions` | `<BASE_URL>/chat/completions` |

OpenAI 的两种请求和响应结构分别实现，没有把一种格式伪装成另一种。两者都请求严格 JSON Schema 输出，返回后还会经过同一份 zod schema 校验。OpenAI 官方文档说明 Responses 是新项目的推荐接口，而 Chat Completions 仍受支持：<https://developers.openai.com/api/docs/guides/migrate-to-responses>。

### 方式一：服务端默认配置

完整清单见 `.env.example`。密钥是服务端专用变量，不能加 `VITE_` 前缀，也不能写入前端代码或提交记录。

启用真实识别：

1. 在 `.env` 选择 `SCHEDULE_API_FORMAT`。
2. Anthropic 格式填写 `ANTHROPIC_API_KEY`；OpenAI 两种格式填写 `OPENAI_API_KEY`。
3. 按需设置 `ANTHROPIC_BASE_URL` 或 `OPENAI_BASE_URL`，并用 `SCHEDULE_MODEL` 指定模型 ID。
4. 重启服务端。
5. 访问 `GET /api/health`，`mode` 应为 `live`，同时会返回 `apiFormat` 和模型 ID，但不会返回密钥。

例如使用 OpenAI Responses API：

```dotenv
SCHEDULE_API_FORMAT=openai-responses
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1
SCHEDULE_MODEL=your-vision-model-id
```

### 方式二：前端自定义配置

打开“设置 → 智能服务”，选择以下任一格式：

- OpenAI Responses API。
- OpenAI Chat Completions API。

然后填写 API URL、API Key 和模型 ID。基础 URL（如 `https://api.openai.com/v1`）和完整端点地址都可接受，应用会按所选格式规范化最终端点。

API Key 输入框始终使用密码模式。保存后输入框会清空，只显示“当前会话已保存”，不会把 Key 明文回填到界面。Key 只存在当前标签页的 `sessionStorage` 和运行内存中；URL、格式和模型 ID 保存在 `localStorage`。这些配置都不属于课表数据，也不会进入备份文件。

发起识别或解析时，自定义配置通过同源请求交给应用服务端，由服务端转发到所填 API URL；服务端不持久化也不记录 Key。只应填写自己信任的服务地址。关闭标签页后需要重新输入 Key。

服务端仍是必需的：它负责请求校验、限流、结构化输出和上游转发。只启动前端时，自定义配置也不能绕过服务端直接调用第三方地址。

### 三种运行模式

服务端根据配置决定模式，前端通过 `/api/health` 读取并据此改变界面：

| mode | 触发条件 | 行为 |
|---|---|---|
| `live` | 默认格式所需的服务端密钥存在 | 真实调用图片理解服务 |
| `demo` | `SCHEDULE_MODE=demo` | 返回固定样例，界面显著标明「不是真实识别结果」，仅供演示和测试 |
| `unconfigured` | 没有密钥 | 识别与解析接口返回 503，界面提示未配置并引导手动录入 |

**生产模式缺配置时不会静默返回样例课程** —— `SCHEDULE_MODE=live` 而没有密钥也会报未配置，不降级。
前端填写完整的自定义配置后，可以逐次请求覆盖 `demo` 或 `unconfigured` 的服务端默认上游；仍会经过服务端的频率和并发限制。

### 费用与资源限制

`SCHEDULE_RATE_LIMIT_PER_MINUTE`（每 IP 每分钟请求数）、`SCHEDULE_MAX_CONCURRENT`（在途上游请求数）、`SCHEDULE_MAX_OUTPUT_TOKENS`、`SCHEDULE_UPSTREAM_TIMEOUT_MS` 都在 `.env.example` 里。上游调用默认最多等待 4 分 30 秒，前端整体最多等待 5 分钟；识别与通知解析共用同一份频率配额。

## 接口

前端只访问应用自己的服务端，不直接接触识别服务。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 运行模式与各项限制 |
| GET | `/api/schedule` | 读取共享课表；支持 ETag / 304 |
| PUT | `/api/schedule` | 原子替换共享课表并递增版本 |
| DELETE | `/api/schedule` | 同步清空课表并保留空版本记录 |
| POST | `/api/ocr/timetable` | 课表截图 → 结构化上课安排 |
| POST | `/api/notice/parse` | 调课通知文本 → 结构化候选变更 |

请求与响应的 schema 定义在 `src/shared/contract.ts`，前后端共用：服务端用它做出参校验和结构化输出定义，前端只 `import type`（zod 不进浏览器产物）。

服务端校验请求体大小、base64 合法性和**文件魔数**（防止改扩展名绕过格式限制），并把 body-parser 的错误也转成结构化错误码。日志只记录路由、耗时、条目数和错误码，不记录密钥、原图、通知原文或课表内容。

## 目录结构

```
server/                 最小服务端（Express）
  index.ts                路由、校验、限流、中止传播、静态托管
  config.ts               环境变量与模式判定
  extract.ts              Anthropic + 两种 OpenAI 协议：结构化输出、响应解析、错误码收敛
  scheduleStore.ts        共享课表 JSON 存储、串行写入与原子替换
  demo.ts                 演示模式的固定样例
  rateLimit.ts / log.ts   频率限制、并发闸门、脱敏日志

src/
  shared/contract.ts    前后端共享的接口契约
  types/                数据对象定义
  core/                 纯函数业务规则，全部可单测
    datetime.ts           按日历日的日期运算、Asia/Shanghai 当前时刻
    weeks.ts              教学周计算、周次规则展开
    resolve.ts            某日实际课程解算：重复安排 × 周次 × 单次变更
    conflict.ts           冲突与重复判定
    nextClass.ts          正在上课 / 下一节
    impact.ts             修改学期设置、作息表、重复安排的影响分析
    draft.ts              识别草稿的校验、分类、批量设周次
    noticeDates.ts        中文相对日期与节次的确定性解析
    notice.ts             通知候选 → 调课草稿：匹配、校验、批量写入、撤销
    weekSummary.ts        本周变化摘要
  store/                持久化、数据迁移、备份、应用状态、服务状态
  ocr/                  识别适配器（HTTP → 自家服务端）
  components/ pages/    界面
tests/                  单元与集成测试
```

## 三个功能的实现要点

### 1. 真实截图识别

服务端可通过 Anthropic SDK、OpenAI Responses API 或 OpenAI Chat Completions API 把截图转成 `TimetableEntry[]`。schema 里所有可缺字段都是 **nullable 而非 optional**，模型必须显式给出 `null` 表示「图片上没有这个信息」——配合提示词里的硬约束，保证不自行补全。图片没写周次时 `weeksText` 为 `null`，核对页标记「周次待确认」，必须由用户确认，不会默认全学期。

同一门课的多个上课安排分别作为独立条目保留。服务确实能给出时还会带上 `sourceText`（该条在截图中的原文），核对页逐条展示，供与原图对照。

**识别服务没有提供可靠的区域坐标，因此没有做框选定位**——核对页改为提供原图缩放（100%–400%）加逐条原文对照，不伪造定位。

取消或超时会 abort 请求，服务端把信号传给上游中止调用；前端在发请求前、请求返回后都会再检查一次中止状态，迟到的结果不会覆盖已取消的草稿。

核对页把问题分成格式错误 / 信息缺失 / 识别不确定 / 时间冲突 / 疑似重复五类，顶部给出各类计数，有必填错误的条目排在最前。可以多选条目批量设置周次，应用前先列出受影响的条目和变更前后对照。

OpenAI 兼容网关需要支持图片输入和 JSON Schema Structured Outputs。如果网关只实现了基础文本对话接口，应用会明确报告模型返回异常。

### 2. 粘贴通知生成调课草稿

分工明确：**模型只负责理解文本**，给出课程称呼、日期原文、节次和它的初步解析；**课程匹配、日期换算、课程实例定位、冲突检查和最终写入全部由确定性代码完成**（`src/core/noticeDates.ts` 和 `src/core/notice.ts`）。

- 相对日期（今天/明天/本周四/下周二/第 N 周周 X/M 月 D 日）以用户填写的**通知发布日期**为基准，按「一周从周一开始」的教学周规则换算，并在界面上写明解析依据。裸「周四」这类没说明哪一周的表达会解析成发布日所在周，但标记为待确认。
- 课程简称用字序匹配（「高数」→「高等数学 A」）。匹配到多门时**不自动确定**，要求用户选择。
- 同一天有多节同名课时要求选择具体哪一节；通知写了原节次则自动缩小。
- 原日期没有对应课程、目标日期超出学期、缺少必要节次、一批里两项调整同一次课，都是必填问题，必须先处理。
- 时间冲突按既有产品规则只作提示，确认后仍可保存。
- 应用前基于**最新课表**重新校验，防止草稿过期；任何一项有问题则整批不写入，不会留下半份数据。
- 应用后可撤销本批变更。撤销只针对这批写入、且之后没被改动过的记录：被后续编辑改过或已删除的会跳过并明确说明，不会静默覆盖。

发给解析服务的上下文只有通知原文和课程名清单，不包含上课安排、教室和历史数据。

法定节假日调休不会被自动当成课表调整——提示词里明确禁止，通知必须写明课表变动。

### 3. 本周变化摘要

首页的「本周变化」卡片完全由本地课表规则计算（`src/core/weekSummary.ts`），不调用模型生成事实。

两类内容分开归类：

- **临时调整**：停课、换教室、调入、调出、一次性补课。
- **正常排课变化**：单双周切换（本周恢复 / 本周不排）、课程从本周开始、课程从本周起不再安排。

常规变化按「重复安排在哪些**教学周**生效」比较上周与本周，不比较日历日期，因此单双周的正常跳过会写成「本周不排」而不是「临时停课」。两类天然互斥：本周不排的安排不会产生课程实例，也就不会出现在临时调整里。

跨周调课在原周显示「调出」、目标周显示「调入」。第 1 教学周没有上周基线，不产出常规变化，避免把所有课程都报成新增。查看其他教学周时标题写明「第 N 周变化」，不会误称本周。

## 数据兼容

`AppData` 带 `schemaVersion`，加载本地数据和恢复备份时都会走 `src/store/migrate.ts`：

- v1（首版）数据没有 `schemaVersion`，重复安排可能缺 `rule` 字段 —— 迁移时补版本号，并从实际周次集合反推等价规则，实际周次不变。
- 结构损坏的撤销记录直接丢弃，撤销入口不可用好过错误回滚。
- 单学期本地数据和云端 JSON 会自动包装成多学期集合，原课程内容与周次不变。
- 备份格式版本升到 3，`formatVersion: 1`、`formatVersion: 2` 的旧单学期备份仍可恢复并自动升级；新版备份包含全部学期，高于当前版本的备份被拒绝，且不会覆盖已有课表。
- 撤销记录属于会话状态，不进备份。

## 测试

```bash
npm test
```

156 个用例，全部使用受控数据与响应，不依赖真实付费服务：

| 文件 | 覆盖 |
|---|---|
| `tests/acceptance.test.ts` | 原有 A01–A17 验收用例（回归） |
| `tests/ocr.test.ts` | 适配器数据映射、缺失周次不补全、非法返回/失败/超时/取消、批量设周次只影响选中条目、问题分类与排序 |
| `tests/notice.test.ts` | 相对日期基准、简称与多候选、缺时间、课程不存在、四类变更、冲突、重复提交、整批原子性、撤销不覆盖无关修改 |
| `tests/weekSummary.test.ts` | 单双周切换、课程开始与结束、临时停课与跨周调课、第 1 周、无变化、常规与临时去重 |
| `tests/compat.test.ts` | 旧数据加载、旧备份恢复、备份往返、既有功能不回归 |
| `tests/storage.test.ts` | 首次默认课表、学期与作息数据校验、只初始化一次、已有数据不覆盖 |
| `tests/sync.test.ts` | JSON 原子持久化、重启读取、删除标记、ETag 轮询、客户端数据校验 |
| `tests/server.test.ts` | 未配置拒绝、演示模式、两种 OpenAI 请求/响应格式、自定义配置、请求校验、频率限制、日志脱敏 |

### 排查“自定义配置却返回演示课程”

访问 `GET /api/health`，最新版服务端的响应必须包含
`supportedClientFormats: ["openai-responses", "openai-chat-completions"]`。如果没有，通常是 8787 端口仍被旧的 demo 进程占用；停止旧进程并重新运行 `npm run dev:api`。

启用前端自定义配置后，每次识别响应还必须声明 `execution.source: "client"`，且接口格式和模型 ID 与本次请求完全一致。前端会拒绝 demo、旧版或被代理剥离配置后的响应，避免固定样例进入核对页。

## 已知限制

- **真实识别尚未联调**：本仓库没有可用凭证，三种 `live` 模式的实际调用未经真实服务验证（两种 OpenAI wire format、数据映射、错误处理和契约都已用受控响应测过）。配置密钥后需要用真实课表截图跑一轮，据此再调提示词。
- 前端自定义 API Key 为会话级配置；关闭标签页后需要重新输入。这避免它进入长期本地存储，但不等同于硬件级密钥保护。
- 识别服务不返回区域坐标，核对页不提供框选定位。
- 演示模式的通知解析用的是几条正则，能力远不及真实模型，只用于跑通流程。
- 撤销记录只保留最近一批。
- 首版不提供课前通知、多账号隔离、并发编辑合并和日历导出。
