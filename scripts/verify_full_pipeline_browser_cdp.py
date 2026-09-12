import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import websockets

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

EVIDENCE_DIR = Path("docs/evidence")
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

class CDPClient:
    def __init__(self, ws):
        self.ws = ws
        self._msg_id = 0
        self._pending = {}
        self.network_logs = []
        self._listen_task = asyncio.create_task(self._listen())

    async def _listen(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if "id" in msg and msg["id"] in self._pending:
                    self._pending[msg["id"]].set_result(msg)
                else:
                    method = msg.get("method", "")
                    if method == "Network.requestWillBeSent":
                        req = msg.get("params", {}).get("request", {})
                        url = req.get("url", "")
                        if "api/v1/" in url:
                            self.network_logs.append({
                                "type": "request",
                                "method": req.get("method"),
                                "url": url,
                                "has_post_data": "postData" in req,
                                "timestamp": time.time(),
                            })
                    elif method == "Network.responseReceived":
                        resp = msg.get("params", {}).get("response", {})
                        url = resp.get("url", "")
                        if "api/v1/" in url:
                            self.network_logs.append({
                                "type": "response",
                                "status": resp.get("status"),
                                "url": url,
                                "mimeType": resp.get("mimeType"),
                                "timestamp": time.time(),
                            })
        except Exception:
            pass

    async def send(self, method, params=None):
        self._msg_id += 1
        mid = self._msg_id
        fut = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        req = {"id": mid, "method": method}
        if params:
            req["params"] = params
        await self.ws.send(json.dumps(req))
        return await fut

    async def eval(self, expr):
        res = await self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True,
        })
        val = res.get("result", {}).get("result", {}).get("value")
        return val

    async def screenshot(self, filename):
        res = await self.send("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("result", {}).get("data", "")
        out_path = EVIDENCE_DIR / filename
        out_path.write_bytes(base64.b64decode(b64))
        print(f"   [Screenshot] Saved: {out_path}")
        return out_path

    async def close(self):
        self._listen_task.cancel()
        await self.ws.close()


async def run_audit():
    print("=" * 80)
    print("  🚀 FULL PIPELINE AUDIT WITH REAL CHROME CDP & REAL YOUTUBE WORKFLOW")
    print("=" * 80)

    # 1. Health check backend
    print("\n[Step 1] Checking Backend Health on port 8899...")
    health_url = "http://127.0.0.1:8899/api/v1/health"
    with urllib.request.urlopen(health_url, timeout=5) as resp:
        health_data = json.loads(resp.read().decode("utf-8"))
        print(f"   v Backend Healthy: HTTP {resp.status} - {health_data}")
        assert resp.status == 200, "Backend health check failed"

    # 2. Launch Chrome headless with CDP
    ud = tempfile.mkdtemp()
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    print(f"\n[Step 2] Launching Chrome Headless via CDP on port 9333...")
    chrome_proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--remote-debugging-port=9333",
        f"--user-data-dir={ud}",
        "--remote-allow-origins=*",
        "--window-size=1440,900",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
    ])

    cdp = None
    try:
        time.sleep(2)
        # Create new tab for http://127.0.0.1:8899/
        new_tab_url = "http://127.0.0.1:9333/json/new?http://127.0.0.1:8899/"
        req = urllib.request.Request(new_tab_url, method="PUT")
        with urllib.request.urlopen(req, timeout=5) as resp:
            tab_info = json.loads(resp.read().decode("utf-8"))
        ws_url = tab_info["webSocketDebuggerUrl"]
        print(f"   v Chrome Tab connected: {ws_url}")

        raw_ws = await websockets.connect(ws_url, max_size=20 * 1024 * 1024)
        cdp = CDPClient(raw_ws)

        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("DOM.enable")
        await cdp.send("Network.enable")

        print("   v Waiting 3s for React App to mount...")
        await asyncio.sleep(3)
        await cdp.screenshot("01_app_initial.png")

        # 3. Switch to Downloader -> Full Pipeline Tab
        print("\n[Step 3] Navigating to Full Pipeline Tab...")
        await cdp.eval("""
            (() => {
                const btn = document.querySelector('button[data-nav-id="downloader"]');
                if (btn) btn.click();
            })()
        """)
        await asyncio.sleep(1.5)

        await cdp.eval("""
            (() => {
                const tabBtn = document.getElementById('tab-pipeline-button');
                if (tabBtn) tabBtn.click();
            })()
        """)
        await asyncio.sleep(1.5)
        await cdp.screenshot("02_full_pipeline_tab.png")

        # 4. Failure path 1: Empty URL
        print("\n[Step 4] Testing Failure Path 1: Empty URL validation...")
        await cdp.eval("""
            (() => {
                const inp = document.getElementById('pipeline-url-input');
                if (inp) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, '');
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const btn = document.getElementById('pipeline-analyze-button');
                if (btn) btn.click();
            })()
        """)
        await asyncio.sleep(1)
        err_text = await cdp.eval("""
            (() => {
                const errBox = document.querySelector('[data-testid="pipeline-analyze-error"]');
                const modal = document.getElementById('pipeline-confirm-modal');
                const text = (errBox ? errBox.innerText : '') || document.body.innerText;
                const hasErr = text.includes('Vui lòng nhập');
                return {
                    has_error: hasErr,
                    error_message: errBox ? errBox.innerText : (hasErr ? text : null),
                    modal_opened: Boolean(modal)
                };
            })()
        """)
        print(f"   v Result: {err_text}")
        await cdp.screenshot("03_failure_empty_url.png")
        assert err_text and err_text.get("has_error"), f"Empty URL must display validation error: {err_text}"
        assert not err_text.get("modal_opened"), "Modal must not open on empty URL"

        # 5. Failure path 2: Invalid URL
        print("\n[Step 5] Testing Failure Path 2: Invalid / Unparseable URL...")
        await cdp.eval("""
            (() => {
                const inp = document.getElementById('pipeline-url-input');
                if (inp) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, 'invalid://bad-domain.xyz/none.mp4');
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                }
                const btn = document.getElementById('pipeline-analyze-button');
                if (btn) btn.click();
            })()
        """)
        await asyncio.sleep(2)
        err_disp = await cdp.eval("""
            (() => {
                const errBox = document.querySelector('[data-testid="pipeline-analyze-error"]');
                const modal = document.getElementById('pipeline-confirm-modal');
                const text = (errBox ? errBox.innerText : '') || document.body.innerText;
                const hasErr = text.includes('Không thể nhận diện') ||
                               text.includes('Không thể phân tích') ||
                               text.includes('không hợp lệ') ||
                               text.includes('invalid://');
                return {
                    has_error: hasErr,
                    error_message: errBox ? errBox.innerText : (hasErr ? text : null),
                    modal_opened: Boolean(modal)
                };
            })()
        """)
        print(f"   v Result: {err_disp}")
        await cdp.screenshot("04_failure_invalid_url.png")
        assert err_disp and err_disp.get("has_error"), f"Invalid URL must display an error message: {err_disp}"
        assert not err_disp.get("modal_opened"), "Modal must not open on invalid URL"
        assert err_disp.get("error_message"), f"Invalid URL must have specific error message, got: {err_disp}"

        # 6. Real Online YouTube Workflow Execution
        online_url = "https://www.youtube.com/watch?v=za4qeZiJZzY"
        print(f"\n[Step 6] Testing Happy Path: Real Online YouTube URL -> {online_url}")
        await cdp.eval(f"""
            (() => {{
                const inp = document.getElementById('pipeline-url-input');
                if (inp) {{
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, '{online_url}');
                    inp.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    inp.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
            }})()
        """)
        await asyncio.sleep(1)

        print("   -> Clicking 'Phân tích & Tiếp tục'...")
        await cdp.eval("""
            (() => {
                const btn = document.getElementById('pipeline-analyze-button');
                if (btn) btn.click();
            })()
        """)

        print("   -> Waiting for preview response from backend...")
        preview_opened = False
        for _ in range(30):
            await asyncio.sleep(1)
            is_modal = await cdp.eval("""
                Boolean(document.getElementById('pipeline-modal-confirm-button'))
            """)
            if is_modal:
                preview_opened = True
                break

        assert preview_opened, "Preview modal did not appear within 30s!"
        print("   v Preview modal successfully appeared!")
        await cdp.screenshot("05_preview_modal_opened.png")

        preview_details = await cdp.eval("""
            (() => {
                const modal = document.getElementById('pipeline-modal-confirm-button').closest('.fixed');
                return modal ? modal.innerText : document.body.innerText;
            })()
        """)
        print(f"   v Modal Content Summary:\n{preview_details[:300]}...")

        # 7. Start Full Pipeline Workflow from Modal
        print("\n[Step 7] Starting Full Pipeline Workflow...")
        await cdp.eval("""
            (() => {
                const btn = document.getElementById('pipeline-modal-confirm-button');
                if (btn) btn.click();
            })()
        """)
        await asyncio.sleep(2)
        await cdp.screenshot("06_workflow_started.png")

        # 8. Monitor Live Stage Progress Polling
        print("\n[Step 8] Monitoring live workflow progress via real UI polling...")
        stages_seen = set()
        completed = False
        start_t = time.time()

        for poll_round in range(120): # up to 180s
            await asyncio.sleep(1.5)
            elapsed = time.time() - start_t
            page_text = await cdp.eval("document.body.innerText")

            # Extract active stage
            for st in ["downloading", "detecting_roi", "ocr", "translating", "dubbing", "exporting", "completed"]:
                if st in page_text.lower():
                    stages_seen.add(st)

            # Query UI completion state directly
            ui_status = await cdp.eval("""
                (() => {
                    const badge = document.querySelector('[data-testid="pipeline-workflow-state-badge"]');
                    const btn = document.getElementById('pipeline-open-editor-button');
                    const badgeText = badge ? badge.innerText.toLowerCase() : '';
                    const hasBadge = Boolean(badge && (badgeText.includes('completed') || badge.getAttribute('data-state') === 'completed'));
                    const hasBtn = Boolean(btn);
                    return {
                        has_completed_badge: hasBadge,
                        has_editor_btn: hasBtn,
                        badge_text: badge ? badge.innerText : null,
                        btn_text: btn ? btn.innerText : null
                    };
                })()
            """)

            # Query backend workflow state directly
            backend_completed = False
            try:
                with urllib.request.urlopen("http://127.0.0.1:8899/api/v1/workflows/full-pipeline?limit=1", timeout=2) as r:
                    d = json.loads(r.read().decode('utf-8'))
                    if d.get("workflows") and d["workflows"][0].get("state") == "completed":
                        backend_completed = True
            except Exception:
                pass

            has_completed_badge = ui_status.get("has_completed_badge", False) if ui_status else False
            has_editor_btn = ui_status.get("has_editor_btn", False) if ui_status else False

            if poll_round % 5 == 0:
                print(f"   [{elapsed:.1f}s] Stages observed: {sorted(list(stages_seen))} | Badge: {has_completed_badge} | Btn: {has_editor_btn} | BackendDone: {backend_completed}")
                if poll_round == 10:
                    await cdp.screenshot("07_progress_tracking.png")

            # Must strictly observe BOTH completed badge AND editor button in UI after backend finishes
            if backend_completed and has_completed_badge and has_editor_btn:
                print(f"   🎉 Workflow reached COMPLETED in UI in {elapsed:.1f}s! (Badge={has_completed_badge}, Btn={has_editor_btn}, Backend={backend_completed})")
                completed = True
                break

        await cdp.screenshot("08_workflow_completed.png")
        assert backend_completed, "Backend workflow must have reached completed state!"
        assert completed, f"UI must display completed badge and 'Mở Studio Editor' button within 180s! Status: {ui_status}"
        assert has_completed_badge, "UI must display completed badge!"
        assert has_editor_btn, "UI must display 'pipeline-open-editor-button'!"

        # 9. Test Open Studio Editor from Full Pipeline UI
        print("\n[Step 9] Verifying / Opening Studio Editor from completed workflow...")
        # Explicitly click the real "Mở Studio Editor" button in DOM
        clicked = await cdp.eval("""
            (() => {
                const btn = document.getElementById('pipeline-open-editor-button');
                if (btn) {
                    btn.click();
                    return true;
                }
                return false;
            })()
        """)
        assert clicked, "pipeline-open-editor-button must exist and be clicked in DOM!"
        await asyncio.sleep(3)
        await cdp.screenshot("09_editor_opened.png")

        editor_info = await cdp.eval("""
            (() => {
                const video = document.querySelector('video');
                const cues = document.querySelectorAll('tr, .cue-item, [data-cue-id], .subtitle-row');
                return {
                    has_video: Boolean(video),
                    video_src: video ? video.src : null,
                    cues_count: cues.length,
                    page_text_sample: document.body.innerText.slice(0, 400)
                };
            })()
        """)
        print(f"   v Studio Editor DOM Inspection: {editor_info}")
        assert editor_info and editor_info.get("has_video"), f"Studio Editor must have loaded video stream: {editor_info}"
        assert editor_info and editor_info.get("cues_count", 0) > 0, f"Studio Editor must have loaded subtitle cues: {editor_info}"
        assert editor_info.get("has_video"), "Studio Editor did not load a video player!"

        # 10. Test Browser Refresh Persistence
        print("\n[Step 10] Testing Browser Refresh Persistence (state is not lost)...")
        await cdp.send("Page.reload")
        has_video_persisted = False
        refresh_info = {}
        for _ in range(15):
            await asyncio.sleep(1)
            refresh_info = await cdp.eval("""
                (() => {
                    const video = document.querySelector('video');
                    return {
                        has_video: Boolean(video),
                        page_text: document.body.innerText.slice(0, 300)
                    };
                })()
            """)
            if refresh_info and refresh_info.get("has_video"):
                has_video_persisted = True
                break
        await cdp.screenshot("10_browser_refreshed_state.png")
        assert has_video_persisted, f"Video player did not persist after refresh: {refresh_info}"

        # 10b. Inspect Flourished Peony in Studio Editor
        print("\n[Step 10b] Inspecting Flourished Peony (proj-79ea540e) in Studio Editor...")
        await cdp.eval("""
            (() => {
                localStorage.setItem('sub_studio_active_state_v1', JSON.stringify({
                    viewMode: 'studio',
                    activeProjectId: 'proj-79ea540e',
                    aspectRatio: 'original',
                    maskStyle: 'feather_tight',
                    blurStrength: 25,
                    previewMask: true
                }));
                window.location.reload();
            })()
        """)
        await asyncio.sleep(4)
        await cdp.eval("""
            (() => {
                const vid = document.querySelector('video');
                if (vid) {
                    vid.currentTime = 542;
                    vid.dispatchEvent(new Event('timeupdate'));
                    vid.dispatchEvent(new Event('seeked'));
                }
            })()
        """)
        await asyncio.sleep(2)
        peony_editor_state = await cdp.eval("""
            (() => {
                const vid = document.querySelector('video');
                const roi = document.querySelector('[data-roi-id], .border-purple-500, .border-indigo-500, .roi-box');
                const cues = document.querySelectorAll('tr, .cue-item, [data-cue-id], .subtitle-row');
                const subText = document.querySelector('[data-testid="rendered-subtitle-text"]');
                return {
                    has_video: Boolean(vid),
                    currentTime: vid ? vid.currentTime : null,
                    cues_count: cues.length,
                    has_roi_box: Boolean(roi),
                    rendered_subtitle: subText ? subText.innerText : null
                };
            })()
        """)
        print(f"   v Flourished Peony Editor Inspection: {peony_editor_state}")
        await cdp.screenshot("11_editor_flourished_peony.png")

        # 10c. Inspect Nuo Nuo Xia Shan in Studio Editor
        print("\n[Step 10c] Inspecting Nuo Nuo Xia Shan (proj-892206b7) in Studio Editor...")
        await cdp.eval("""
            (() => {
                localStorage.setItem('sub_studio_active_state_v1', JSON.stringify({
                    viewMode: 'studio',
                    activeProjectId: 'proj-892206b7',
                    aspectRatio: 'original',
                    maskStyle: 'feather_tight',
                    blurStrength: 25,
                    previewMask: true
                }));
                window.location.reload();
            })()
        """)
        await asyncio.sleep(4)
        await cdp.eval("""
            (() => {
                const vid = document.querySelector('video');
                if (vid) {
                    vid.currentTime = 39.9;
                    vid.dispatchEvent(new Event('timeupdate'));
                    vid.dispatchEvent(new Event('seeked'));
                }
            })()
        """)
        await asyncio.sleep(2)
        nuonuo_editor_state = await cdp.eval("""
            (() => {
                const vid = document.querySelector('video');
                const roi = document.querySelector('[data-roi-id], .border-purple-500, .border-indigo-500, .roi-box');
                const cues = document.querySelectorAll('tr, .cue-item, [data-cue-id], .subtitle-row');
                const subText = document.querySelector('[data-testid="rendered-subtitle-text"]');
                return {
                    has_video: Boolean(vid),
                    currentTime: vid ? vid.currentTime : null,
                    cues_count: cues.length,
                    has_roi_box: Boolean(roi),
                    rendered_subtitle: subText ? subText.innerText : null
                };
            })()
        """)
        print(f"   v Nuo Nuo Xia Shan Editor Inspection: {nuonuo_editor_state}")
        await cdp.screenshot("12_editor_nuonuo_xiashan.png")

        # 11. Test Cancel and Retry Workflow paths via API & UI
        print("\n[Step 11] Testing Cancel and Retry Workflow endpoints and UI reflection...")
        # Create a test workflow via API
        create_payload = {
            "url": "https://example.com/test_cancel.mp4",
            "source_language": "auto",
            "target_language": "vi",
            "dubbing_enabled": False,
        }
        req = urllib.request.Request(
            "http://127.0.0.1:8899/api/v1/workflows/full-pipeline",
            data=json.dumps(create_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            test_wf = json.loads(resp.read().decode("utf-8"))
        cancel_wfid = test_wf["workflow_id"]
        print(f"   v Created test workflow for cancel: {cancel_wfid}")

        # Cancel workflow
        cancel_req = urllib.request.Request(
            f"http://127.0.0.1:8899/api/v1/workflows/full-pipeline/{cancel_wfid}/cancel",
            method="POST",
        )
        with urllib.request.urlopen(cancel_req, timeout=5) as resp:
            cancel_res = json.loads(resp.read().decode("utf-8"))
        print(f"   v Cancel Response: {cancel_res}")

        # Verify state is cancelled
        with urllib.request.urlopen(f"http://127.0.0.1:8899/api/v1/workflows/full-pipeline/{cancel_wfid}") as resp:
            cancelled_wf = json.loads(resp.read().decode("utf-8"))
        assert cancelled_wf["state"] == "cancelled", f"Expected state cancelled, got {cancelled_wf['state']}"
        print(f"   v Workflow verified cancelled: state={cancelled_wf['state']}")

        # Retry workflow
        retry_req = urllib.request.Request(
            f"http://127.0.0.1:8899/api/v1/workflows/full-pipeline/{cancel_wfid}/retry",
            data=json.dumps({}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(retry_req, timeout=5) as resp:
            retry_res = json.loads(resp.read().decode("utf-8"))
        print(f"   v Retry Response: {retry_res}")
        assert retry_res.get("status") == "retrying", f"Expected retrying status, got {retry_res}"

        # 12. Artifact Validation using real tools
        print("\n[Step 12] Validating Artifacts with real tools (ffprobe, UTF-8 checks)...")
        # Find latest completed workflow
        with urllib.request.urlopen("http://127.0.0.1:8899/api/v1/workflows/full-pipeline?limit=5") as resp:
            list_res = json.loads(resp.read().decode("utf-8"))
        
        completed_wfs = [w for w in list_res.get("workflows", []) if w.get("state") == "completed"]
        assert len(completed_wfs) > 0, "No completed workflow found in backend!"
        latest_wf = completed_wfs[0]
        print(f"   v Found completed workflow: {latest_wf['workflow_id']} (Project: {latest_wf.get('project_id')})")

        artifacts = latest_wf.get("artifacts", {})
        print(f"   v Artifacts dictionary: {json.dumps(artifacts, indent=2)}")

        # A. Output MP4
        out_mp4 = Path(artifacts["export_mp4"])
        assert out_mp4.exists(), f"Output MP4 missing: {out_mp4}"
        assert out_mp4.stat().st_size > 500000, f"Output MP4 too small: {out_mp4.stat().st_size} bytes"

        probe_cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(out_mp4)
        ]
        probe_res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, text=True, check=True)
        probe_json = json.loads(probe_res.stdout)
        stream_types = [s.get("codec_type") for s in probe_json.get("streams", [])]
        print(f"   v Output MP4 streams: {stream_types}")
        assert "video" in stream_types, "Output MP4 missing video stream"
        assert "audio" in stream_types, "Output MP4 missing audio stream"

        duration = float(probe_json.get("format", {}).get("duration", 0))
        print(f"   v Output MP4 Duration: {duration:.2f}s, Size: {out_mp4.stat().st_size:,} bytes")
        assert duration > 15.0, f"Duration {duration} <= 15s"

        # B. Voiceover MP3
        vo_path = Path(artifacts["voiceover_path"])
        assert vo_path.exists(), f"Voiceover file missing: {vo_path}"
        assert vo_path.stat().st_size > 1000, f"Voiceover file too small: {vo_path.stat().st_size} bytes"
        vo_probe = subprocess.run([
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", str(vo_path)
        ], stdout=subprocess.PIPE, text=True, check=True)
        vo_json = json.loads(vo_probe.stdout)
        vo_streams = [s.get("codec_type") for s in vo_json.get("streams", [])]
        assert "audio" in vo_streams, "Voiceover missing audio stream"
        print(f"   v Voiceover MP3 valid: streams={vo_streams}, size={vo_path.stat().st_size:,} bytes")

        # C. SRT and ASS Subtitles
        srt_path = Path(artifacts["srt_path"])
        assert srt_path.exists()
        srt_content = srt_path.read_text(encoding="utf-8")
        assert "\ufffd" not in srt_content, "SRT contains replacement characters (mojibake)!"
        assert len(srt_content.strip()) > 50, "SRT is too short!"

        ass_path = Path(artifacts["ass_path"])
        assert ass_path.exists()
        ass_content = ass_path.read_text(encoding="utf-8")
        assert "\ufffd" not in ass_content, "ASS contains replacement characters (mojibake)!"
        print(f"   v Subtitle files valid: UTF-8 clean, no mojibake, SRT lines={len(srt_content.splitlines())}")

        # D. Project manifest and ROI
        with urllib.request.urlopen(f"http://127.0.0.1:8899/api/v1/projects/{latest_wf['project_id']}") as resp:
            proj_data = json.loads(resp.read().decode("utf-8"))
        print(f"   v Project Data loaded: title='{proj_data.get('title')}', has_voiceover={proj_data.get('has_voiceover')}, has_export={proj_data.get('has_export')}")
        assert proj_data.get("has_voiceover"), "Project manifest missing has_voiceover=True"
        assert proj_data.get("has_export"), "Project manifest missing has_export=True"

        # Save audit report json
        audit_summary = {
            "timestamp": time.time(),
            "workflow_id": latest_wf["workflow_id"],
            "project_id": latest_wf["project_id"],
            "state": latest_wf["state"],
            "progress": latest_wf["progress"],
            "stages": latest_wf["stages"],
            "quality_metrics": latest_wf.get("quality_metrics", {}),
            "artifacts": {
                "source_video": artifacts.get("source_video"),
                "export_mp4": str(out_mp4),
                "export_mp4_size": out_mp4.stat().st_size,
                "export_mp4_duration": duration,
                "voiceover_path": str(vo_path),
                "voiceover_size": vo_path.stat().st_size,
                "srt_path": str(srt_path),
                "ass_path": str(ass_path),
            },
            "ffprobe": probe_json,
            "network_logs_count": len(cdp.network_logs),
            "network_sample": cdp.network_logs[:25],
        }
        (EVIDENCE_DIR / "pipeline_audit_report.json").write_text(json.dumps(audit_summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print("\n   v Saved docs/evidence/pipeline_audit_report.json")

        print("\n" + "=" * 80)
        print("  🎉 ALL FULL PIPELINE REAL BROWSER CDP AND BACKEND CHECKS PASSED!")
        print("=" * 80)

    finally:
        if cdp:
            await cdp.close()
        chrome_proc.terminate()
        try:
            chrome_proc.wait(timeout=3)
        except Exception:
            chrome_proc.kill()

if __name__ == "__main__":
    asyncio.run(run_audit())
