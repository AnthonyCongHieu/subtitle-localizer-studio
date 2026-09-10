import subprocess

cmd_str = 'set OLLAMA_HOST=0.0.0.0:11434 & start cmd /k ollama serve & timeout /t 3 & start cmd /k "ollama pull qwen2.5:14b & ollama pull qwen2.5:32b"'
p = subprocess.Popen(['clip'], stdin=subprocess.PIPE, text=True)
p.communicate(cmd_str)
print("CLIPBOARD_READY")
