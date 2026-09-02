import sys
import tkinter as tk
from tkinter import filedialog
from pathlib import Path

def main():
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    
    selected = filedialog.askopenfilename(
        title="Chọn Video Hard Subtitle",
        filetypes=[
            ("Video Files (*.mp4, *.mkv, *.avi, *.mov, *.webm, *.ts)", "*.mp4 *.mkv *.avi *.mov *.webm *.ts *.flv *.m4v"),
            ("All Files (*.*)", "*.*")
        ]
    )
    root.destroy()
    if selected:
        # In ra đường dẫn chuẩn UTF-8
        sys.stdout.reconfigure(encoding='utf-8')
        print(str(Path(selected)).replace("\\", "/"))

if __name__ == "__main__":
    main()
