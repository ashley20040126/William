#!/bin/bash
# William 一键部署脚本
# 用法: bash deploy.sh [build|up|down|logs|restart]
set -e

COMPOSE="docker compose"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$PROJECT_ROOT"

# 检查 .env 文件
check_env() {
  if [ ! -f ".env" ]; then
    echo "[ERROR] 根目录缺少 .env 文件，请先复制 .env.example 并填写配置："
    echo "  cp .env.example .env && vi .env"
    exit 1
  fi
  if [ ! -f "william_algorithm/rag/.env" ]; then
    echo "[ERROR] william_algorithm/rag/.env 不存在，请先复制并填写："
    echo "  cp william_algorithm/rag/.env.example william_algorithm/rag/.env && vi william_algorithm/rag/.env"
    exit 1
  fi
  if [ ! -f "william_algorithm/voice/.env" ]; then
    echo "[ERROR] william_algorithm/voice/.env 不存在，请先复制并填写："
    echo "  cp william_algorithm/voice/.env.example william_algorithm/voice/.env && vi william_algorithm/voice/.env"
    exit 1
  fi
  if [ ! -f "Development/backend/.env" ]; then
    echo "[ERROR] Development/backend/.env 不存在，请先复制并填写："
    echo "  cp Development/backend/.env.example Development/backend/.env && vi Development/backend/.env"
    exit 1
  fi
}

CMD="${1:-up}"

case "$CMD" in
  build)
    check_env
    echo "[INFO] 构建所有镜像..."
    $COMPOSE build --no-cache
    echo "[INFO] 构建完成"
    ;;
  up)
    check_env
    echo "[INFO] 启动所有服务..."
    $COMPOSE up -d --build
    echo "[INFO] 等待服务就绪..."
    sleep 5
    $COMPOSE ps
    echo ""
    echo "[INFO] 查看日志: bash deploy.sh logs"
    echo "[INFO] 访问地址: http://$(hostname -I | awk '{print $1}'):${EXPOSE_PORT:-80}"
    ;;
  down)
    echo "[INFO] 停止所有服务..."
    $COMPOSE down
    ;;
  restart)
    check_env
    echo "[INFO] 重启所有服务..."
    $COMPOSE down
    $COMPOSE up -d --build
    ;;
  logs)
    SERVICE="${2:-}"
    if [ -n "$SERVICE" ]; then
      $COMPOSE logs -f "$SERVICE"
    else
      $COMPOSE logs -f
    fi
    ;;
  status)
    $COMPOSE ps
    ;;
  *)
    echo "用法: bash deploy.sh [build|up|down|restart|logs [service]|status]"
    echo ""
    echo "  build    — 构建所有镜像（不启动）"
    echo "  up       — 构建并启动所有服务（默认）"
    echo "  down     — 停止并移除容器"
    echo "  restart  — 重新构建并启动"
    echo "  logs     — 查看日志（可指定服务名: frontend/backend/rag/voice/mysql）"
    echo "  status   — 查看容器状态"
    ;;
esac
