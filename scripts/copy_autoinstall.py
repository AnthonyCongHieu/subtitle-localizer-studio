import subprocess

cmd_text = r'''powershell -ExecutionPolicy Bypass -Command "$exe = \"$env:LOCALAPPDATA\Programs\Ollama\ollama.exe\"; if (-not (Test-Path $exe)) { Write-Host 'Đang tải và cài đặt Ollama cho RTX 5090...'; Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile \"$env:TEMP\OllamaSetup.exe\"; Start-Process \"$env:TEMP\OllamaSetup.exe\" -ArgumentList '/silent' -Wait }; Start-Process cmd -ArgumentList \"/k set OLLAMA_HOST=0.0.0.0:11434 & `\"$exe`\" serve\"; Start-Sleep 5; Start-Process cmd -ArgumentList \"/k `\"$exe`\" pull qwen2.5:14b & `\"$exe`\" pull qwen2.5:32b\""'''

p = subprocess.Popen(['clip'], stdin=subprocess.PIPE, text=True, encoding='utf-8')
p.communicate(cmd_text)
print("SUCCESS_COPIED_AUTORUN")
