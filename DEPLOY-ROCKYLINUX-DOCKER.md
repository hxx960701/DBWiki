# DBwiki 部署手册（Rocky Linux + Docker）

适用环境：Rocky Linux 8.x / 9.x，单台 1 核 2G 起步，Docker 20.10+。

生产架构：

```
[浏览器] ─→ [Nginx (80/443)] ─→ [Docker 容器 :3000] ─→ [better-sqlite3 (volume 持久化)]
                                        └── 同时托管 client/dist 静态资源
```

后端 Express 在 `NODE_ENV=production` 下会把 `client/dist/` 作为静态目录对外服务，**只需一个容器 + 一个 Nginx 站点**。

---

## 1. 服务器准备

### 1.1 系统更新

```bash
dnf update -y
```

### 1.2 安装 Docker

```bash
# 卸载旧版本（如有）
dnf remove -y docker docker-client docker-client-latest docker-common \
              docker-latest docker-latest-logrotate docker-logrotate \
              docker-engine podman runc

# 添加 Docker 官方仓库
dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo

# 安装 Docker Engine
dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动 Docker
systemctl enable docker --now
docker version
```

### 1.3 安装 Nginx

```bash
dnf install -y nginx
systemctl enable nginx --now
curl http://127.0.0.1
```

### 1.4 防火墙

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

> ⚠️ **不要**对外暴露 3000 端口。

---

## 2. 部署目录

```bash
export ROOT=/opt/dbwiki
mkdir -p $ROOT
```

---

## 3. 上传项目

### 方式 A：Git（推荐）

```bash
cd $ROOT
git clone <仓库地址> .
```

### 方式 B：压缩包

```bash
# 本机打包（不含 node_modules / data / dist）
cd $ROOT
# 上传 zip 后解压
unzip dbwiki.zip -d .
rm dbwiki.zip
```

---

## 4. 配置环境变量

```bash
cd $ROOT
cp .env.production.example .env
```

编辑 `.env`，填入真实值：

```ini
# ==== 必填 — 生成方式见下方 ===
JWT_SECRET=<32 位随机十六进制字符串>
ENCRYPTION_KEY=<32 位随机十六进制字符串>

# ==== 建议 ===
DB_PATH=./data/dbwiki.sqlite3
PORT=3000
CLIENT_URL=https://dbwiki.example.com
NODE_ENV=production
```

**生成两个密钥**（务必与开发环境不同）：

```bash
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 复制输出 → JWT_SECRET
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 复制输出 → ENCRYPTION_KEY
```

> ⚠️ **密钥丢失 = 全部登录态失效 + 已存数据库密码不可解**。请备份到密码管理器。

---

## 5. 构建并启动

```bash
cd $ROOT

# 构建镜像
docker compose build

# 后台启动
docker compose up -d
```

### 5.1 验证

```bash
# 容器状态
docker compose ps
# 期望：dbwiki 状态 Up

# 健康检查
docker compose exec dbwiki wget -qO- http://127.0.0.1:3000/api/health
# 期望：{"status":"ok","timestamp":"..."}

# 查看启动日志
docker compose logs dbwiki
# 应看到：[DB] Migrations complete + [DB] Seeds complete + [Server] DBwiki running
```

---

## 6. Nginx 反向代理

### 6.1 创建站点配置

```bash
cat > /etc/nginx/conf.d/dbwiki.conf << 'EOF'
server {
    listen 80;
    server_name dbwiki.example.com;

    # 获取 SSL 证书后取消下面这行注释
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

nginx -t && systemctl reload nginx
```

### 6.2 申请 SSL 证书（Let's Encrypt）

```bash
# 安装 certbot
dnf install -y epel-release certbot python3-certbot-nginx

# 确认域名 DNS 已指向服务器 IP，然后：
certbot --nginx -d dbwiki.example.com
# 按提示输入邮箱、同意协议

# 验证自动续期
systemctl status certbot-renew.timer
certbot renew --dry-run
```

---

## 7. SELinux 放行

Rocky Linux 默认启用 SELinux，Nginx 反代可能被拦截：

```bash
# 允许 Nginx 发起网络连接
setsebool -P httpd_can_network_connect on

# 验证
getsebool httpd_can_network_connect
# 应输出：httpd_can_network_connect --> on
```

---

## 8. 首次登录

1. 浏览器打开 `https://dbwiki.example.com`
2. 默认管理员：`admin / admin123`
3. **立刻**进「用户管理」→ 改 admin 密码、加新账号、禁用默认 admin

---

## 9. 日常运维

### 9.1 更新代码

