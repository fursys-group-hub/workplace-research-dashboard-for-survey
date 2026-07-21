# 설문 대시보드 — Express 백엔드가 정적 프론트(프로젝트 루트)를 같은 오리진에서 서빙
FROM node:20-alpine
WORKDIR /app

# 프로젝트 전체 복사 (server/index.js 가 __dirname 기준 '..' = /app 을 정적 서빙하므로 구조 유지)
COPY . .

# 백엔드 의존성 설치 (Windows 에서 만든 lock 호환을 위해 npm install)
WORKDIR /app/server
RUN npm install --no-audit --no-fund

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1

CMD ["node", "index.js"]
