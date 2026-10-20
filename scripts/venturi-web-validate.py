#!/usr/bin/env python3
"""Compare the HTTP PNG path with native RGBA, then measure bounded seeks."""
import argparse
import fcntl
import hashlib
import json
import math
import pathlib
import statistics
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8790')
    parser.add_argument('--reference', required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--wait-seconds', type=int, default=300)
    parser.add_argument('--seeks', type=int, default=500)
    parser.add_argument('--seconds', type=int, default=60)
    args = parser.parse_args()
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    report = {'transport': 'halo2 loopback HTTP; excludes Windows network/display',
              'width': 960, 'height': 540, 'native_matches': [], 'errors': []}

    def get(route):
        return urllib.request.urlopen(args.url + '/api/v1/' + route, timeout=30)

    def wait_for_gpu():
        deadline = time.monotonic() + args.wait_seconds
        with open('/tmp/HALO_BENCHMARK.lock', 'a') as lock:
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(lock, fcntl.LOCK_UN)
                    return
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('GPU lock remained owned by another workload')
                    time.sleep(5)

    try:
        diagnostic = json.load(get('diagnostics'))['preview']
        report['adapter'] = diagnostic
        if diagnostic.get('device_id') != '0x7551' or diagnostic.get('software'):
            raise RuntimeError('R9700 Vulkan was not selected')
        wait_for_gpu()
        state = json.load(get('session'))
        if state['project_name'] != pathlib.Path(args.project).name:
            raise RuntimeError('Open the verification fixture before running this check')
        timeline = state['timelines'][0]
        query = dict(project_epoch=state['project_epoch'], if_generation=state['generation'],
                     timeline_id=timeline['id'], revision=timeline['revision'], width=960)

        def frame(number):
            started = time.perf_counter()
            data = get('preview/frame?' + urllib.parse.urlencode({**query, 'frame': number})).read()
            return data, (time.perf_counter() - started) * 1000

        for number in [0, 12, 36]:
            wait_for_gpu()
            png, _ = frame(number)
            image = output / f'frame-{number}.png'
            image.write_bytes(png)
            native = output / f'native-{number}.rgba'
            result = subprocess.run([args.reference, 'render', args.project, str(number),
                                     '960', str(native)], capture_output=True, text=True, timeout=30)
            if result.returncode:
                raise RuntimeError(result.stderr[-1000:])
            decoded = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(image),
                                      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
                                     capture_output=True, timeout=20, check=True).stdout
            reference = native.read_bytes()
            if decoded != reference:
                raise RuntimeError(f'Frame {number} differs from native RGBA')
            report['native_matches'].append({'frame': number, 'rgba_bytes': len(decoded),
                                            'sha256': hashlib.sha256(decoded).hexdigest(),
                                            'native_renderer': result.stdout.strip()})
        samples = []
        started = time.monotonic()
        for index in range(args.seeks):
            delay = started + index * args.seconds / args.seeks - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            try:
                _, elapsed = frame(index % 48)
                samples.append(elapsed)
            except urllib.error.HTTPError as error:
                report['errors'].append({'seek': index, 'status': error.code,
                                         'body': error.read().decode(errors='replace')})
        report['measured_seconds'] = time.monotonic() - started
        report['requests'] = args.seeks
        report['successful_frames'] = len(samples)
        report['p50_ms'] = statistics.median(samples) if samples else None
        report['p95_ms'] = sorted(samples)[math.ceil(len(samples) * .95) - 1] if samples else None
        report['complete'] = len(samples) == args.seeks and not report['errors']
        report['final_diagnostics'] = json.load(get('diagnostics'))
    except Exception as error:
        report['complete'] = False
        report['failure'] = str(error)
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report['complete'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
