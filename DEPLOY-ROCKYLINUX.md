# DBwiki 部署手册（Rocky Linux + systemd）

适用环境：Rocky Linux 8.x / 9.x，单台 1 核 2G 起步。

生产架构：

```
[浏览器] ─→ [Nginx (80/443)] ─→ [systemd → Node.js (port 3000)] ─→ [better-sqlite3 (单文件 DB)]
                                        └── 同时托管 client/dist 静态资源
```

后端 Express 在 `NODE_ENV=production` 下会把 `client/dist/` 作为静态目录对外服务，
**所以只需部署一个 Node 进程 + 一个 Nginx 站点**。

---

## 1. 服务器准备

### 1.1 系统更新

```bash
dnf update -y
```

### 1.2 安装 Node.js 20 LTS

```bash
# 添加 NodeSource 仓库（Rocky Linux 使用 RHEL 系仓库）
dnf install -y dnf-plugins-core
dnf module list nodejs

# 方式 A：NodeSource 官方仓库（推荐）
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

# 方式 B：dnf 模块流（Rocky 9 默认提供）
dnf module install -y nodejs:20

# 验证
node -v    # 应输出 v20.x.x
npm -v     # 应输出 10.x.x
```

### 1.3 安装编译依赖（better-sqlite3 原生模块需要）

```bash
dnf groupinstall -y "Development Tools"
dnf install -y python3
```

### 1.4 安装 Nginx

```bash
dnf install -y nginx
systemctl enable nginx
systemctl start nginx

# 验证
systemctl status nginx
curl http://127.0.0.1
```

### 1.5 安装 SQLite（备份用）

```bash
dnf install -y sqlite
```

### 1.6 防火墙配置

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

# 确认规则已生效
firewall-cmd --list-services
```

> ⚠️ **不要**对外暴露 3000 端口。

---

## 2. 创建部署目录与用户

```bash
# 创建部署目录（本手册假设 /opt/dbwiki）
mkdir -p /opt/dbwiki

# 创建专用运行用户（无登录权限）
useradd -r -s /sbin/nologin -d /opt/dbwiki dbwiki

