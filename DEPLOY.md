# DBwiki 部署手册

适用环境：宝塔面板（OpenCloudOS / CentOS 7+ / Ubuntu 22.04+），单台 1 核 2G 起步。
生产架构：

```
[浏览器] ─→ [宝塔 Nginx (80/443)] ─→ [PM2 (Node 18+, port 3000)] ─→ [better-sqlite3 (单文件 DB)]
                                            └── 同时托管 client/dist 静态资源
```

后端 Express 在 `NODE_ENV=production` 下会把 `client/dist/` 作为静态目录对外服务，
**所以只需部署一个 Node 进程 + 一个 Nginx 站点**。

---

## 1. 服务器准备

### 1.1 安装宝塔面板（若新机器）

```bash
# OpenCloudOS / CentOS
yum install -y wget && wget -O install.sh https://download.bt.cn/install/install_6.0.sh && sh install.sh ed8484bec

# Ubuntu / Debian
wget -O install.sh https://download.bt.cn/install/install-ubuntu_6.0.sh && sudo bash install.sh ed8484bec
```

安装完记录面板地址、用户名、密码。

### 1.2 宝塔商店一键装

- **Nginx**（必装）
- **PM2 管理器**（在「Node.js」或「运行环境」分类下；若商店没找到就用 §1.3 手动装）
- **Node.js 版本管理器** → 安装 Node 20 LTS（v18 / v20 均可，不低于 18）

### 1.3 手动装 PM2（如商店没有）

```bash
# 用宝塔的 Node 路径
export PATH=$PATH:/www/server/nodejs/bin
echo 'export PATH=$PATH:/www/server/nodejs/bin' >> /root/.bashrc

npm i -g pm2
pm2 -v   # 应输出 >= 5.x
```

### 1.4 系统依赖（better-sqlite3 + 可选 puppeteer）

```bash
# 编译原生模块
yum install -y gcc gcc-c++ make python3   # OpenCloudOS / CentOS
# apt install -y build-essential python3   # Ubuntu

# 若计划用 PDF 导出（puppeteer），需额外装：
yum install -y chromium nss at-spi2-atk libdrm libxkbcommon mesa-libgbm alsa-lib pango cairo gtk3
```

---

## 2. 创建站点（宝塔面板）

1. **网站** → **添加站点**
2. 域名：例如 `dbwiki.example.com`
3. 根目录：默认 `/www/wwwroot/dbwiki.example.com`（后面命令中记为 `$ROOT`）
4. 数据库：**不创建**（项目自带 SQLite）
5. PHP：纯静态

> **本手册后续假设 `ROOT=/www/wwwroot/dbwiki.example.com`**

---

## 3. 上传项目

### 方式 A：Git（推荐）

```bash
cd $ROOT
git clone <仓库地址> .
```

### 方式 B：压缩包

本地先打 zip（**不**含 `node_modules` / `data/` / `client/dist/` / `server/dist/`）：

```bash
# Windows PowerShell（项目根目录）
Compress-Archive -Path * -DestinationPath dbwiki.zip -Force
```

宝塔「文件」→ 上传到 `$ROOT` → 解压。

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

构建后必须看到：

```bash
ls client/dist/index.html   # 存在
ls server/dist/index.js     # 存在
ls server/dist/database/migrations/   # 应有 11 个 .js（无 .d.ts）
```

如果 `migrations/` 下有 `.d.ts` 文件，说明 `server/tsconfig.json` 的 `declaration` 是 `true` —— 当前配置已经是 `false`，如果是你自己改过的，把它改回 `false` 然后重新 `rm -rf server/dist && npm run build -w server`。

### 4.3 数据与日志目录

```bash
cd $ROOT
mkdir -p data logs
chown -R www:www data logs .   # 让 PM2（www 用户）能写
chmod 755 data logs
chmod 644 .env                  # www 用户可读
```

---

## 5. PM2 配置

### 5.1 `ecosystem.config.cjs`（已存在项目根目录）