```bash
cd $ROOT
git pull
docker compose up -d --build
docker compose logs --tail 50
```

### 9.2 查看日志

```bash
docker compose logs -f                    # 实时跟踪
docker compose logs --tail 200            # 最近 200 行
docker compose logs --since 10m           # 最近 10 分钟
```

### 9.3 容器管理

```bash
docker compose up -d       # 启动
docker compose down        # 停止并删除容器（数据 volume 保留）
docker compose restart     # 重启
docker compose ps          # 查看状态
docker compose pull        # 拉取新基础镜像（更新 Node 版本时）
```

### 9.4 数据库备份

#### 在线热备（推荐，不停机）

```bash
mkdir -p /opt/backup

# 从容器内直接热备
docker compose exec -T dbwiki sqlite3 /app/data/dbwiki.sqlite3 ".backup /tmp/backup.sqlite3"
docker compose cp dbwiki:/tmp/backup.sqlite3 /opt/backup/dbwiki-$(date +%Y%m%d).sqlite3
docker compose exec dbwiki rm /tmp/backup.sqlite3
```

#### crontab 定时备份

```bash
# 每天凌晨 3 点自动备份，保留 7 天
crontab -e

# 添加：
0 3 * * * cd /opt/dbwiki && docker compose exec -T dbwiki sqlite3 /app/data/dbwiki.sqlite3 ".backup /tmp/bak.sqlite3" && docker compose cp dbwiki:/tmp/bak.sqlite3 /opt/backup/dbwiki-$(date +\%Y\%m\%d).sqlite3 && docker compose exec dbwiki rm /tmp/bak.sqlite3 && find /opt/backup -name "dbwiki-*.sqlite3" -mtime +7 -delete
```

### 9.5 还原数据库

```bash
cd $ROOT
docker compose down

# 找到容器挂载的数据卷实际路径
docker volume inspect dbwiki_dbwiki_data | grep Mountpoint
# 假设输出：/var/lib/docker/volumes/dbwiki_dbwiki_data/_data

cp /opt/backup/dbwiki-20260619.sqlite3 \
   /var/lib/docker/volumes/dbwiki_dbwiki_data/_data/dbwiki.sqlite3

docker compose up -d
```

---

## 10. 监控（可选）

### 10.1 容器自带健康检查

Dockerfile 中已配置 `HEALTHCHECK`，每 30 秒探活一次：

```bash
docker inspect --format='{{.State.Health.Status}}' dbwiki
# 期望：healthy
```

### 10.2 外部 HTTP 探活

```bash
# crontab 每 5 分钟检测，异常自动重启
*/5 * * * * curl -sf http://127.0.0.1:3000/api/health || (cd /opt/dbwiki && docker compose restart)
```

---

## 11. 故障排查

### 11.1 容器起不来

```bash
# 看完整日志
docker compose logs dbwiki

# 进入容器调试
docker compose run --rm dbwiki sh

# 检查 .env 是否存在
ls -la $ROOT/.env
```

### 11.2 better-sqlite3 编译失败

构建阶段 `npm ci` 时报原生模块错误：

```bash
# 确认构建阶段安装了编译工具（Dockerfile 已包含）
# 如果报错，进入 builder 手动排查：
docker compose build --no-cache dbwiki
```

### 11.3 Nginx 502 Bad Gateway

```bash
# 确认容器在跑
docker compose ps

# 确认容器内部能响应
docker compose exec dbwiki wget -qO- http://127.0.0.1:3000/api/health

# 如果容器正常但 Nginx 仍 502，检查 SELinux
getsebool httpd_can_network_connect
# 如果输出 off → setsebool -P httpd_can_network_connect on
```

### 11.4 端口冲突

```bash
# 3000 端口被其他进程占用
ss -tlnp | grep 3000

# 解决方案：修改 docker-compose.yml 的端口映射
# "127.0.0.1:3001:3000" → Nginx proxy_pass 也同步改为 3001
```

### 11.5 数据卷权限问题

```bash
# 查看 volume 实际路径和权限
docker volume inspect dbwiki_dbwiki_data
ls -la /var/lib/docker/volumes/dbwiki_dbwiki_data/_data/

# 容器内以 dbwiki 用户（uid 1000）运行，目录应属于 1000:1000
```

### 11.6 迁移失败（knex_migrations 表已存在）

```bash
# 清空数据库重新初始化（会丢失所有数据！）
cd $ROOT
docker compose down
docker volume rm dbwiki_dbwiki_data
docker compose up -d
```

---

## 12. 常见问题速查