# 后续所有路径以此为准
export ROOT=/opt/dbwiki
```

---

## 3. 上传项目

### 方式 A：Git（推荐）

```bash
cd $ROOT
git clone <仓库地址> .
```

### 方式 B：压缩包

本地先打 zip（**不**含 `node_modules/` / `data/` / `client/dist/` / `server/dist/`）：

```bash
# Windows PowerShell（项目根目录）
Compress-Archive -Path * -DestinationPath dbwiki.zip -Force
```

上传到服务器：

```bash
# 服务器端
cd $ROOT
# 用 scp / rsync / rz 等方式上传 dbwiki.zip 到 $ROOT
unzip dbwiki.zip -d .
rm dbwiki.zip
```

### 不要上传的目录（`.gitignore` 已自动排除）

| 目录 / 文件 | 原因 |
|---|---|
| `node_modules/` | 服务器端 `npm install` 生成 |
| `data/*.sqlite3` | 本地开发数据，覆盖会清空线上库 |
| `client/dist/` | 服务器端 `npm run build -w client` 生成 |
| `server/dist/` | 服务器端 `npm run build -w server` 生成 |
| `logs/` `.pids/` `.env` | 本地配置 |

---

## 4. 服务端配置

### 4.1 生产环境变量 `$ROOT/.env`

```bash
cd $ROOT
cp .env.production.example .env
```

编辑 `.env`，填入真实值：

```ini
# ==== 必填 ====
JWT_SECRET=<32 位随机字符串>
ENCRYPTION_KEY=<32 位随机字符串>

# ==== 建议 ====
DB_PATH=./data/dbwiki.sqlite3
PORT=3000
CLIENT_URL=https://dbwiki.example.com
NODE_ENV=production
```

**生成两个密钥**（务必与本地开发环境不同）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 复制输出，填到 JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 复制输出，填到 ENCRYPTION_KEY
```

> ⚠️ **密钥丢失 = 全部用户登录态失效 + 加密的数据库密码不可解**。请把密钥另存一份在密码管理器。

### 4.2 安装依赖 + 构建

```bash
cd $ROOT
npm install                 # 注意：必须装 devDeps，里面有 tsc / vite
npm run build -w client     # → client/dist/
npm run build -w server     # → server/dist/
```

构建后必须确认：

```bash
ls client/dist/index.html   # 存在
ls server/dist/index.js     # 存在
ls server/dist/database/migrations/   # 应有 12 个 .js（无 .d.ts）
```

如果 `migrations/` 下有 `.d.ts` 文件，说明 `server/tsconfig.json` 的 `declaration` 是 `true` —— 当前配置已经是 `false`，如果是你自己改过的，把它改回 `false` 然后重新构建：

```bash
rm -rf server/dist && npm run build -w server
```

### 4.3 数据与日志目录

```bash
cd $ROOT
mkdir -p data logs
chown -R dbwiki:dbwiki $ROOT
chmod 750 $ROOT/data $ROOT/logs
chmod 640 $ROOT/.env                     # dbwiki 用户可读
```

---

## 5. systemd 服务配置

不使用 PM2，改用 systemd 管理 Node 进程。

### 5.1 创建服务文件

创建 `/etc/systemd/system/dbwiki.service`：

```bash
cat > /etc/systemd/system/dbwiki.service << 'EOF'
[Unit]
Description=DBwiki - Data Dictionary Management System
Documentation=https://github.com/your-org/dbwiki
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dbwiki
Group=dbwiki
WorkingDirectory=/opt/dbwiki
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/dbwiki/.env
ExecStart=/usr/bin/node /opt/dbwiki/server/dist/index.js
Restart=on-failure
RestartSec=5s
StartLimitInterval=60s
StartLimitBurst=10

# 安全加固（可选）
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/dbwiki/data /opt/dbwiki/logs
ReadOnlyPaths=/opt/dbwiki

# 日志
StandardOutput=append:/opt/dbwiki/logs/app-out.log
StandardError=append:/opt/dbwiki/logs/app-err.log

[Install]
WantedBy=multi-user.target
EOF
```

> **注意**：`ReadWritePaths` 与 `ReadOnlyPaths` 同时使用 `ProtectSystem=strict` 时，`ReadOnlyPaths` 会使 `/opt/dbwiki` 下所有目录默认只读，仅 `/opt/dbwiki/data` 和 `/opt/dbwiki/logs` 可写。如果遇到权限问题，可去掉 `ProtectSystem=strict` 和 `ReadOnlyPaths` 行，保留基础的 `User=dbwiki` 即可。

### 5.2 加载并启动

```bash
systemctl daemon-reload
systemctl enable dbwiki
systemctl start dbwiki
```

### 5.3 验证

```bash
systemctl status dbwiki                  # 状态应为 active (running)
journalctl -u dbwiki -f                  # 实时日志
curl http://127.0.0.1:3000/api/health
# 期望：{"status":"ok","timestamp":"..."}
```

---

## 6. Nginx 反向代理

### 6.1 创建站点配置

创建 `/etc/nginx/conf.d/dbwiki.conf`：

```bash
cat > /etc/nginx/conf.d/dbwiki.conf << 'EOF'
server {
    listen 80;
    server_name dbwiki.example.com;

    # 获取 SSL 证书后取消下面这行的注释以强制 HTTPS
    # return 301 https://$host$request_uri;

    client_max_body_size 50m;

    access_log /var/log/nginx/dbwiki.access.log;
    error_log  /var/log/nginx/dbwiki.error.log;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout  300s;
        proxy_send_timeout  300s;
    }
}
EOF
```

### 6.2 测试并重载 Nginx

```bash
nginx -t                                 # 检查语法
systemctl reload nginx
```

### 6.3 申请 SSL 证书（Let's Encrypt）

#### 安装 Certbot

```bash
# Rocky Linux 8
dnf install -y epel-release
dnf install -y certbot python3-certbot-nginx

# Rocky Linux 9
dnf install -y certbot python3-certbot-nginx
```

#### 申请证书

```bash
# 先确认域名 DNS 已指向服务器 IP
certbot --nginx -d dbwiki.example.com

# 按提示输入邮箱、同意协议即可
# Certbot 会自动修改 nginx 配置，添加 SSL 相关指令
```

#### 自动续期

```bash
# Certbot 会自动添加 systemd timer，验证一下
systemctl status certbot-renew.timer

# 手动测试续期
certbot renew --dry-run
```

---

## 7. SELinux 注意事项

Rocky Linux 默认启用 SELinux。如果 Nginx 反代返回 502，可能是 SELinux 阻止了 Nginx 连接本地的 Node 端口。

### 7.1 临时排查（确认是否是 SELinux 导致）

```bash
# 临时关闭 SELinux 测试
setenforce 0
# 访问站点，如果正常则说明是 SELinux 问题
# 测试完恢复
setenforce 1
```

### 7.2 永久放行（推荐）

```bash
# 允许 Nginx 发起网络连接（反向代理需要）
setsebool -P httpd_can_network_connect on

# 验证
getsebool httpd_can_network_connect
# 应输出：httpd_can_network_connect --> on
```

---

## 8. 首次登录

1. 浏览器打开 `https://dbwiki.example.com`
2. 默认管理员：`admin / admin123`（seed 写入）
3. **立刻**进「用户管理」→ 改 admin 密码、加新账号、禁用默认 admin

---

## 9. 日常运维

### 9.1 更新代码

```bash
cd $ROOT
git pull
npm install
npm run build -w client
npm run build -w server
systemctl restart dbwiki
systemctl status dbwiki
journalctl -u dbwiki -n 50
```

### 9.2 查看日志

```bash
# systemd 日志（实时）
journalctl -u dbwiki -f

# systemd 日志（最近 200 行）
journalctl -u dbwiki -n 200

# 文件日志
tail -f $ROOT/logs/app-err.log
tail -f $ROOT/logs/app-out.log

# Nginx 日志
tail -f /var/log/nginx/dbwiki.access.log
tail -f /var/log/nginx/dbwiki.error.log
```

### 9.3 服务管理

```bash
systemctl start dbwiki       # 启动
systemctl stop dbwiki        # 停止
systemctl restart dbwiki     # 重启
systemctl status dbwiki      # 查看状态
systemctl enable dbwiki      # 开机自启
systemctl disable dbwiki     # 取消开机自启
```

### 9.4 数据库备份（每天）

推荐用 systemd timer 或 crontab 定时执行。

#### 方式 A：crontab 定时备份

```bash
# 编辑 root 的 crontab
crontab -e

# 添加以下行（每天凌晨 3 点备份）
0 3 * * * sqlite3 /opt/dbwiki/data/dbwiki.sqlite3 ".backup /opt/backup/dbwiki-$(date +\%Y\%m\%d).sqlite3" && find /opt/backup -name "dbwiki-*.sqlite3" -mtime +7 -delete
```

先创建备份目录：

```bash
mkdir -p /opt/backup
```

#### 方式 B：手动备份

```bash
# 在线热备（推荐，无停机）
sqlite3 $ROOT/data/dbwiki.sqlite3 ".backup /opt/backup/dbwiki-$(date +%Y%m%d).sqlite3"

# 冷备（停服务，确保一致性）
systemctl stop dbwiki
cp $ROOT/data/dbwiki.sqlite3 /opt/backup/dbwiki-$(date +%Y%m%d).sqlite3
systemctl start dbwiki
```

保留策略建议：7 天内每天一份，保留 30 天内的每周一份。

### 9.5 还原数据库

```bash
systemctl stop dbwiki
cp /opt/backup/dbwiki-20260619.sqlite3 $ROOT/data/dbwiki.sqlite3
chown dbwiki:dbwiki $ROOT/data/dbwiki.sqlite3
chmod 640 $ROOT/data/dbwiki.sqlite3
systemctl start dbwiki
```

### 9.6 监控（可选）

```bash
# 使用 systemd 自带的健康检查
systemctl status dbwiki

# 添加简单的 HTTP 探活 cron
# crontab -e 添加：
*/5 * * * * curl -sf http://127.0.0.1:3000/api/health || systemctl restart dbwiki
```

---

## 10. 升级 Node / 项目版本

```bash
# 升级 Node（重新走 NodeSource 安装流程）
dnf remove -y nodejs
# 按 §1.2 重新安装新版本 Node

