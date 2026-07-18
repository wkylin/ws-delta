# ws-realtime

一个独立运行的 Vue 3 + WebSocket 实时看板示例。项目使用单一 `home.board` topic 演示快照、列表增量、数值增量、序列校验、断线重连和背压处理。

前端提供可操作的实时看板，服务端提供本地 mock、HTTP 调试接口和 WebSocket 推送。

## 功能

- 基于 Vue 3、Vite 和 TypeScript 的实时看板。
- 唯一订阅 topic：`home.board`。
- WebSocket 首次订阅下发 `topic_snapshot`，随后分别下发 `topic_delta` 和 `outcome_delta`。
- 客户端按 `streamId + seq` 校验顺序；发现序列缺口时自动发送 `resync`。
- 通过 `eventId + sourceMarketKey + sourceOutcomeCode` 定位增量，避免依赖展示文案。
- 支持订阅范围上报，服务端根据已加载和可见赛事缩小推送范围。
- 内置实时日志面板、背压控制和序列缺口模拟端点。
- 客户端使用 `eventId -> row` 与复合 outcome key 索引，避免高频增量更新时线性扫描赛事列表。
- 提供 `/metrics` Prometheus 风格指标，以及协议单测、WebSocket 集成测试和索引基准。
- 前端协议 inspector 内置 Gateway runtime 面板，定时读取 `/metrics` 并展示吞吐、恢复和背压状态。
- 看板筛选、赛事列表和下拉框均为独立 Vue 组件；主市场下拉支持键盘导航与 ARIA `listbox` 语义。

## 环境要求

- Node.js 22 或更高版本
- pnpm 10 或更高版本

## 快速开始

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:5180`。默认服务地址：

```text
HTTP      http://localhost:8088
WebSocket ws://localhost:8088/gateway/ws/stream
```

也可以分别启动：

```bash
pnpm dev:server
pnpm dev:frontend
```

## 常用命令

```bash
# 前后端类型检查
pnpm typecheck

# 构建前端静态资源
pnpm build

# 运行协议、索引和 WebSocket 集成测试
pnpm test

# 运行固定规模的线性查找 / Map 查找基准
pnpm benchmark

# 仅启动服务端
pnpm server

# 检查服务状态
curl http://127.0.0.1:8088/health

# 查看 Prometheus 指标
curl http://127.0.0.1:8088/metrics
```

## 协议

当前服务只接受 `home.board` 订阅。示例订阅消息：

```json
{
  "type": "subscribe",
  "items": [
    {
      "topic": "home.board",
      "moduleType": "HOME_MAIN_BOARD",
      "showScope": "all",
      "sportCode": "all",
      "groupMode": "league",
      "primaryMarketTabCode": "1x2",
      "pageNum": 1,
      "pageSize": 50
    }
  ]
}
```

消息流：

```text
subscribe
  -> topic_snapshot  看板基线数据与当前排序
  -> outcome_delta   高频数值变化
  -> topic_delta     低频状态、排序和集合变化

检测到 seq 缺口
  -> resync
  -> topic_snapshot  新基线数据
```

`topic_snapshot` 和 `topic_delta` 负责集合、顺序与赛事元数据；`outcome_delta` 只负责单项数值变化。客户端不会因高频变化替换整个赛事列表。

## HTTP 接口与调试

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 服务状态、连接数和协议版本 |
| `GET` | `/metrics` | Prometheus 风格的实时网关运行指标 |
| `GET` | `/v1/home/main-board` | 获取当前筛选条件下的看板 HTTP 数据 |
| `GET` | `/api/mock/realtime/state` | 查看连接、订阅范围与 mock 数据状态 |
| `GET` | `/api/mock/realtime/debug/home-board` | 查看解析后的看板查询条件 |
| `POST` | `/api/mock/realtime/controls/seq-gap` | 为已订阅 topic 注入序列缺口 |
| `POST` | `/api/mock/realtime/controls/backpressure` | 向已连接客户端发送背压通知 |
| `POST` | `/api/mock/realtime/emit/outcome-batch` | 立即发送一批数值变化 |
| `POST` | `/api/mock/realtime/emit/topic-mixed` | 立即发送一批看板结构变化 |

例如，为当前订阅注入一个序列缺口：

```bash
curl -X POST http://127.0.0.1:8088/api/mock/realtime/controls/seq-gap \
  -H 'Content-Type: application/json' \
  -d '{"item":{"topic":"home.board"},"skip":2}'
