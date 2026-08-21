#!/usr/bin/env python3
"""
t-code-04 LOD 内存节省估算脚本
沙箱内运行,验证 -60% 内存节省假设

输入: 无(参数都硬编码,改成 sys.argv 也行)
输出: 打印 NEIGHBOR / FAR / UNLOAD 各占多少帧 + 总节省百分比
"""
import sys
from typing import Dict, List, Tuple


# ===== 配置(与 GDScript 端 LOD_BANDS 对齐) =====
LOD_BANDS: Dict[str, Dict[str, int]] = {
    "NEIGHBOR": {"min": 0, "max": 1, "frames": 8},
    "FAR":      {"min": 2, "max": 4, "frames": 4},
    "UNLOAD":   {"min": 5, "max": 999, "frames": 0},
}
FRAME_BYTES = 256  # 16x16 PNG 压缩后约 256B


def chunk_distance(a: Tuple[int, int], b: Tuple[int, int]) -> int:
    """切比雪夫距离(8 方向),与 M2.7 9 宫格匹配"""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def classify_band(distance: int) -> str:
    if distance <= 1:
        return "NEIGHBOR"
    if distance <= 4:
        return "FAR"
    return "UNLOAD"


def simulate_3x3_grid(player: Tuple[int, int], total_radius: int = 10) -> Dict:
    """
    模拟以 player 为中心的 total_radius x total_radius 网格
    返回每个 chunk 的 band 分布
    """
    band_chunks: Dict[str, List] = {"NEIGHBOR": [], "FAR": [], "UNLOAD": []}
    for dx in range(-total_radius, total_radius + 1):
        for dy in range(-total_radius, total_radius + 1):
            chunk = (player[0] + dx, player[1] + dy)
            dist = chunk_distance(player, chunk)
            band = classify_band(dist)
            band_chunks[band].append(chunk)
    return band_chunks


def estimate_memory(band_chunks: Dict[str, List]) -> Dict:
    """计算内存占用"""
    total_frames_baseline = 0  # 全 8 帧(无 LOD)
    total_frames_lod = 0
    by_band_frames = {}

    for band, chunks in band_chunks.items():
        frames = LOD_BANDS[band]["frames"]
        chunk_count = len(chunks)
        total_frames_lod += chunk_count * frames
        total_frames_baseline += chunk_count * 8  # 假设无 LOD 时所有都是 8 帧
        by_band_frames[band] = {
            "chunks": chunk_count,
            "frames_per_chunk": frames,
            "total_frames": chunk_count * frames,
            "bytes": chunk_count * frames * FRAME_BYTES,
        }

    saved_bytes = (total_frames_baseline - total_frames_lod) * FRAME_BYTES
    saved_pct = (saved_bytes / (total_frames_baseline * FRAME_BYTES)) * 100 if total_frames_baseline > 0 else 0

    return {
        "by_band": by_band_frames,
        "total_frames_baseline": total_frames_baseline,
        "total_frames_lod": total_frames_lod,
        "saved_bytes": saved_bytes,
        "saved_pct": saved_pct,
    }


def main():
    # 默认: 中心 3x3 = 9 宫格,外扩 10 chunk
    player = (0, 0)
    radius = 10
    if len(sys.argv) >= 2:
        radius = int(sys.argv[1])

    band_chunks = simulate_3x3_grid(player, radius)
    mem = estimate_memory(band_chunks)

    print(f"=== t-code-04 LOD 内存估算 (radius={radius}) ===\n")
    print(f"  玩家中心: {player}")
    print(f"  模拟范围: {2*radius+1}x{2*radius+1} = {(2*radius+1)**2} chunks")
    print()
    print(f"  分布 (7:2:1 设计):")
    for band, info in mem["by_band"].items():
        print(f"    {band:10s}: {info['chunks']:4d} chunks × {info['frames_per_chunk']:2d} 帧 = {info['total_frames']:5d} 帧 ({info['bytes']/1024:.1f} KB)")
    print()
    print(f"  基线(全 8 帧): {mem['total_frames_baseline']:6d} 帧 ({mem['total_frames_baseline']*FRAME_BYTES/1024:.1f} KB)")
    print(f"  LOD 后:        {mem['total_frames_lod']:6d} 帧 ({mem['total_frames_lod']*FRAME_BYTES/1024:.1f} KB)")
    print(f"  节省:          {mem['saved_bytes']/1024:6.1f} KB ({mem['saved_pct']:.1f}%)")
    print()
    if mem["saved_pct"] >= 60:
        print(f"  ✓ 达成 ≥ 60% 内存节省目标 (t-code-04 验收)")
    else:
        print(f"  ✗ 未达 60% 节省 (差距: {60 - mem['saved_pct']:.1f}%)")
    print()

    # 验证 7:2:1 比例
    total_chunks = sum(info["chunks"] for info in mem["by_band"].values())
    if total_chunks > 0:
        print(f"  7:2:1 比例 (NEIGHBOR / FAR / UNLOAD):")
        for band, info in mem["by_band"].items():
            ratio = info["chunks"] / total_chunks
            print(f"    {band:10s}: {ratio*100:5.1f}% ({info['chunks']}/{total_chunks})")


if __name__ == "__main__":
    main()
