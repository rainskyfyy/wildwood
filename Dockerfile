# syntax=docker/dockerfile:1.7
## Wildwood M1.9 — Go 房间服务 Dockerfile
##
## 多阶段构建:
##   stage 1 (build): golang:1.22-alpine,编译 CGO_ENABLED=0 静态二进制
##   stage 2 (runtime): distroless/static,无 shell/包管理器,镜像 < 20MB
##
## 用法:
##   docker build -t wildwood/roomserver:dev .
##   docker run -p 8080:8080 wildwood/roomserver:dev
##
## 健康检查通过 /health 端点(200 OK)

# ---- stage 1: build ----
FROM golang:1.22-alpine AS build
WORKDIR /src

# 单独 COPY go.mod/go.sum 并下载依赖,利用 layer cache
COPY core/abstract/network/go/go.mod core/abstract/network/go/go.sum ./core/abstract/network/go/
WORKDIR /src/core/abstract/network/go
RUN go mod download

# 拷贝源码并编译
COPY core/abstract/network/go/ ./
RUN CGO_ENABLED=0 GOOS=linux go build \
        -trimpath \
        -ldflags="-s -w" \
        -o /out/roomserver \
        ./cmd/roomserver

# ---- stage 2: runtime ----
FROM gcr.io/distroless/static:nonroot
WORKDIR /app
COPY --from=build /out/roomserver /app/roomserver

# distroless nonroot 已是 UID 65532
USER nonroot:nonroot

EXPOSE 8080
ENTRYPOINT ["/app/roomserver"]
