#!/usr/bin/env python
"""Render every results/*.json (written by run_cpu_whisper.py / run_cpu_onnx_asr.py / run_gpu.py)
as the markdown tables FINDINGS.md uses. Re-run any time after a benchmark to refresh the
numbers without re-running the models.

Usage: uv run scripts/report.py
"""
import json

from common import RESULTS_DIR


def main():
    results = []
    for p in sorted(RESULTS_DIR.glob("*.json")):
        results.append(json.loads(p.read_text()))

    if not results:
        print("no results yet in", RESULTS_DIR)
        return

    print("## Accuracy and load (FLEURS de_de utterances)\n")
    print("| model | device | WER (corpus) | WER (avg/utt) | load | disk |")
    print("|---|---|---:|---:|---:|---:|")
    for r in results:
        print(f"| {r['model']} | {r['device']} | "
              f"{fmt_pct(r.get('utterance_corpus_wer'))} | {fmt_pct(r.get('utterance_avg_wer'))} | "
              f"{fmt_s(r.get('load_s'))} | {fmt_mb(r.get('disk_mb'))} |")

    print("\n## Long files: RTF, wall time, peak RAM\n")
    print("| model | file | duration | wall | RTF | WER | peak RSS | CPU% |")
    print("|---|---|---:|---:|---:|---:|---:|---:|")
    for r in results:
        for lf in r.get("long_files", []):
            if "error" in lf:
                print(f"| {r['model']} | {lf['label']} | {fmt_s(lf.get('duration_s'))} | FAILED: {lf['error']} | | | | |")
                continue
            print(f"| {r['model']} | {lf['label']} | {fmt_s(lf.get('duration_s'))} | "
                  f"{fmt_s(lf.get('wall_s'))} | {lf.get('rtf', '')} | {fmt_pct(lf.get('wer'))} | "
                  f"{fmt_mb(lf.get('peak_rss_mb'))} | {fmt_pct1(lf.get('cpu_percent_avg'))} |")


def fmt_pct(x):
    return f"{x*100:.1f}%" if x is not None else "-"


def fmt_pct1(x):
    return f"{x:.0f}%" if x is not None else "-"


def fmt_s(x):
    return f"{x:.1f}s" if x is not None else "-"


def fmt_mb(x):
    return f"{x:.0f} MB" if x is not None else "-"


if __name__ == "__main__":
    main()
