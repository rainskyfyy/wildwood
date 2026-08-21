#!/usr/bin/env bash
# M3.1 服务端 tick 准时性压测 — 1000 tick p99<16ms
#
# 用法: ./m31_stress_run.sh
# 输出: 1000 tick 实测 p50/p95/p99/p100,exit code 0 表示通过(默认 p99<16ms)
set -euo pipefail
cd "$(dirname "$0")"
cd ../..
go test -run 'TestM31_HubTick_TimingStress' -v ./room/