# better-sqlite3 须重新编译以匹配新 Node 的 ABI
cd $ROOT
rm -rf node_modules server/node_modules client/node_modules
npm install
npm run build -w server
systemctl restart dbwiki
```

---

## 11. 故障排查

### 11.1 systemd 启动失败

```bash
# 查看完整日志
journalctl -u dbwiki -n 100 --no-pager

# 检查服务文件语法
systemd-analyze verify /etc/systemd/system/dbwiki.service
```

### 11.2 `Script not found: .../server/dist/index.js`

文件存在但 Node 报 not found —— **dbwiki 用户没有读权限**。

```bash
# 确认 dbwiki 用户能访问
sudo -u dbwiki ls /opt/dbwiki/server/dist/index.js

# 修复权限
chown -R dbwiki:dbwiki /opt/dbwiki
chmod 750 /opt/dbwiki
chmod 640 /opt/dbwiki/.env
systemctl restart dbwiki
```

### 11.3 `Invalid migration: 001_create_users.d.ts must have both an up and down function`

`tsc` 编译时生成了 `.d.ts` 声明文件，Knex 把它们当成迁移文件读了。**项目已自带防护**：

1. `server/tsconfig.json`：`"declaration": false`（不生成 `.d.ts`）
2. `server/src/database/connection.ts`：生产环境只加载 `.js`

如果还报，手动清理再重编：

```bash
cd $ROOT
rm -rf server/dist
npm run build -w server
rm -f server/dist/database/migrations/*.d.ts
rm -f server/dist/database/seeds/*.d.ts
systemctl restart dbwiki
```

### 11.4 `EADDRINUSE :::3000`

3000 端口被占用。

```bash
# 看谁占了
ss -tlnp | grep 3000

# 常见：旧 dbwiki 进程没杀掉
kill -9 <PID>
systemctl restart dbwiki

# 或者换端口（修改 .env 的 PORT + nginx proxy_pass）
```

### 11.5 `Cannot find module 'tsx'` 或 `Cannot find module 'better-sqlite3'`

`npm install` 没跑完整。

```bash
cd $ROOT
rm -rf node_modules server/node_modules client/node_modules package-lock.json
npm install
npm run build -w server
systemctl restart dbwiki
```

### 11.6 Nginx 502 Bad Gateway

```bash
# 先确认 Node 进程在跑
systemctl status dbwiki
curl http://127.0.0.1:3000/api/health

# 如果 Node 正常但 Nginx 仍 502，检查 SELinux
getsebool httpd_can_network_connect
# 如果不是 on → 执行：
setsebool -P httpd_can_network_connect on
```

### 11.7 迁移失败：`knex_migrations` 表已存在

之前初始化过一半的库，残留了表但 migrations 表不完整。

```bash
# 删掉旧 DB 重新跑迁移（会清空所有数据！）
cd $ROOT
rm -f data/dbwiki.sqlite3 data/dbwiki.sqlite3-shm data/dbwiki.sqlite3-wal
systemctl restart dbwiki
```

---

## 12. 常见问题速查

| 现象 | 排查命令 | 常见原因 |
|---|---|---|
| 502 Bad Gateway | `systemctl status dbwiki` + `curl 127.0.0.1:3000/api/health` | Node 进程没起 / 端口错 / SELinux 拦截 |
| 前端空白 | F12 Network + `ls $ROOT/client/dist/index.html` | `client/dist` 没生成 |
| 登录 401 | `journalctl -u dbwiki \| grep JWT` | `.env` 密钥配错 |
| 导出 PDF 503 | `journalctl -u dbwiki \| grep puppeteer` | 服务器没装 chromium 依赖（先用 HTML 导出） |
| 同步数据库失败 | `curl 127.0.0.1:3000` → ping 目标 MySQL | 站点服务器到目标 DB 网络不通；host 用内网 IP |
| better-sqlite3 装不上 | `node -e "require('better-sqlite3')"` | 缺 `gcc g++ make python3`（§1.3） |
| Nginx 反代 502 + SELinux | `getsebool httpd_can_network_connect` | SELinux 默认禁止 httpd 网络连接（§7） |
| 大量 `helmet` 警告 | 浏览器 DevTools Network | Express `cors` 跨域已配，没影响 |

---

## 13. 一键安装脚本

服务器上（假设项目已上传到 `/opt/dbwiki`）：

```bash
#!/bin/bash
set -euo pipefail

ROOT=/opt/dbwiki
cd $ROOT

echo "=== 1. 安装系统依赖 ==="
dnf groupinstall -y "Development Tools"
dnf install -y python3 nginx sqlite certbot python3-certbot-nginx

echo "=== 2. 安装 Node.js 20 ==="
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
node -v

echo "=== 3. 安装项目依赖 + 构建 ==="
npm install
npm run build -w client
npm run build -w server

echo "=== 4. 创建目录与权限 ==="
mkdir -p data logs /opt/backup
useradd -r -s /sbin/nologin -d $ROOT dbwiki 2>/dev/null || true
chown -R dbwiki:dbwiki $ROOT
chmod 640 $ROOT/.env

echo "=== 5. 创建 systemd 服务 ==="
cat > /etc/systemd/system/dbwiki.service << 'SVC_EOF'
[Unit]
Description=DBwiki - Data Dictionary Management System
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dbwiki
Group=dbwiki
WorkingDirectory=/opt/dbwiki
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/dbwiki/.env
ExecStart=/usr/bin/node /opt/dbwiki/server/dist/index.js
Restart=on-failure
RestartSec=5s
StartLimitInterval=60s
StartLimitBurst=10
NoNewPrivileges=yes
PrivateTmp=yes
StandardOutput=append:/opt/dbwiki/logs/app-out.log
StandardError=append:/opt/dbwiki/logs/app-err.log

[Install]
WantedBy=multi-user.target
SVC_EOF

systemctl daemon-reload
systemctl enable dbwiki
systemctl start dbwiki

echo "=== 6. 配置防火墙 ==="
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

echo "=== 7. SELinux 放行 Nginx 反代 ==="
setsebool -P httpd_can_network_connect on

echo "=== 8. 验证 ==="
sleep 3
systemctl status dbwiki --no-pager
curl -s http://127.0.0.1:3000/api/health
echo ""
echo "=== 部署完成 ==="
echo "接下来："
echo "  1. 配置 Nginx 站点：/etc/nginx/conf.d/dbwiki.conf（参考手册 §6）"
echo "  2. 申请 SSL 证书：certbot --nginx -d dbwiki.example.com"
echo "  3. 浏览器打开 https://dbwiki.example.com 登录 admin/admin123"
```

看到 `[DB] Migrations complete` + `[DB] Seeds complete` + `[Server] DBwiki running` + `/api/health` 返回 200 = 部署完成。

---

## 附录 A：与宝塔面板部署的差异

| 维度 | 宝塔面板部署（DEPLOY.md） | Rocky Linux 部署（本文档） |
|---|---|---|
| 进程管理 | PM2 | systemd |
| Web 面板 | 宝塔面板 | 无（纯命令行） |
| Nginx 配置 | 宝塔 UI 操作 | 手动编辑配置文件 |
| SSL 证书 | 宝塔一键 Let's Encrypt | certbot 命令行 |
| 用户隔离 | www 用户 | dbwiki 专用用户 |
| 开机自启 | `pm2 startup` | `systemctl enable dbwiki` |
| 日志查看 | `pm2 logs` | `journalctl -u dbwiki` |

## 附录 B：systemd 常用命令速查

```bash
# 服务管理
systemctl start dbwiki          # 启动
systemctl stop dbwiki           # 停止
systemctl restart dbwiki        # 重启
systemctl reload dbwiki         # 重载配置（本服务不支持）
systemctl status dbwiki         # 状态
systemctl enable dbwiki         # 开机自启
systemctl disable dbwiki        # 取消自启
systemctl is-enabled dbwiki     # 是否已设置自启

# 日志
journalctl -u dbwiki            # 全部日志
journalctl -u dbwiki -f         # 实时跟踪
journalctl -u dbwiki -n 100     # 最近 100 行
journalctl -u dbwiki --since "2026-06-22"  # 按日期过滤
journalctl -u dbwiki -p err     # 仅错误级别

# 故障排查
systemctl list-units --failed   # 列出失败的服务
systemd-analyze verify /etc/systemd/system/dbwiki.service  # 检查服务文件
```
