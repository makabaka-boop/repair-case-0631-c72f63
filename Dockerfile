# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# 先拷依赖清单，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 再拷源码
COPY . .

# 容器内 Vite 固定监听 5173；宿主机映射端口由 WEB_PORT 决定
EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
