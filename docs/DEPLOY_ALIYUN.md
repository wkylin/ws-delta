# 阿里云 ECS 部署与更新手册

本文记录 `ws-delta` 在阿里云 ECS 上的完整生产部署方案。当前约定如下：

- GitHub：`https://github.com/wkylin/ws-delta`
- 部署目录：`/opt/ws-delta`
- 公网域名：`https://ws.wkylin.cn`
- WebSocket：`wss://ws.wkylin.cn/gateway/ws/stream`
- 后端监听：`127.0.0.1:8088`
- 前端：Nginx 直接提供 `dist` 静态文件
- 后端：systemd 托管 Node.js 进程

## 1. 部署结构

```text
Browser
  |
  | HTTPS / WSS :443
  v
Nginx
  |-- /                         -> /opt/ws-delta/dist
  |-- /gateway/ws/stream        -> http://127.0.0.1:8088
  |-- /health, /metrics         -> http://127.0.0.1:8088
  `-- /v1/*, /api/*             -> http://127.0.0.1:8088
                                      |
                                      `-- ws-delta.service
```

阿里云安全组只需对外开放 `22`、`80` 和 `443`。不要开放 `8088`。

## 2. 环境准备

运行环境要求：

- Node.js 22 或更高版本
- pnpm 10 或更高版本
- Nginx
- Git

确认版本：

```bash
node --version
pnpm --version
nginx -v
git --version
```

如未安装 pnpm，可在 Node.js 安装完成后执行：

```bash
corepack enable
corepack prepare pnpm@10.30.3 --activate
```

## 3. 首次获取代码

```bash
sudo mkdir -p /opt/ws-delta
sudo chown -R "$USER":"$USER" /opt/ws-delta

git clone https://github.com/wkylin/ws-delta.git /opt/ws-delta
cd /opt/ws-delta
pnpm install --frozen-lockfile
```

当前后端通过 `tsx` 直接运行 TypeScript，因此不能使用 `pnpm install --prod`。

## 4. 后端环境变量

创建 `/opt/ws-delta/.env`：

```env
MOCK_REALTIME_HOST=127.0.0.1
MOCK_REALTIME_PORT=8088

MOCK_REALTIME_ALLOWED_ORIGINS=https://ws.wkylin.cn
MOCK_REALTIME_ALLOW_MISSING_ORIGIN=false

MOCK_REALTIME_REQUIRE_HELLO=false
MOCK_REALTIME_HEARTBEAT_MS=15000
MOCK_REALTIME_PING_INTERVAL_MS=15000

MOCK_REALTIME_MAX_CLIENT_MESSAGE_BYTES=16777216
MOCK_REALTIME_MAX_SERVER_MESSAGE_BYTES=16777216
MOCK_REALTIME_BUFFER_HIGH_WATER_BYTES=67108864
MOCK_REALTIME_BUFFER_CLOSE_BYTES=268435456
```

`.env` 用于后端运行时配置。不要将生产密钥提交到 Git。

## 5. 构建前端

Vite 会在构建阶段写入 WebSocket 和指标地址，因此生产构建必须显式提供正式域名：

```bash
cd /opt/ws-delta

VITE_WS_URL=wss://ws.wkylin.cn/gateway/ws/stream \
VITE_METRICS_URL=https://ws.wkylin.cn/metrics \
pnpm build
```

构建输出位于 `/opt/ws-delta/dist`。确认正式域名已进入构建产物：

```bash
grep -R "wss://ws.wkylin.cn" /opt/ws-delta/dist/assets
sudo chmod o+x /opt /opt/ws-delta
sudo chmod -R a+rX /opt/ws-delta/dist
```

## 6. 验证后端命令

首次配置 systemd 前，先直接运行：

```bash
cd /opt/ws-delta
pnpm exec tsx server/src/index.ts
```

正常输出：

```text
[mock-realtime] listening on http://127.0.0.1:8088 (ws path /gateway/ws/stream, heartbeat 15000ms)
```

在另一个终端验证：

```bash
curl -i http://127.0.0.1:8088/health
```

确认返回 `HTTP/1.1 200 OK` 后，按 `Ctrl+C` 停止手动进程。

## 7. 配置 systemd

先查询 Node.js 的绝对路径：

```bash
command -v node
```

如果返回 `/root/.nvm/versions/node/v22.17.0/bin/node`，创建 `/etc/systemd/system/ws-delta.service`：

```ini
[Unit]
Description=WS Delta Realtime Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/ws-delta
Environment=NODE_ENV=production
ExecStart=/root/.nvm/versions/node/v22.17.0/bin/node /opt/ws-delta/node_modules/tsx/dist/cli.mjs /opt/ws-delta/server/src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

必须将 `ExecStart` 开头的 Node.js 路径替换为 `command -v node` 的实际结果。这里直接调用 Node.js 和 `tsx`，避免 systemd 无法找到 NVM/pnpm 的问题。

加载并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ws-delta
sudo systemctl status ws-delta --no-pager
```

验证：

```bash
sudo systemctl is-active ws-delta
sudo ss -lntp | grep 8088
curl -i http://127.0.0.1:8088/health
```

## 8. 配置 Nginx

先找到域名已有的配置文件：

```bash
sudo grep -R "server_name.*ws.wkylin.cn" \
  /etc/nginx/conf.d \
  /etc/nginx/sites-enabled 2>/dev/null
```

修改现有的 HTTPS `server`，保留已经生效的证书路径。不要再创建一个相同域名的 HTTPS `server`。

```nginx
server {
    listen 443 ssl;
    server_name ws.wkylin.cn;

    # 保留服务器当前使用的证书配置
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    root /opt/ws-delta/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /gateway/ {
        proxy_pass http://127.0.0.1:8088;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8088;
    }

    location = /metrics {
        proxy_pass http://127.0.0.1:8088;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:8088;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8088;
    }
}

server {
    listen 80;
    server_name ws.wkylin.cn;
    return 301 https://$host$request_uri;
}
```

检查并加载配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

如 Nginx 返回 `502` 且 SELinux 为 enforcing，允许 Nginx 连接本地后端：

```bash
sudo setsebool -P httpd_can_network_connect 1
```

## 9. 部署验证

```bash
curl -I https://ws.wkylin.cn/
curl -i https://ws.wkylin.cn/health
curl -I https://ws.wkylin.cn/metrics
```

浏览器打开 `https://ws.wkylin.cn/`。页面建立 WebSocket 后，再检查：

```bash
curl -s https://ws.wkylin.cn/health
```

返回值中的 `connections` 和 `currentConnections` 应大于 `0`。

## 10. 升级前必须理解的地址与端口

生产环境和本地开发使用不同的访问方式：

| 地址 | 用途 | 是否对公网开放 |
| --- | --- | --- |
| `http://localhost:5180` | Vite 本地开发服务器，仅执行 `pnpm dev:frontend` 时存在 | 否 |
| `http://127.0.0.1:8088` | ECS 上的 Node.js HTTP/WebSocket 后端 | 否 |
| `https://ws.wkylin.cn` | Nginx 提供的生产页面、HTTP API 和 WebSocket 入口 | 是 |

生产环境不运行 Vite，因此升级后 `127.0.0.1:5180` 无法访问是正常现象。服务器内部用下面两个命令分别检查 Nginx 和后端：

```bash
curl -I http://127.0.0.1/
curl -i http://127.0.0.1:8088/health
```

不要把普通 `pnpm build` 生成的 `dist` 直接上传到生产服务器。未设置生产环境变量时，前端会把默认 WebSocket 地址构建为：

```text
ws://127.0.0.1:8088/gateway/ws/stream
```

浏览器中的 `127.0.0.1` 指访问者自己的电脑或手机，并不指 ECS。这样的页面虽然能够打开，但 WebSocket 和指标面板无法连接。

每次生产构建都必须执行：

```bash
VITE_WS_URL=wss://ws.wkylin.cn/gateway/ws/stream \
VITE_METRICS_URL=https://ws.wkylin.cn/metrics \
pnpm build
```

也可以将这两个变量保存到 `frontend/.env.production`，之后直接执行 `pnpm build`：

```bash
cp frontend/.env.production.example frontend/.env.production
pnpm build
```

`.env.production` 只负责告诉 Vite 生产页面连接哪个地址，不负责上传文件、切换服务器目录或回滚。当前文件只包含公开地址，不要将密钥放入其中。构建完成后按下方流程手动上传完整 `dist` 目录。

构建后必须确认正式 `wss://` 地址已经进入产物：

```bash
if ! grep -R "wss://ws.wkylin.cn/gateway/ws/stream" dist/assets; then
  echo "错误：dist 未包含正式 WebSocket 地址，禁止部署"
  exit 1
fi
```

部署静态文件时必须部署整个 `dist`，不要只覆盖 `index.html` 或只复制 `assets`。Vite 每次构建产生的带哈希文件名可能不同，混用两次构建的文件会导致页面白屏或资源 `404`。

## 11. 推荐的完整升级流程

这是默认使用的升级方式，适用于前端、后端、依赖或配置可能发生变化的版本。先在开发机提交并推送代码；服务器只能拉取已经推送的提交。

### 11.1 升级前检查

每次更新前先确认部署目录没有未提交的服务器本地改动：

```bash
cd /opt/ws-delta
git status --short
```

同时检查当前服务，记录升级前版本：

```bash
sudo systemctl is-active nginx
sudo systemctl is-active ws-delta
curl -fsS http://127.0.0.1:8088/health
git rev-parse HEAD
```

如果 `git status --short` 有输出，不要直接执行 `git pull` 或删除文件。先确认这些服务器本地改动是否需要保留。

### 11.2 拉取、检查并构建

确认工作区干净后执行：

```bash
cd /opt/ws-delta

# 保存本次更新前的提交，供回滚使用
sudo mkdir -p /var/lib/ws-delta
git rev-parse HEAD | sudo tee /var/lib/ws-delta/rollback-commit

git fetch origin
git pull --ff-only
pnpm install --frozen-lockfile

pnpm typecheck
pnpm test

# 构建到暂存目录，不直接改写 Nginx 正在使用的 dist
sudo rm -rf /opt/ws-delta/dist.next
VITE_WS_URL=wss://ws.wkylin.cn/gateway/ws/stream \
VITE_METRICS_URL=https://ws.wkylin.cn/metrics \
pnpm exec vite build --outDir ../dist.next --emptyOutDir

test -f dist.next/index.html
if ! grep -R "wss://ws.wkylin.cn/gateway/ws/stream" dist.next/assets; then
  echo "错误：dist 未包含正式 WebSocket 地址，停止部署"
  exit 1
fi

sudo chmod -R a+rX /opt/ws-delta/dist.next
```

`pnpm typecheck`、`pnpm test`、暂存目录构建或地址检查任意一项失败时都应停止，不要切换目录或重启服务。

### 11.3 重启并验证

验证通过后切换静态目录。切换使用目录重命名，避免 Nginx 读到半个构建结果：

```bash
sudo rm -rf /opt/ws-delta/dist.previous
sudo mv /opt/ws-delta/dist /opt/ws-delta/dist.previous
sudo mv /opt/ws-delta/dist.next /opt/ws-delta/dist
```

完整升级时重启后端：

```bash
sudo systemctl restart ws-delta

sudo systemctl is-active ws-delta
curl -fsS http://127.0.0.1:8088/health
curl -fsS https://ws.wkylin.cn/health
curl -I https://ws.wkylin.cn/
```

浏览器打开 `https://ws.wkylin.cn/`，确认右上角状态为 `Connected`。随后再次检查连接数：

```bash
curl -s https://ws.wkylin.cn/health
```

返回结果中的 `connections` 和 `currentConnections` 应大于 `0`。

仅代码和静态资源更新时，不需要重载 Nginx。只有修改了 Nginx 配置时才执行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 12. 仅更新前端 dist

只有确认本次版本不包含后端、依赖和运行时配置变更时，才使用此流程。该流程不需要执行 `systemctl restart ws-delta`，也不需要重载 Nginx。

### 12.1 在开发机生成生产包

在开发机的项目根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm typecheck

VITE_WS_URL=wss://ws.wkylin.cn/gateway/ws/stream \
VITE_METRICS_URL=https://ws.wkylin.cn/metrics \
pnpm build

if ! grep -R "wss://ws.wkylin.cn/gateway/ws/stream" dist/assets; then
  echo "错误：dist 未包含正式 WebSocket 地址，禁止上传"
  exit 1
fi

tar -C dist -czf ws-delta-dist.tar.gz .
scp ws-delta-dist.tar.gz <ECS用户>@<ECS地址>:/tmp/
```

将 `<ECS用户>` 和 `<ECS地址>` 替换为实际 SSH 用户及服务器地址。

### 12.2 在服务器完整替换 dist

不要在 Nginx 正在读取的 `dist` 目录中逐个覆盖文件。先解压到暂存目录，验证完成后再切换目录：

```bash
cd /opt/ws-delta

sudo rm -rf /opt/ws-delta/dist.next
sudo mkdir -p /opt/ws-delta/dist.next
sudo tar -xzf /tmp/ws-delta-dist.tar.gz -C /opt/ws-delta/dist.next
sudo chmod -R a+rX /opt/ws-delta/dist.next

test -f /opt/ws-delta/dist.next/index.html
if ! grep -R "wss://ws.wkylin.cn/gateway/ws/stream" /opt/ws-delta/dist.next/assets; then
  echo "错误：上传包未包含正式 WebSocket 地址，停止切换"
  exit 1
fi

sudo rm -rf /opt/ws-delta/dist.previous
sudo mv /opt/ws-delta/dist /opt/ws-delta/dist.previous
sudo mv /opt/ws-delta/dist.next /opt/ws-delta/dist
```

目录切换后验证：

```bash
sudo nginx -t
curl -I http://127.0.0.1/
curl -I https://ws.wkylin.cn/
curl -fsS https://ws.wkylin.cn/health
```

浏览器强制刷新并确认页面为 `Connected`。验证通过后可以删除上传包；暂时保留 `dist.previous` 作为前端回滚版本：

```bash
rm -f /tmp/ws-delta-dist.tar.gz
```

### 12.3 前端包快速回滚

如果新页面白屏、静态资源 `404` 或 WebSocket 地址错误，立即恢复上一个目录：

```bash
cd /opt/ws-delta
sudo mv dist "dist.failed.$(date +%Y%m%d%H%M%S)"
sudo mv dist.previous dist

curl -I http://127.0.0.1/
curl -I https://ws.wkylin.cn/
```

静态目录回滚不需要重启后端或 Nginx。

## 13. 完整更新失败回滚

查看更新前保存的提交：

```bash
cat /var/lib/ws-delta/rollback-commit
```

切换到该提交并重新部署：

```bash
cd /opt/ws-delta
git switch --detach "$(cat /var/lib/ws-delta/rollback-commit)"
pnpm install --frozen-lockfile

sudo rm -rf /opt/ws-delta/dist.next
VITE_WS_URL=wss://ws.wkylin.cn/gateway/ws/stream \
VITE_METRICS_URL=https://ws.wkylin.cn/metrics \
pnpm exec vite build --outDir ../dist.next --emptyOutDir

test -f dist.next/index.html
grep -R "wss://ws.wkylin.cn" dist.next/assets
sudo chmod -R a+rX /opt/ws-delta/dist.next
sudo rm -rf /opt/ws-delta/dist.previous
sudo mv /opt/ws-delta/dist /opt/ws-delta/dist.previous
sudo mv /opt/ws-delta/dist.next /opt/ws-delta/dist
sudo systemctl restart ws-delta
curl -fsS http://127.0.0.1:8088/health
```

回滚验证完成后，准备下一次更新前恢复主分支：

```bash
cd /opt/ws-delta
git switch main
git pull --ff-only
```

## 14. 日常运维命令

```bash
# 服务状态
sudo systemctl status ws-delta --no-pager

# 实时后端日志
sudo journalctl -u ws-delta -f

# 最近 100 行后端日志
sudo journalctl -u ws-delta -n 100 --no-pager

# Nginx 配置检查
sudo nginx -t

# Nginx 错误日志
sudo tail -f /var/log/nginx/error.log

# 本地与公网健康检查
curl -i http://127.0.0.1:8088/health
curl -i https://ws.wkylin.cn/health

# 查看监听端口
sudo ss -lntp | grep -E '80|443|8088'
```

## 15. 常见问题

### 上传 dist 后页面打不开或没有实时数据

按顺序执行：

```bash
# 1. Nginx 是否能读取首页
curl -I http://127.0.0.1/

# 2. 后端是否运行
curl -i http://127.0.0.1:8088/health

# 3. 公网入口是否正常
curl -I https://ws.wkylin.cn/
curl -i https://ws.wkylin.cn/health

# 4. 构建产物是否使用正式 WebSocket 地址
grep -R "wss://ws.wkylin.cn/gateway/ws/stream" /opt/ws-delta/dist/assets

# 5. 查看服务日志
sudo tail -n 100 /var/log/nginx/error.log
sudo journalctl -u ws-delta -n 100 --no-pager
```

判断方式：

- `127.0.0.1:5180` 无法访问：生产环境正常现象，不需要启动 Vite。
- `127.0.0.1/` 返回 `403`：检查 `/opt/ws-delta/dist` 权限。
- `127.0.0.1/` 返回 `404`：检查 `dist/index.html` 是否存在以及 Nginx 的 `root`。
- `127.0.0.1:8088/health` 失败：检查 `ws-delta.service`。
- 页面能打开但状态为 `Offline`：重点检查构建地址和 Nginx `/gateway/` WebSocket 代理。
- `dist/assets` 中没有正式 `wss://ws.wkylin.cn/gateway/ws/stream`：重新按生产环境变量构建，不要继续使用该 `dist`。

### systemd 显示 `pnpm: No such file or directory`

systemd 不会自动加载 NVM 的 shell 环境。按本文方案使用 Node.js 绝对路径直接运行 `node_modules/tsx/dist/cli.mjs`。

### systemd 显示 active，但 8088 拒绝连接

查看实际启动命令和日志：

```bash
sudo systemctl cat ws-delta
sudo journalctl -u ws-delta -n 100 --no-pager
```

先用 `pnpm exec tsx server/src/index.ts` 验证应用，再检查 systemd 中 Node.js 的绝对路径。

### 页面打开但 WebSocket 未连接

依次检查：

```bash
grep -R "wss://ws.wkylin.cn" /opt/ws-delta/dist/assets
curl -i https://ws.wkylin.cn/health
sudo journalctl -u ws-delta -f
sudo tail -f /var/log/nginx/error.log
```

确认 Nginx 的 `/gateway/` 配置包含 `Upgrade` 和 `Connection` 请求头。

### Nginx 返回 502

确认本地后端正常：

```bash
curl -i http://127.0.0.1:8088/health
```

如果本地正常，检查 Nginx 错误日志和 SELinux：

```bash
sudo tail -n 100 /var/log/nginx/error.log
getenforce
sudo setsebool -P httpd_can_network_connect 1
```

### Nginx 返回 403

```bash
sudo chmod o+x /opt /opt/ws-delta
sudo chmod -R a+rX /opt/ws-delta/dist
sudo tail -n 100 /var/log/nginx/error.log
```

## 16. 安全注意事项

- 不要在阿里云安全组中开放 `8088`。
- 生产环境只允许 `https://ws.wkylin.cn` 作为 WebSocket Origin。
- `/api/mock/*` 包含调试和事件注入接口。正式公网环境应通过 Nginx 限制来源或增加认证。
- `.env` 不应提交到 Git，也不应记录生产凭证。
- 单实例模式使用进程内事件总线和内存快照；需要多实例时再配置 Redis 或 Kafka。
