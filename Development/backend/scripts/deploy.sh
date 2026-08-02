#!/bin/bash
# ═══════════════════════════════════════
# William — 阿里云 ECS 一键部署脚本
# CentOS / Alibaba Cloud Linux
# ═══════════════════════════════════════
set -e

echo "══════════════════════════════════"
echo "  William 部署脚本"
echo "══════════════════════════════════"

# ── 1. 安装基础依赖 ──
echo "[1/8] 安装系统依赖..."
yum update -y
yum install -y nginx git curl

# 安装 Node.js 20
if ! command -v node &>/dev/null; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  yum install -y nodejs
fi

# 安装 PM2
npm install -g pm2

echo "  Node: $(node -v) | npm: $(npm -v) | PM2: $(pm2 -v)"

# ── 2. 检查 MySQL ──
echo "[2/8] 检查 MySQL..."
if command -v mysql &>/dev/null; then
  echo "  MySQL 已安装"
else
  echo "  安装 MySQL 8..."
  yum install -y mysql-server
  systemctl start mysqld
  systemctl enable mysqld
fi

# ── 3. 创建数据库和用户 ──
echo "[3/8] 初始化数据库..."
echo "请输入 MySQL root 密码 (新安装可能为空,直接回车):"
read -s MYSQL_ROOT_PASS

mysql -u root ${MYSQL_ROOT_PASS:+-p$MYSQL_ROOT_PASS} <<SQL
CREATE DATABASE IF NOT EXISTS william_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'william'@'localhost' IDENTIFIED BY 'William@2026!';
GRANT ALL PRIVILEGES ON william_app.* TO 'william'@'localhost';
FLUSH PRIVILEGES;
SQL

# 导入 schema
mysql -u william -p'William@2026!' william_app < /var/www/william-server/sql/schema.sql
echo "  数据库 william_app 就绪"

# ── 4. 部署后端 ──
echo "[4/8] 部署后端..."
mkdir -p /var/www/william-server
mkdir -p /var/log/william

# 如果文件还没上传,提示
if [ ! -f /var/www/william-server/package.json ]; then
  echo "  ⚠ 请先上传后端代码到 /var/www/william-server/"
  echo "  方法: scp -r william-server/* root@your-server:/var/www/william-server/"
  exit 1
fi

cd /var/www/william-server
npm install --production

# 创建 .env (如果不存在)
if [ ! -f .env ]; then
  cat > .env <<ENV
PORT=3001
NODE_ENV=production
JWT_SECRET=$(openssl rand -hex 32)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=william
DB_PASS=William@2026!
DB_NAME=william_app
ANTHROPIC_API_KEY=sk-ant-请替换你的key
CORS_ORIGIN=*
ENV
  echo "  ⚠ 已生成 .env — 请编辑 /var/www/william-server/.env 填入 Anthropic API key"
fi

# ── 5. 启动后端 ──
echo "[5/8] 启动后端 (PM2)..."
cd /var/www/william-server
pm2 delete william-api 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "  后端运行在 http://127.0.0.1:3001"

# ── 6. 部署前端 ──
echo "[6/8] 部署前端..."
mkdir -p /var/www/william

if [ ! -f /var/www/william/dist/index.html ]; then
  echo "  ⚠ 请上传前端构建产物到 /var/www/william/dist/"
  echo "  本地执行: cd william-react && npm run build"
  echo "  然后: scp -r dist/* root@your-server:/var/www/william/dist/"
fi

# ── 7. 配置 Nginx ──
echo "[7/8] 配置 Nginx..."
cp /var/www/william-server/nginx/william.conf /etc/nginx/conf.d/william.conf

# 获取服务器公网 IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "your-server-ip")
sed -i "s/your-domain.com/${SERVER_IP}/" /etc/nginx/conf.d/william.conf

nginx -t && systemctl restart nginx
systemctl enable nginx

echo "  Nginx 配置完成"

# ── 8. 防火墙 ──
echo "[8/8] 开放端口..."
firewall-cmd --permanent --add-service=http 2>/dev/null || true
firewall-cmd --permanent --add-service=https 2>/dev/null || true
firewall-cmd --reload 2>/dev/null || true

echo ""
echo "══════════════════════════════════"
echo "  ✅ 部署完成!"
echo "══════════════════════════════════"
echo ""
echo "  前端: http://${SERVER_IP}"
echo "  API:  http://${SERVER_IP}/api/health"
echo ""
echo "  下一步:"
echo "  1. 编辑 /var/www/william-server/.env 填入 ANTHROPIC_API_KEY"
echo "  2. pm2 restart william-api"
echo "  3. 浏览器打开 http://${SERVER_IP} 测试"
echo ""
echo "  如果要配域名+HTTPS:"
echo "  yum install -y certbot python3-certbot-nginx"
echo "  certbot --nginx -d your-domain.com"
echo ""
