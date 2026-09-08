import sys
import json
import subprocess
import os
from pathlib import Path

def pick_via_powershell(mode="single"):
    if mode == "multiple":
        ps_script = """
[System.Reflection.Assembly]::LoadWithPartialName("System.windows.forms") | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = "Video Files (*.mp4;*.mkv;*.avi;*.mov;*.webm;*.ts;*.flv;*.m4v;*.wmv)|*.mp4;*.mkv;*.avi;*.mov;*.webm;*.ts;*.flv;*.m4v;*.wmv|All Files (*.*)|*.*"
$f.Title = "Chọn Một Hoặc Nhiều Video Hard Subtitle"
$f.Multiselect = $true
$f.RestoreDirectory = $true
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$res = $f.ShowDialog($form)
$form.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    ConvertTo-Json -Compress @($f.FileNames)
} else {
    Write-Output "[]"
}
"""
    elif mode == "folder":
        ps_script = """
[System.Reflection.Assembly]::LoadWithPartialName("System.windows.forms") | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "Chọn Thư Mục Chứa Video"
$f.ShowNewFolderButton = $false
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$res = $f.ShowDialog($form)
$form.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    $folder = $f.SelectedPath
    $files = Get-ChildItem -Path $folder -File | Where-Object { $_.Extension -match '^\.(mp4|mkv|avi|mov|webm|ts|flv|m4v|wmv)$' } | Select-Object -ExpandProperty FullName
    if ($files) {
        ConvertTo-Json -Compress @($files)
    } else {
        Write-Output "[]"
    }
} else {
    Write-Output "[]"
}
"""
    else:
        ps_script = """
[System.Reflection.Assembly]::LoadWithPartialName("System.windows.forms") | Out-Null
[System.Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = "Video Files (*.mp4;*.mkv;*.avi;*.mov;*.webm;*.ts;*.flv;*.m4v;*.wmv)|*.mp4;*.mkv;*.avi;*.mov;*.webm;*.ts;*.flv;*.m4v;*.wmv|All Files (*.*)|*.*"
$f.Title = "Chọn Video Hard Subtitle"
$f.RestoreDirectory = $true
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$res = $f.ShowDialog($form)
$form.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $f.FileName
} else {
    Write-Output ""
}
"""
    cmd = ["powershell", "-NoProfile", "-STA", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps_script]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=120)
    return res.stdout.strip()

def pick_via_tkinter(mode="single"):
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.update_idletasks()
    root.lift()
    root.attributes('-topmost', True)
    root.update()
    
    filetypes = [
        ("Video Files (*.mp4, *.mkv, *.avi, *.mov, *.webm, *.ts)", "*.mp4 *.mkv *.avi *.mov *.webm *.ts *.flv *.m4v *.wmv *.mp3 *.wav *.m4a"),
        ("All Files (*.*)", "*.*")
    ]
    try:
        if mode == "multiple":
            selected = filedialog.askopenfilenames(parent=root, title="Chọn Video", filetypes=filetypes)
            if selected:
                return json.dumps([str(Path(p)).replace("\\", "/") for p in selected if p], ensure_ascii=False)
            return "[]"
        elif mode == "folder":
            selected = filedialog.askdirectory(parent=root, title="Chọn Thư Mục")
            if selected:
                folder_path = Path(selected)
                valid_exts = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".ts", ".flv", ".m4v", ".wmv"}
                files = [str(f).replace("\\", "/") for f in sorted(folder_path.glob("*")) if f.is_file() and f.suffix.lower() in valid_exts]
                return json.dumps(files, ensure_ascii=False)
            return "[]"
        else:
            selected = filedialog.askopenfilename(parent=root, title="Chọn Video", filetypes=filetypes)
            return str(Path(selected)).replace("\\", "/") if selected else ""
    finally:
        try:
            root.destroy()
        except Exception:
            pass

def main():
    mode = "single"
    if "--multiple" in sys.argv:
        mode = "multiple"
    elif "--folder" in sys.argv:
        mode = "folder"
    
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    # Trên Windows ưu tiên PowerShell STA (Không bao giờ treo COM STA)
    if os.name == "nt":
        try:
            output = pick_via_powershell(mode)
            if output is not None:
                print(output)
                return
        except Exception:
            pass

    # Fallback sang Tkinter
    try:
        output = pick_via_tkinter(mode)
        print(output)
    except Exception:
        if mode == "single":
            print("")
        else:
            print("[]")

if __name__ == "__main__":
    main()
