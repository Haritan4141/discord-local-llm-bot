"""Run one uniquely named integration benchmark on the already identified BLUE runtime.

Uses existing validation monitoring/audio helpers, never overwrites prior results.
No install, server start/stop, global interrupt, or Discord/API-key use.
"""
import argparse
import importlib.util
import json
import socket
import time
from pathlib import Path

import requests


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-root", required=True, type=Path)
    parser.add_argument("--workflow", required=True, type=Path)
    parser.add_argument("--case", required=True)
    args = parser.parse_args()
    if socket.gethostname().upper() != "DESKTOP-L9HAM1G":
        raise RuntimeError("BLUE only")
    if not args.case.replace("_", "").isalnum():
        raise ValueError("Unsafe case id")
    root = args.runtime_root.resolve()
    if str(root).lower() != r"C:\Users\Atsuki\Documents\Codex_workshop\yue2-blue-validation".lower():
        raise RuntimeError("Unexpected runtime root")
    folder = root / "integration-20260913" / args.case
    folder.mkdir(parents=True, exist_ok=False)
    spec = importlib.util.spec_from_file_location("baseline_benchmark", root / "scripts" / "benchmark.py")
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    monitor = baseline.Monitor(args.case)
    if monitor.path.exists():
        raise RuntimeError("Existing GPU log; use a new case id")
    workflow = json.loads(args.workflow.read_text(encoding="utf-8"))
    base = "http://127.0.0.1:8191"
    def api(path, payload=None):
        response = requests.get(base + path, timeout=20) if payload is None else requests.post(base + path, json=payload, timeout=20)
        response.raise_for_status()
        return response.json()
    def save(name, value):
        with (folder / name).open("x", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
    q = api("/queue")
    if q.get("queue_running") or q.get("queue_pending"):
        raise RuntimeError("Server busy")
    before = baseline.gpu_sample()  # helper verifies RTX3090 UUID
    save("workflow.json", workflow)
    monitor.thread.start()
    start = time.monotonic()
    result = {"case": args.case, "status": "RUNNING", "before_vram_mib": float(before[4])}
    try:
        submitted = api("/prompt", {"prompt": workflow, "client_id": "integration-" + args.case})
        save("submission.json", submitted)
        prompt_id = submitted["prompt_id"]
        print(json.dumps({"case": args.case, "prompt_id": prompt_id, "status": "submitted"}), flush=True)
        deadline = start + 1200
        while time.monotonic() < deadline:
            history = api("/history/" + prompt_id).get(prompt_id)
            if history and history.get("status", {}).get("completed"):
                break
            if history and history.get("status", {}).get("status_str") == "error":
                save("history.json", history)
                raise RuntimeError("ComfyUI execution error: " + str(history["status"]))
            time.sleep(2)
        else:
            raise TimeoutError("Validation wait exceeded20min; remote job NOT interrupted")
        save("history.json", history)
        result["metadata"] = history["outputs"]["result_metadata"]["yue2_result"][0]
        meta = result["metadata"]
        if not meta["metadataAvailable"] or not meta["abcNonempty"]:
            raise RuntimeError("Invalid YuE2 metadata / empty ABC")
        result["audio"] = []
        for node in ("save_mp3", "save_flac"):
            item = history["outputs"][node]["audio"][0]
            path = (root / "outputs" / item.get("subfolder", "") / item["filename"]).resolve()
            if not path.is_relative_to((root / "outputs").resolve()):
                raise RuntimeError("Unsafe output path")
            analysis = baseline.analyze_audio(path)
            analysis["node"] = node
            result["audio"].append(analysis)
        result["status"] = "PASS" if all(a["numeric_check"] == "PASS" for a in result["audio"]) else "FAIL_AUDIO"
    except Exception as error:
        result["status"] = "FAIL"
        result["error"] = str(error)
    finally:
        result["wall_seconds"] = round(time.monotonic() - start, 3)
        monitor.stop.set()
        monitor.thread.join(timeout=15)
        result["peak_vram_mib"] = max((float(s[4]) for s in monitor.samples), default=None)
        result["min_available_ram_mib"] = min((float(s[10]) for s in monitor.samples), default=None)
        result["monitor_errors"] = monitor.errors
        result["after_vram_mib"] = float(baseline.gpu_sample()[4])
        save("result.json", result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    if result["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
