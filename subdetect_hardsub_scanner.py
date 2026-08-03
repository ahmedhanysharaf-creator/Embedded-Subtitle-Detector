#!/usr/bin/env python3
"""
SubDetect PRO — Hardcoded (Burned-in) Subtitle Detector & Target Folder Automator
Uses FFmpeg to extract video frames across any format (.mkv, .mp4, .avi, .mov, etc.)
and analyzes subtitle pixel density & dark outlines in the lower 20% of video frames.
100% Pure Python Standard Library + FFmpeg.
"""

import os
import sys
import re
import json
import shutil
import subprocess
import argparse
from pathlib import Path

VIDEO_EXTENSIONS = {'.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.ts', '.m2ts', '.flv', '.wmv'}

def check_dependencies():
    """Verify python standard library environment and ffmpeg installation."""
    try:
        res = subprocess.run(['ffmpeg', '-version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0:
            print("❌ ERROR: FFmpeg is not found in system PATH.")
            print("Please install FFmpeg or add it to system PATH.")
            sys.exit(1)
    except FileNotFoundError:
        print("❌ ERROR: FFmpeg executable not found.")
        print("Please install FFmpeg to run the visual hardsub detector.")
        sys.exit(1)

def get_video_duration(video_path):
    """Retrieve duration in seconds using ffprobe or ffmpeg fallback."""
    cmd = [
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', str(video_path)
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode == 0 and res.stdout.strip():
            return float(res.stdout.strip())
    except Exception:
        pass

    # Fallback to ffmpeg output parsing
    cmd_ff = ['ffmpeg', '-i', str(video_path)]
    res = subprocess.run(cmd_ff, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    out = res.stderr
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+\.\d+)', out)
    if m:
        h, mn, s = m.groups()
        return float(h) * 3600 + float(mn) * 60 + float(s)
    return 1200.0  # Default fallback 20 min

def extract_frame_ppm(video_path, timestamp_sec):
    """
    Extract a single frame as binary P6 PPM using FFmpeg into stdout.
    Returns (width, height, rgb_bytes) or None on failure.
    """
    cmd = [
        'ffmpeg', '-loglevel', 'quiet', '-ss', f'{timestamp_sec:.2f}',
        '-i', str(video_path), '-vframes', '1', '-an',
        '-vf', 'scale=640:-1', '-f', 'image2', '-vcodec', 'ppm', '-'
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        data = res.stdout
        if not data or len(data) < 15:
            return None

        # Parse P6 header: "P6\n#...\nwidth height\n255\n<rgb_bytes>"
        pos = 0
        lines = []
        while len(lines) < 3 and pos < 200:
            next_nl = data.find(b'\n', pos)
            if next_nl == -1:
                break
            line = data[pos:next_nl].strip()
            pos = next_nl + 1
            if not line or line.startswith(b'#'):
                continue
            lines.append(line)

        if len(lines) < 3 or not lines[0].startswith(b'P6'):
            return None

        parts = lines[1].split()
        width = int(parts[0])
        height = int(parts[1])
        rgb_data = data[pos:]

        expected_size = width * height * 3
        if len(rgb_data) < expected_size:
            return None

        return width, height, rgb_data[:expected_size]
    except Exception:
        return None

def analyze_ppm_subtitles(width, height, rgb_bytes):
    """
    Analyze lower 20% of video frame for burned-in subtitle pixels.
    Detects white or yellow subtitle text with dark outline borders.
    """
    start_y = int(height * 0.80)
    end_y = int(height * 0.98)
    sub_h = end_y - start_y

    if sub_h <= 0 or width <= 0:
        return False, 0.0, 0.0

    total_sub_pixels = width * sub_h
    text_pixel_count = 0
    bordered_text_count = 0

    for y in range(start_y, end_y):
        row_offset = y * width * 3
        for x in range(0, width - 1):
            px_idx = row_offset + (x * 3)
            r = rgb_bytes[px_idx]
            g = rgb_bytes[px_idx + 1]
            b = rgb_bytes[px_idx + 2]

            # High-contrast White or Yellow text
            is_white = (r > 200 and g > 200 and b > 200)
            is_yellow = (r > 190 and g > 180 and b < 130)

            if is_white or is_yellow:
                text_pixel_count += 1
                next_px_idx = px_idx + 3
                nr = rgb_bytes[next_px_idx]
                ng = rgb_bytes[next_px_idx + 1]
                nb = rgb_bytes[next_px_idx + 2]
                if nr < 65 and ng < 65 and nb < 65:
                    bordered_text_count += 1

    text_ratio = text_pixel_count / total_sub_pixels
    border_ratio = bordered_text_count / total_sub_pixels

    # Subtitle frame condition
    has_subtitle = (text_ratio > 0.0030 and border_ratio > 0.0007)
    return has_subtitle, text_ratio, border_ratio

def save_preview_thumbnail(video_path, timestamp_sec, output_path):
    """Save frame preview thumbnail as JPEG."""
    cmd = [
        'ffmpeg', '-loglevel', 'quiet', '-ss', f'{timestamp_sec:.2f}',
        '-i', str(video_path), '-vframes', '1', '-an',
        '-vf', 'scale=480:-1', '-y', str(output_path)
    ]
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return output_path.exists()
    except Exception:
        return False

def scan_movie_file(video_path, report_dir):
    """
    Inspect a single movie across 11 sample timestamps (10% to 90% duration).
    Returns dictionary with detection results & best thumbnail path.
    """
    duration = get_video_duration(video_path)
    sample_percentages = [0.10, 0.18, 0.26, 0.34, 0.42, 0.50, 0.58, 0.66, 0.74, 0.82, 0.90]
    sample_times = [duration * p for p in sample_percentages]

    detected_sub_frames = 0
    best_sub_time = sample_times[3]
    max_score = -1.0

    for t_sec in sample_times:
        frame_res = extract_frame_ppm(video_path, t_sec)
        if frame_res:
            w, h, rgb_bytes = frame_res
            has_sub, t_ratio, b_ratio = analyze_ppm_subtitles(w, h, rgb_bytes)
            score = (b_ratio * 10.0) + t_ratio
            if score > max_score:
                max_score = score
                best_sub_time = t_sec

            if has_sub:
                detected_sub_frames += 1

    has_built_in_subs = (detected_sub_frames >= 1 or max_score > 0.005)

    # Save best frame thumbnail for visual HTML report
    thumb_name = f"thumb_{abs(hash(str(video_path))) % 1000000}.jpg"
    thumb_path = report_dir / thumb_name
    save_preview_thumbnail(video_path, best_sub_time, thumb_path)

    return {
        'path': str(video_path),
        'name': video_path.name,
        'size_mb': round(video_path.stat().st_size / (1024 * 1024), 2),
        'duration_min': round(duration / 60, 1),
        'has_subtitles': has_built_in_subs,
        'sub_frames_count': detected_sub_frames,
        'thumbnail': thumb_name
    }

def generate_html_report(results, report_dir):
    """Generate interactive visual HTML report."""
    report_file = report_dir / "subdetect_report.html"
    subtitled_count = sum(1 for r in results if r['has_subtitles'])
    no_sub_count = len(results) - subtitled_count

    cards_html = ""
    for r in results:
        status_class = "sub-has" if r['has_subtitles'] else "sub-none"
        status_label = "🟢 Built-in Subtitles Included" if r['has_subtitles'] else "🔴 No Subtitles"

        cards_html += f"""
        <div class="card {status_class}">
          <div class="thumb-box">
            <img src="{r['thumbnail']}" alt="Sample Frame" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'300\\' height=\\'170\\'><rect width=\\'100%\\' height=\\'100%\\' fill=\\'%231a253c\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%239ca3af\\' text-anchor=\\'middle\\'>No Thumbnail</text></svg>'">
            <span class="badge {status_class}">{status_label}</span>
          </div>
          <div class="card-info">
            <h3 title="{r['name']}">{r['name']}</h3>
            <p><strong>Size:</strong> {r['size_mb']} MB &bull; <strong>Duration:</strong> {r['duration_min']} mins</p>
            <p><strong>Subtitle Frames Detected:</strong> {r['sub_frames_count']} / 5 sampled</p>
          </div>
        </div>
        """

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SubDetect PRO — Hardcoded Subtitle Inspection Report</title>
  <style>
    body {{ background-color: #0b0f19; color: #f3f4f6; font-family: system-ui, sans-serif; padding: 2rem; margin: 0; }}
    h1 {{ color: #4f46e5; display: flex; align-items: center; gap: 0.5rem; }}
    .stats-bar {{ display: flex; gap: 1.5rem; margin: 1.5rem 0 2rem 0; }}
    .stat-box {{ background: rgba(18,26,43,0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem 1.5rem; flex: 1; }}
    .stat-box strong {{ font-size: 1.8rem; display: block; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }}
    .card {{ background: rgba(18,26,43,0.75); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }}
    .card.sub-has {{ border-color: rgba(16,185,129,0.4); }}
    .card.sub-none {{ border-color: rgba(239,68,68,0.4); }}
    .thumb-box {{ position: relative; width: 100%; height: 180px; background: #000; }}
    .thumb-box img {{ width: 100%; height: 100%; object-fit: cover; }}
    .badge {{ position: absolute; bottom: 8px; left: 8px; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }}
    .badge.sub-has {{ background: rgba(16,185,129,0.9); color: #fff; }}
    .badge.sub-none {{ background: rgba(239,68,68,0.9); color: #fff; }}
    .card-info {{ padding: 1rem; flex: 1; }}
    .card-info h3 {{ font-size: 1rem; margin: 0 0 0.5rem 0; word-break: break-word; }}
    .card-info p {{ font-size: 0.85rem; color: #9ca3af; margin: 0.2rem 0; }}
  </style>
</head>
<body>
  <h1>🎬 SubDetect PRO — Hardcoded Subtitle Inspection Report</h1>
  <div class="stats-bar">
    <div class="stat-box"><span>Total Movies Scanned</span><strong>{len(results)}</strong></div>
    <div class="stat-box" style="color: #10b981;"><span>Movies with Built-in Subtitles</span><strong>{subtitled_count}</strong></div>
    <div class="stat-box" style="color: #ef4444;"><span>Movies with No Subtitles</span><strong>{no_sub_count}</strong></div>
  </div>
  <div class="grid">
    {cards_html}
  </div>
</body>
</html>
"""
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(html_content)

    return report_file

def main():
    parser = argparse.ArgumentParser(description="SubDetect PRO — Hardcoded Subtitle Scanner & Target Folder Automator")
    parser.add_argument('--folder', type=str, default='.', help="Target movie folder path to scan")
    parser.add_argument('--category', type=str, choices=['subtitled', 'no-subtitles'], default=None, help="Category to organize ('subtitled' or 'no-subtitles')")
    parser.add_argument('--dest', type=str, default=None, help="Custom destination folder path or name")
    parser.add_argument('--copy', action='store_true', help="Copy files instead of moving")
    parser.add_argument('--organize', action='store_true', help="Automatically run target folder organization after scanning")
    args = parser.parse_args()

    check_dependencies()

    target_dir = Path(args.folder).resolve()
    if not target_dir.exists():
        print(f"❌ Error: Directory '{target_dir}' does not exist.")
        sys.exit(1)

    print(f"\n=======================================================")
    print(f"🎬 SubDetect PRO — Hardcoded (Burned-in) Subtitle Scanner")
    print(f"=======================================================")
    print(f"📂 Scanning Directory: {target_dir}\n")

    video_files = [p for p in target_dir.rglob('*') if p.suffix.lower() in VIDEO_EXTENSIONS and not 'Subtitled_Movies' in str(p) and not 'No_Subtitle_Movies' in str(p)]

    if not video_files:
        print("⚠️ No video files found in target directory.")
        sys.exit(0)

    print(f"🔍 Found {len(video_files)} video file(s). Inspecting frame pixels with FFmpeg...\n")

    report_dir = target_dir / "SubDetect_Report"
    report_dir.mkdir(exist_ok=True)

    results = []
    for idx, video_path in enumerate(video_files, 1):
        print(f"[{idx}/{len(video_files)}] Inspecting: {video_path.name} ... ", end='', flush=True)
        res = scan_movie_file(video_path, report_dir)
        results.append(res)

        if res['has_subtitles']:
            print("🟢 BUILT-IN SUBTITLES DETECTED")
        else:
            print("🔴 NO SUBTITLES")

    report_path = generate_html_report(results, report_dir)
    print(f"\n=======================================================")
    print(f"✅ Scanning Complete!")
    print(f"📊 Report Generated: {report_path}")

    subtitled_files = [r for r in results if r['has_subtitles']]
    no_sub_files = [r for r in results if not r['has_subtitles']]

    print(f"🟢 Movies with Built-in Subtitles: {len(subtitled_files)}")
    print(f"🔴 Movies with No Subtitles: {len(no_sub_files)}")
    print(f"=======================================================\n")

    # Interactive Target Folder Organization Prompt
    do_organize = args.organize
    if not do_organize:
        ans = input("❓ Would you like to organize files into a destination folder now? (y/n): ").strip().lower()
        if ans == 'y':
            do_organize = True

    if do_organize:
        cat_choice = args.category
        if not cat_choice:
            print("\nSelect Category to Organize:")
            print(f"  [1] Movies with Built-in Subtitles ({len(subtitled_files)} files)")
            print(f"  [2] Movies with No Subtitles ({len(no_sub_files)} files)")
            sel = input("Choice (1/2, default=1): ").strip()
            cat_choice = 'no-subtitles' if sel == '2' else 'subtitled'

        target_files = subtitled_files if cat_choice == 'subtitled' else no_sub_files
        default_folder_name = "Subtitled_Movies" if cat_choice == 'subtitled' else "No_Subtitle_Movies"

        if not target_files:
            print(f"\n⚠️ No files found in selected category: '{cat_choice}'. Skipping organization.")
            return

        dest_val = args.dest
        if not dest_val:
            dest_val = input(f"\nEnter Destination Folder Path/Name [default: {default_folder_name}]: ").strip()
            if not dest_val:
                dest_val = default_folder_name

        dest_dir = Path(dest_val)
        if not dest_dir.is_absolute():
            dest_dir = target_dir / dest_val
        dest_dir.mkdir(parents=True, exist_ok=True)

        is_copy = args.copy
        if not args.copy and not args.organize:
            act_sel = input("\nSelect Action: [1] Move Files (default)  [2] Copy Files: ").strip()
            if act_sel == '2':
                is_copy = True

        action_name = "Copying" if is_copy else "Moving"
        print(f"\n🚚 {action_name} {len(target_files)} movie(s) into: {dest_dir}")

        for r in target_files:
            src_p = Path(r['path'])
            dest_p = dest_dir / src_p.name
            try:
                if is_copy:
                    shutil.copy2(str(src_p), str(dest_p))
                    print(f"  └─ Copied: {src_p.name}")
                else:
                    shutil.move(str(src_p), str(dest_p))
                    print(f"  └─ Moved: {src_p.name}")
            except Exception as e:
                print(f"  └─ Error processing {src_p.name}: {e}")

        print("\n🎉 Target Folder Organization Complete!")

if __name__ == '__main__':
    main()
