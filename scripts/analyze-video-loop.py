import subprocess
import sys
from pathlib import Path

import numpy as np


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: analyze-video-loop.py <ffmpeg> <video>")
    ffmpeg = Path(sys.argv[1])
    video = Path(sys.argv[2])
    width, height, fps = 184, 104, 15
    command = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(video),
        "-vf", f"fps={fps},scale={width}:{height}:flags=area,format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    raw = subprocess.run(command, check=True, stdout=subprocess.PIPE).stdout
    frame_size = width * height
    frames = np.frombuffer(raw, dtype=np.uint8)
    frames = frames[: (frames.size // frame_size) * frame_size].reshape((-1, height, width)).astype(np.float32)
    if frames.shape[0] < fps * 5:
        raise RuntimeError("video is too short for loop analysis")

    end = frames.shape[0] - 2
    window = fps
    candidates = []
    for period in range(fps, min(fps * 15, end - window)):
        start = end - period
        if start < window or start + 2 >= end:
            continue
        sequence_error = np.mean((frames[end - window:end] - frames[start - window:start]) ** 2)
        boundary_error = np.mean((frames[end - 1] - frames[start]) ** 2)
        end_velocity = frames[end - 1] - frames[end - 2]
        start_velocity = frames[start + 1] - frames[start]
        velocity_error = np.mean((end_velocity - start_velocity) ** 2)
        score = sequence_error + (boundary_error * 2.0) + velocity_error
        candidates.append((score, period / fps, start / fps, end / fps, sequence_error, boundary_error, velocity_error))

    print("score\tperiod_s\tstart_s\tend_s\tsequence\tboundary\tvelocity")
    for row in sorted(candidates)[:12]:
        print("\t".join(f"{value:.6f}" for value in row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
