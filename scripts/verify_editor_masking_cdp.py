import asyncio
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import websockets
from pathlib import Path

if sys.stdout and hastr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr and hastr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

EVIDENCE_DIR = Path("docs/evidence")
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)

class CDPClient:
    def __init__(self, ws):
        self.ws = ws
        self._msg_id = 0
        self._pending = {}
        self._listen_task = asyncio.create_task(self._listen())

    async def _listen(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                mid = msg.get("id")
                if mid in self._pending:
                    self._pending[mid].set_result(msg)
        except Exception:
            pass

    async def send(self, method, params=None):
        self._msg_id += 1
        mid = self._msg_id
        fut = asyncio.get_running_loop().creategfuture()
        self._pending[mid] = fut
        req = {"id": mid, "method": method}
        if params:
            req["params"] = params
        await self.ws.send(json.dumps(req))
        return await fut

    async def eval_js(self, expr):
        res = await self.send("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": True,
        })
        return res.get("result", {}).get("result", {}).get("value")

    async def screenshot(self, filename):
        res = await self.send("Page.captureScreenshot", {"format": "png"})
       b64 = res.get("result", {}).get("data", "")
        out_p = EVIDENCE_DIR / filename
        out_p.write_bytes(base64.b64decode(b64))
        print(f"   [Screenshot Saved] -> {out_p}")
        return out_p

    async def close(self):
        self._listen_task.cancel()
        await self.ws.close()


async def inspect_editor():
    print("=" * 80)
    print("  🎈 REAL CHROME CDP STUDIO EDITOR INSPECTION (FLOURISHED PEONY & NUO NUO)")
    print("=" * 80)

    ud = tempfile.mkdtemp()
    chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    chrome_proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--remote-debugging-port=9555",
        f"--user-data-dir={ud}",
        "--remote-allow-origins=*",
        "--window-size=1600,1000",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
    ])

    cdp = None
    try:
        await asyncio.sleep(2.5)
        new_tab_url = "http://127.0.0.1:9555/json/new?http://127.0.0.1:8899/"
        req = urllib.request.Request(new_tab_url, method="PUT")
        with urllib.request.urlopen(req, timeout=5) as resp:
            tab_info = json.loads(resp.read().decode("utf-8"))
        ws_url = tab_info["webSocketDebuggerUrl"]
        raw_ws = await websockets.connect(ws_url, max_size=20 * 1024 * 1024)
        cdp = CDPClient(raw_ws)

        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("DOM.enable")
        await asyncio.sleep(3)

        # 1. Load Flourished Peony (proj-79ea540e)
        print('\n[Video 1] Loading Project "proj-79ea540e" (Qu&#226;c Sắc Pa��ng Hoa Tập 1)...')
        await cdp.eval_js('''
            localStorage.setItem('sub_studio_active_state_v1', JSON.stringify({
                viewMode: 'studio',
                activeProjectId: 'proj-79ea540e',
                maskStyle: 'feather_tight',
                blurStrength: 25,
                previewMask: true
            }));
            window.location.reload();
        ''')
        await asyncio.sleep(5)

        # Seek to 542s where dialogue cue appears
        await cdp.eval_js('''
            (() => {
                const vid = document.querySelector('video');
                if (vid) {
                    vid.currentTime = 542;
                }
            })()
        ''')
        await asyncio.sleep(2.5)

        peony_meta = await cdp.eval_js('''
            (() => {
                const vid = document.querySelector('video');
                const roiBox = document.querySelector('[data-roi-id], .absolute.border-2, .border-purple-500, .border-indigo-500');
                const cues = document.querySelectorAll('tr, .cue-item, [data-cue-id], .subtitle-row');
                const timeline = document.querySelector('.timeline-container, .bottom-timeline, canvas');
                return {
                    has_video: Boolean(vid),
                    currentTime: vid ? vid.currentTime : 0,
                    duration: vid ? vid.duration : 0,
                    video_width: vid ? vid.videoWidth : 0,
                    video_height: vid ? vid.videoHeight : 0,
                    cues_count: cues.length,
                    has_timeline: Boolean(timeline),
                    roi_style: roiBox ? roiBox.getAttribute('style') : null
                };
            })()
        ''')
        print('   v Peony Metadata:', json.dumps(peony_meta, ensure_ascii=False, indent=2))
        await cdp.screenshot('11_editor_flourished_peony.png')

        # 2, Load Nuo Nuo Xia Shan (proj-892206b7)
        print('\n[Video 2] Loading Project "proj-892206b7" (Nhuế Nhuế Hạ Sơn - Đoản Kịch)...')
        await cdp.eval_js('''
            localStorage.setItem('sub_studio_active_state_v1', JSON.stringify({
                viewMode: 'studio',
                activeProjectId: 'proj-892206b7',
                maskStyle: 'feather_tight',
                blurStrength: 25,
                previewMask: true
            }));
            window.location.reload();
        ''')
        await asyncio.sleep(5)

        # Seek to 5.7s where dialogue cue appears
        await cdp.eval_js('''
            (() => {
                const vid = document.querySelector('video');
                if (vid) {
                    vid.currentTime = 5.7;
                }
            })()
        ''')
        await asyncio.sleep(2.5)

        nuonuo_meta = await cdp.eval_js('''
            (() => {
                const vid = document.querySelector('video');
                const roiBox = document.querySelector('[data-roi-id], .absolute.border-2, .border-purple-500, .border-indigo-500');
                const cues = document.querySelectorAll('tr, .cue-item, [data-cue-id], .subtitle-row');
                return {
                    has_video: Boolean(vid),
                    currentTime: vid ? vid.currentTime : 0,
                    duration: vid ? vid.duration : 0,
                    video_width: vid ? vid.videoWidth : 0,
                    video_height: vid ? vid.videoHeight : 0,
                    cues_count: cues.length,
                    roi_style: roiBox ? roiBox.getAttribute('style') : null
                };
            })()
        ''')
        print('   v Nuo Nuo Metadata:', json.dumps(nuonuo_meta, ensure_ascii=False, indent=2))
        await cdp.screenshot('12_editor_nuonuo_xiashan.png')

        print('\n' + '=' * 80)
        print('  🎉 STUDIO EDITOR REAL CDP INSPECTION COMPLETED SUCCESSFULLY!')
        print('+' * 80)

    finally:
        if cdp:
            await cdp.close()
        chrome_proc.terminate()
        try:
            chrome_proc.wait(timeout=3)
        except Exception:
            chrome_proc.kill()

if __name__ == '__main__':
    asyncio.run(inspect_editor())
