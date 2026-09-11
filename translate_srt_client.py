import sys
import os
import re
import json
import time
import argparse
import requests

def parse_srt(srt_path):
    with open(srt_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    pattern = re.compile(r'(\d+)\s*\n(\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*\n(.*?)(?=\n\s*\d+\s*\n|\Z)', re.DOTALL)
    blocks = []
    for match in pattern.finditer(content):
        idx = int(match.group(1))
        timecode = match.group(2).strip()
        text = ' '.join([line.strip() for line in match.group(3).strip().splitlines() if line.strip()])
        blocks.append({'index': idx, 'timecode': timecode, 'text': text})
    return blocks

def sanitize_output(text, source_zh):
    if not text:
        return ""
    t = text.strip()
    t = re.sub(r'[\(\（][^\)\）]*此处[^\)\）]*[\)\）]', '', t)
    t = re.sub(r'此处直译为.*', '', t)
    t = re.sub(r'建议使用.*', '', t)
    t = re.sub(r'为了符合.*', '', t)
    t = t.replace('块钱', ' tệ')
    t = t.replace('？', '?').replace('！', '!').replace('，', ', ').replace('。', '. ')
    t = re.sub(r'[\u4e00-\u9fff]', '', t)
    t = re.sub(r'\s+', ' ', t)
    t = re.sub(r'\s+([,\.\?!;:])', r'\1', t).strip()
    
    if t and not re.search(r'[\.\?\!\…]$', t):
        if re.search(r'[\?？]', source_zh) or re.search(r'(chưa|sao|không|gì|đâu|hả|à|nhỉ)$', t):
            t += "?"
        else:
            t += "."
    return t

def translate_srt(input_srt, output_srt=None, server_url="http://192.168.1.219:11434", model="qwen2.5:14b", genre="Phim truyền hình tự nhiên", pronouns="xưng hô tự nhiên"):
    if not os.path.exists(input_srt):
        print(f"Lỗi: Không tìm thấy file {input_srt}")
        return
    
    if not output_srt:
        base, _ = os.path.splitext(input_srt)
        output_srt = base + ".vi.srt"
    output_bilingual = os.path.splitext(output_srt)[0] + ".bilingual.txt"
    
    blocks = parse_srt(input_srt)
    print(f"=== KHỞI CHẠY DỊCH PHỤ ĐỀ AI (MÁY CHỦ {server_url}) ===")
    print(f"Mô hình: {model} | Tổng số câu: {len(blocks)}")
    
    chunk_size = 12
    translated_blocks = []
    start_total = time.time()
    
    for i in range(0, len(blocks), chunk_size):
        chunk = blocks[i:i+chunk_size]
        batch_num = i // chunk_size + 1
        total_batches = (len(blocks) + chunk_size - 1) // chunk_size
        
        cues_payload = [{'id': b['index'], 'zh': b['text']} for b in chunk]
        cues_json = json.dumps(cues_payload, ensure_ascii=False)
        
        system_prompt = f"""Bạn là Chuyên gia Dịch thuật Phụ đề Phim Trung - Việt.
Dịch toàn bộ danh sách phụ đề sau sang tiếng Việt chuẩn khẩu ngữ điện ảnh.
Bối cảnh: {genre} | Đại từ xưng hô bắt buộc: {pronouns}
Quy tắc:
1. Dịch ngắn gọn súc tích chuẩn phụ đề (dưới 38 ký tự/dòng).
2. Xưng hô chuẩn xác tuyệt đối.
3. TUYỆT ĐỐI KHÔNG để sót chữ Hán, không xuất Pinyin.
4. Xuất DUY NHẤT một mảng JSON: [{"id": 1, "vi": "Câu dịch"}]"""

        user_prompt = f"Dịch danh sách sau sang JSON tiếng Việt:\n{cues_json}"
        
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.15, "top_p": 0.9, "num_predict": 2048}
        }
        
        t0 = time.time()
        try:
            resp = requests.post(f"{server_url}/api/chat", json=payload, timeout=90)
            elapsed = time.time() - t0
            content = resp.json()["message"]["content"].strip()
            
            parsed = None
            try:
                parsed_data = json.loads(content)
                if isinstance(parsed_data, list):
                    parsed = parsed_data
                elif isinstance(parsed_data, dict):
                    for v in parsed_data.values():
                        if isinstance(v, list):
                            parsed = v
                            break
            except Exception:
                m = re.search(r'\[\s*\{.*\}\s*\]', content, re.DOTALL)
                if m:
                    parsed = json.loads(m.group(0))
            
            trans_map = {}
            if parsed:
                for p in parsed:
                    p_id = int(p.get("id", 0))
                    p_vi = p.get("vi") or p.get("target_vi") or ""
                    trans_map[p_id] = p_vi
            
            for k, b in enumerate(chunk):
                raw_vi = trans_map.get(b['index'], "")
                if not raw_vi and parsed and k < len(parsed):
                    raw_vi = parsed[k].get("vi") or parsed[k].get("target_vi") or ""
                
                clean_vi = sanitize_output(raw_vi, b['text'])
                translated_blocks.append({
                    'index': b['index'],
                    'timecode': b['timecode'],
                    'source_zh': b['text'],
                    'target_vi': clean_vi
                })
            print(f"  -> [Batch {batch_num}/{total_batches}] {len(chunk)} câu trong {elapsed:.2f}s ({len(chunk)/elapsed:.2f} câu/s)")
        except Exception as e:
            print(f"  -> [Lỗi Batch {batch_num}] {e}")
            for b in chunk:
                translated_blocks.append({
                    'index': b['index'],
                    'timecode': b['timecode'],
                    'source_zh': b['text'],
                    'target_vi': "[Lỗi dịch]"
                })
                
    total_elapsed = time.time() - start_total
    print(f"\nHOÀN TẤT DỊCH TOÀN BỘ {len(translated_blocks)} CÂU TRONG {total_elapsed:.2f}s ({len(translated_blocks)/total_elapsed:.2f} câu/s)!")
    
    # Ghi file SRT
    with open(output_srt, 'w', encoding='utf-8') as f:
        for tb in translated_blocks:
            f.write(f"{tb['index']}\n{tb['timecode']}\n{tb['target_vi']}\n\n")
    print(f"Đã xuất SRT: {output_srt}")
    
    # Ghi file bilingual TXT
    with open(output_bilingual, 'w', encoding='utf-8') as f:
        f.write(f"=== BẢN DỊCH ĐỐI CHIẾU SONG NGỮ: {os.path.basename(input_srt)} ===\n")
        f.write(f"Mô hình: {model} | Thời gian: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        for tb in translated_blocks:
            f.write(f"[{tb['index']}]\n  GỐC : {tb['source_zh']}\n  DỊCH: {tb['target_vi']}\n\n")
    print(f"Đã xuất TXT song ngữ: {output_bilingual}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI Subtitle Translator Client for PC6")
    parser.add_argument("input_srt", help="Đường dẫn file SRT tiếng Trung cần dịch")
    parser.add_argument("--output_srt", default=None, help="Đường dẫn file SRT tiếng Việt đầu ra")
    parser.add_argument("--server", default="http://192.168.1.219:11434", help="Địa chỉ cụm máy chủ Ollama")
    parser.add_argument("--model", default="qwen2.5:14b", choices=["qwen2.5:14b", "qwen2.5:32b-instruct-q3_K_M"], help="Mô hình dịch")
    parser.add_argument("--genre", default="Phim truyền hình tự nhiên", help="Thể loại phim")
    parser.add_argument("--pronouns", default="xưng hô tự nhiên", help="Ma trận đại từ xưng hô")
    
    args = parser.parse_args()
    translate_srt(args.input_srt, args.output_srt, args.server, args.model, args.genre, args.pronouns)