```

调试接口用于本地 mock 与集成测试；部署时应通过网络访问控制限制其可见范围。

## 可观测性与验证

`/health` 返回连接数、订阅数和当前网关指标；`/metrics` 返回可被 Prometheus 抓取的文本指标，覆盖消息量、字节数、重同步、背压、丢弃增量和慢消费者断开。

```bash
pnpm test
pnpm benchmark
```

基准脚本固定生成 2,000 个赛事和每场 12 个 outcome，对比线性查找与复合 `Map` 索引查找，并校验两种实现的结果一致。

## 配置

可在项目根目录创建 `.env` 覆盖默认配置：

```env
# 前端 WebSocket 地址
VITE_WS_URL=ws://127.0.0.1:8088/gateway/ws/stream

# 服务监听地址
MOCK_REALTIME_HOST=0.0.0.0
MOCK_REALTIME_PORT=8088

# 协议与连接控制
MOCK_REALTIME_REQUIRE_HELLO=false
MOCK_REALTIME_HEARTBEAT_MS=15000
MOCK_REALTIME_PING_INTERVAL_MS=15000
MOCK_REALTIME_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# 消息与背压限制
MOCK_REALTIME_MAX_CLIENT_MESSAGE_BYTES=16777216
MOCK_REALTIME_MAX_SERVER_MESSAGE_BYTES=16777216
MOCK_REALTIME_BUFFER_HIGH_WATER_BYTES=67108864
MOCK_REALTIME_BUFFER_CLOSE_BYTES=268435456

# 多实例运行时（默认不配置时使用进程内 bus / memory snapshot）
MOCK_REALTIME_INSTANCE_ID=ws-a
MOCK_REALTIME_REDIS_URL=redis://127.0.0.1:6379
MOCK_REALTIME_REDIS_CHANNEL=sports:realtime:events

# 或使用 Kafka 事件广播；每个实例会自动使用独立 consumer group
MOCK_REALTIME_KAFKA_BROKERS=127.0.0.1:9092
MOCK_REALTIME_KAFKA_TOPIC=sports.realtime.events
MOCK_REALTIME_KAFKA_GROUP_ID=sports-realtime-gateway
MOCK_REALTIME_SNAPSHOT_TTL_SECONDS=30
```

本地 mock 默认不要求鉴权。启用认证时，请使用 `wss://`，并避免将凭证写入前端源码或日志。

配置 `MOCK_REALTIME_REDIS_URL` 后，Redis 同时承担跨实例 Pub/Sub 和 snapshot TTL 缓存。配置 `MOCK_REALTIME_KAFKA_BROKERS` 后，Kafka 作为实时事件总线；每个网关实例使用带实例 ID 的独立 consumer group，确保同一事件广播到所有实例。Redis 和 Kafka 同时配置时优先使用 Kafka 事件总线，但仍使用 Redis snapshot store。

## 项目结构

```text
ws-realtime/
├── frontend/src/
│   ├── App.vue                       页面外壳与协议日志面板
│   ├── OddsBoard.vue                 看板组合组件
│   ├── realtime.ts                   WebSocket 生命周期与消息合并
│   ├── types.ts                      前端领域类型
│   └── components/
│       ├── AppSelect.vue             可访问的通用下拉组件
│       ├── BoardFilters.vue          看板筛选控件
│       └── BoardMatchList.vue        分组赛事列表
├── server/src/
│   ├── bootstrap.ts                  Koa、HTTP Server 与实时引擎装配
│   ├── config/runtime.ts             环境变量解析
│   ├── http/                         HTTP 中间件与路由
│   ├── protocol.ts                   `home.board` 协议与规范化
│   └── engine/
│       ├── boardStore.ts             mock 看板数据与增量生成
│       ├── wsGateway.ts              WebSocket 连接与消息派发
│       └── types.ts                  引擎内部类型
├── docs/ARCHITECTURE.md              消息流和可靠性设计
└── scripts/dev.mjs                   并行启动前后端
```

## 可靠性边界

- 服务端在缓冲区接近高水位时丢弃可恢复的增量并发送 `backpressure`；达到硬限制时主动断开慢客户端。
- 客户端收到乱序或缺失序列时不应用该帧，而是请求新的快照。
- 常规增量包应保持较小；配置中的 16 MiB 只是安全上限，不是目标消息大小。
- 同一 `home.board` 订阅内的序列和批次按连接独立维护；同一实体的中间变化应在发送前合并。
