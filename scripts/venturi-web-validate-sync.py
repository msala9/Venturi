#!/usr/bin/env python3
"""Check the synthetic five-minute native export; FFmpeg is diagnostic only."""
import argparse
import array
import json
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("path")
parser.add_argument("--renderer-label", default="unverified")
args = parser.parse_args()
probe = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", args.path,
]))
video = subprocess.check_output([
    "ffmpeg", "-v", "error", "-i", args.path, "-an", "-vf", "scale=1:1:flags=area",
    "-pix_fmt", "gray", "-f", "rawvideo", "-",
])
flashes = [i for i, value in enumerate(video)
           if value > 128 and (i == 0 or video[i - 1] <= 128)]
process = subprocess.Popen([
    "ffmpeg", "-v", "error", "-i", args.path, "-vn", "-ac", "1", "-ar", "48000",
    "-f", "f32le", "-",
], stdout=subprocess.PIPE)
onsets, sample, last = [], 0, -48000
while chunk := process.stdout.read(192000):
    for value in array.array("f", chunk):
        if abs(value) > 0.018:
            if sample - last > 24000:
                onsets.append(sample / 48000)
            last = sample
        sample += 1
if process.wait() != 0:
    raise SystemExit("Audio decoding failed")
errors = [abs(audio - frame / 24) * 24 for audio, frame in zip(onsets, flashes)]
result = dict(renderer=args.renderer_label, video_frames=len(video), audio_samples=sample,
              flash_frames=flashes, audio_onset_seconds=onsets, av_error_frames=errors,
              streams=[{key: stream.get(key) for key in ["codec_name", "codec_type", "width",
                       "height", "r_frame_rate", "sample_rate", "channels", "duration", "nb_frames"]}
                       for stream in probe["streams"]])
print(json.dumps(result, indent=2))
if len(video) != 7200 or len(flashes) != 5 or len(onsets) != 5 or max(errors) >= 1:
    raise SystemExit("Synthetic A/V frame count or synchronization failed")