| 现象 | 排查命令 | 常见原因 |
|---|---|---|
| 502 Bad Gateway | `docker compose ps` + `docker compose exec dbwiki wget -qO- http://127.0.0.1:3000/api/health` | 容器未启动 / 端口错 / SELinux 拦截 |
| 前端空白 | `docker compose exec dbwiki ls /app/client/dist/index.html` | 构建阶段失败，dist 未生成 |
| 登录 401 | `docker compose logs dbwiki \| grep JWT` | `.env` 密钥与签发时不一致 |
| 同步数据库失败 | `docker compose exec dbwiki ping <目标数据库IP>` | 容器网络与目标 DB 不通；host 用宿主机可达的 IP |
| 构建阶段 `g++` 报错 | `docker compose build --no-cache` | Alpine 基础镜像缺少 build-essential |
| 更新代码后行为异常 | `docker compose up -d --build --force-recreate` | 缓存了旧的 dist 文件 |
| 容器内存超限被 kill | `docker stats dbwiki` | 增大 `deploy.resources.limits.memory` |
| 启动报 Permission denied | `docker volume inspect dbwiki_dbwiki_data` | volume 目录权限不是 1000:1000 |

---

## 13. 一键部署脚本

```bash
#!/bin/bash
set -euo pipefail

ROOT=/opt/dbwiki

# ==== 前提：项目已上传到 $ROOT ====

echo "=== 1. 安装 Docker ==="
dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker --now

echo "=== 2. 安装 Nginx ==="
dnf install -y nginx
systemctl enable nginx --now

echo "=== 3. 配置 .env（如尚未配置）==="
cd $ROOT
if [ ! -f .env ]; then
  cp .env.production.example .env
  echo ">>> 请编辑 $ROOT/.env 填入 JWT_SECRET 和 ENCRYPTION_KEY"
  echo ">>> 生成命令：docker run --rm node:20-alpine node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  exit 1
fi

echo "=== 4. 构建并启动 ==="
docker compose build
docker compose up -d

echo "=== 5. 防火墙 ==="
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

echo "=== 6. SELinux ==="
setsebool -P httpd_can_network_connect on

echo "=== 7. 验证 ==="
sleep 5
docker compose ps
docker compose exec dbwiki wget -qO- http://127.0.0.1:3000/api/health
echo ""
echo "=== 部署完成 ==="
echo "接下来："
echo "  1. 配置 Nginx：/etc/nginx/conf.d/dbwiki.conf（参考手册 §6）"
echo "  2. 申请 SSL：certbot --nginx -d dbwiki.example.com"
echo "  3. 浏览器打开 https://dbwiki.example.com 登录 admin/admin123"
```

看到 `[DB] Migrations complete` + `[DB] Seeds complete` + `/api/health` 返回 200 = 部署完成。

---

## 附录 A：Docker 常用命令速查

```bash
# 容器
docker compose ps                          # 容器状态
docker compose up -d                       # 启动（后台）
docker compose down                        # 停止 + 删除容器
docker compose restart                     # 重启
docker compose logs -f                     # 实时日志
docker compose exec dbwiki sh              # 进入容器

# 镜像
docker compose build                       # 构建
docker compose build --no-cache            # 无缓存构建
docker images                              # 镜像列表

# 数据卷
docker volume ls                           # 列出卷
docker volume inspect dbwiki_dbwiki_data   # 查看卷详情
docker volume prune                        # 清理未使用卷（小心！）

# 清理
docker system prune -a                     # 清理所有未使用资源
```

## 附录 B：三种部署方案对比

| 维度 | PM2（原 DEPLOY.md） | systemd（DEPLOY-ROCKYLINUX.md） | Docker（本文档） |
|---|---|---|---|
| 进程管理 | PM2 | systemd | Docker Engine |
| Node 版本管理 | 宝塔面板 | dnf 手动 | 镜像内置 |
| 依赖隔离 | 无 | 无 | 容器完全隔离 |
| 原生模块 | 手动装 gcc/make | 手动装 gcc/make | Dockerfile 内置 |
| 启动方式 | `pm2 start` | `systemctl start` | `docker compose up -d` |
| 日志 | `pm2 logs` | `journalctl` | `docker compose logs` |
| 更新 | git pull + npm install + build + restart | git pull + npm install + build + restart | `git pull && docker compose up -d --build` |
| 备份 | 直接 cp 文件 | 直接 cp 文件 | docker cp / volume mount |
| 迁移 | 需重装所有依赖 | 需重装所有依赖 | 拉镜像即跑 |
| 适用场景 | 宝塔面板用户 | 纯命令行运维 | 任何 Docker 环境 |
