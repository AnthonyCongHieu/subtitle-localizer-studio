import sys
import json
import tkinter as tk
from tkinter import filedialog
from pathlib import Path

def main():
    mode = "single"
    if "--multiple" in sys.argv:
        mode = "multiple"
    elif "--folder" in sys.argv:
        mode = "folder"
    
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    
    filetypes = [
        ("Video Files (*.mp4, *.mkv, *.avi, *.mov, *.webm, *.ts)", "*.mp4 *.mkv *.avi *.mov *.webm *.ts *.flv *.m4v *.wmv *.mp3 *.wav *.m4a"),
        ("All Files (*.*)", "*.*")
    ]
    
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    if mode == "multiple":
        selected = filedialog.askopenfilenames(
            title="Chọn Một Hoặc Nhiều Video Hard Subtitle",
            filetypes=filetypes
        )
        root.destroy()
        if selected:
            paths = [str(Path(p)).replace("\\", "/") for p in selected if p]
            print(json.dumps(paths, ensure_ascii=False))
        else:
            print("[]")
    elif mode == "folder":
        selected = filedialog.askdirectory(
            title="Chọn Thư Mục Chứa Video"
        )
        root.destroy()
        if selected:
            folder_path = Path(selected)
            valid_exts = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".ts", ".flv", ".m4v", ".wmv"}
            files = [
                str(f).replace("\\", "/")
                for f in sorted(folder_path.glob("*"))
                if f.is_file() and f.suffix.lower() in valid_exts
            ]
            print(json.dumps(files, ensure_ascii=False))
        else:
            print("[]")
    else:
        selected = filedialog.askopenfilename(
            title="Chọn Video Hard Subtitle",
            filetypes=filetypes
        )
        root.destroy()
        if selected:
            print(str(Path(selected)).replace("\\", "/"))
        else:
            print("")

if __name__ == "__main__":
    main()