```js
module.exports = {
  apps: [{
    name: 'dbwiki',
    script: './server/dist/index.js',       // 用编译后的 JS
    cwd: '/www/wwwroot/dbwiki.example.com',
    instances: 1,                           // SQLite 单文件，单实例
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    env_file: '.env',
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-err.log',
    merge_logs: true,
  }],
};
```

> 项目是 ESM（`"type": "module"`），PM2 配置用 `.cjs` 走 CommonJS 解析，最稳。

### 5.2 启动 + 开机自启

```bash
cd $ROOT
pm2 start ecosystem.config.cjs
pm2 save

# 开机自启（按提示执行输出的命令）
pm2 startup
# 一般会输出：sudo env PATH=... pm2 startup systemd -u root --hp /root
# 复制那行直接执行
```

### 5.3 验证

```bash
pm2 status                  # 状态应为 online
pm2 logs dbwiki --lines 50  # 应看到 [DB] Migrations / [Server] running
curl http://127.0.0.1:3000/api/health
# 期望：{"status":"ok","timestamp":"..."}
```

---

## 6. 故障排查（启动失败 80% 的原因）

### 6.1 `Script not found: .../server/dist/index.js`

文件存在但 PM2 报 not found —— **PM2 进程用的用户没有读权限**。

```bash
# 看 PM2 是哪个用户跑的
ps aux | grep -E "PM2|node" | grep -v grep

# 修复权限
chown -R www:www /www/wwwroot/dbwiki.example.com
chmod -R 755 /www/wwwroot/dbwiki.example.com
chmod 644 /www/wwwroot/dbwiki.example.com/.env

# 重新启动
pm2 kill
pm2 start ecosystem.config.cjs
```

### 6.2 `Invalid migration: 001_create_users.d.ts must have both an up and down function`

`tsc` 编译时生成了 `.d.ts` 声明文件，Knex 把它们当成迁移文件读了。**两种修法（项目已自带修法）**：

1. `server/tsconfig.json`：`"declaration": false`（项目默认）
2. `server/src/database/connection.ts`：`loadExtensions: ['.js']`（项目已加，运行时根据是否含 `/dist/` 自动切换）

如果还报，手动清理再重编：

```bash
cd $ROOT
rm -rf server/dist
npm run build -w server
rm -f server/dist/database/migrations/*.d.ts
rm -f server/dist/database/seeds/*.d.ts
pm2 restart dbwiki
```

### 6.3 `EADDRINUSE :::3000`

3000 端口被占用（常见于 docker 容器或宝塔自带的反代）。

```bash
# 看谁占了
ss -tlnp | grep 3000
# 是 docker
docker ps | grep 3000
docker stop <container_id>

# 或者换端口（修改 .env 的 PORT + ecosystem.config.cjs 的 env.PORT + nginx proxy_pass）
```

### 6.4 `Cannot find module 'tsx'` 或 `Cannot find module 'better-sqlite3'`

`npm install` 没跑完整，或 `--omit=dev` 把 natives 跳了（不应该，本项目 `better-sqlite3` 在 `dependencies`）。

```bash
cd $ROOT
rm -rf node_modules server/node_modules client/node_modules package-lock.json
npm install
```

### 6.5 迁移失败：`knex_migrations` 表已存在

之前初始化过一半的库，残留了表但 migrations 表不完整。

```bash
# 删掉旧 DB 重新跑迁移（会清空所有数据！）
cd $ROOT
rm -f data/dbwiki.sqlite3 data/dbwiki.sqlite3-shm data/dbwiki.sqlite3-wal
pm2 restart dbwiki
```

---

## 7. Nginx 反代

### 7.1 宝塔站点配置

宝塔「网站」→ 你的站点 → **设置** → **配置文件** → 替换为：

```nginx
server {
    listen 80;
    server_name dbwiki.example.com;

    # 强制 HTTPS（SSL 配好后开启）
    # return 301 https://$host$request_uri;

    client_max_body_size 50m;

    access_log /www/wwwlogs/dbwiki.example.com.access.log;
    error_log  /www/wwwlogs/dbwiki.example.com.error.log;

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
```

保存 → 重启 Nginx。

### 7.2 申请 SSL

