# 网关镜像：第一段构建 walk-pad 前端，第二段 Nginx 托管静态文件并反代接口
FROM node:20-alpine AS walkpad
WORKDIR /build
COPY walk-pad/package*.json ./
RUN npm install --no-audit --no-fund
COPY walk-pad/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=walkpad /build/dist /usr/share/nginx/html