宝塔站点 → **SSL** → **Let's Encrypt** → 申请 → 启用 → 开启 **强制 HTTPS**。

### 7.3 HTTPS 配置（申请后宝塔会自动改文件）

确认 `server { listen 443 ... }` 块里 `proxy_pass http://127.0.0.1:3000;` 还在即可。

### 7.4 防火墙

宝塔「安全」→ 放行 80 / 443。**不要**对外暴露 3000。

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
pm2 restart dbwiki
pm2 logs dbwiki --lines 50
```

### 9.2 查看日志

```bash
pm2 logs dbwiki                    # 实时
pm2 logs dbwiki --lines 200 --nostream   # 最近 200 行
tail -f $ROOT/logs/pm2-err.log
```

### 9.3 数据库备份（每天，宝塔「计划任务」）

```bash
# 方法 A：直接 cp（需先停服务，WAL 模式可能丢最后一笔）
pm2 stop dbwiki
cp $ROOT/data/dbwiki.sqlite3 /www/backup/dbwiki-$(date +%Y%m%d).sqlite3
pm2 start dbwiki

# 方法 B：sqlite3 在线热备（推荐，无停机）
which sqlite3 || yum install -y sqlite
sqlite3 $ROOT/data/dbwiki.sqlite3 ".backup /www/backup/dbwiki-$(date +%Y%m%d).sqlite3"
```

保留策略建议：7 天内每天一份 + 每周一份 + 每月一份，存到对象存储 / OSS。

### 9.4 还原数据库

```bash
pm2 stop dbwiki
cp /www/backup/dbwiki-20260619.sqlite3 $ROOT/data/dbwiki.sqlite3
chown www:www $ROOT/data/dbwiki.sqlite3
pm2 start dbwiki
```

### 9.5 监控（可选）

宝塔「PM2 管理器」自带 web 界面（`pm2-web`）：

```bash
pm2 install pm2-web
# 默认监听 8080
```

或装 Node 探针 + 宝塔「网站监控」做 HTTP 探活。

---

## 10. 升级 Node / 项目版本

```bash
# 升级 Node（宝塔「Node.js 版本管理器」切换）
# 注意：better-sqlite3 须重新编译以匹配新 Node 的 ABI
cd $ROOT
rm -rf node_modules server/node_modules client/node_modules
npm install
npm run build -w server
pm2 restart dbwiki
```

---

## 11. 常见问题速查

| 现象 | 排查命令 | 常见原因 |
|---|---|---|
| 502 Bad Gateway | `pm2 status` + `curl 127.0.0.1:3000/api/health` | Node 进程没起 / 端口错 |
| 前端空白 | F12 Network + `ls client/dist/index.html` | `client/dist` 没生成 |
| 登录 401 | `pm2 logs dbwiki \| grep JWT` | `.env` 密钥配错 |
| 导出 PDF 503 | `pm2 logs dbwiki \| grep puppeteer` | 服务器没装 chromium 依赖（先用 HTML 导出） |
| 同步数据库失败 | `curl 127.0.0.1:3000` → ping 目标 MySQL | 站点服务器到目标 DB 网络不通；host 用内网 IP |
| better-sqlite3 装不上 | `node -e "require('better-sqlite3')"` | 缺 `gcc g++ make python3` |
| 大量 `helmet` 警告 | 浏览器 DevTools Network | Express `cors` 跨域已配，没影响 |

---

## 12. 一键安装脚本（已测可用）

服务器上：

```bash
# 假设项目已上传到 /www/wwwroot/dbwiki.example.com
cd /www/wwwroot/dbwiki.example.com

# 1. 装依赖 + 构建
npm install
npm run build -w client
npm run build -w server

# 2. 数据目录
mkdir -p data logs
chown -R www:www data logs .
chmod 644 .env

# 3. 启动
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # 跟着执行它输出的那行

# 4. 验证
sleep 3
curl http://127.0.0.1:3000/api/health
pm2 logs dbwiki --lines 30
```

看到 `[DB] Migrations complete` + `[DB] Seeds complete` + `[Server] DBwiki running` + `/api/health` 200 = 部署完成。
