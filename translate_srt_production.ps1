param(
    [Parameter(Mandatory=$true)]
    [string]$InputSrt,
    
    [string]$OutputSrt = "",
    [string]$Model = "qwen2.5:14b",
    [string]$ServerUrl = "http://127.0.0.1:11434",
    [string]$Genre = "Phim truyền hình tự nhiên",
    [string]$Pronouns = "xưng hô tự nhiên theo bối cảnh",
    [string]$Glossary = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $InputSrt)) {
    Write-Error "File không tồn tại: $InputSrt"
    exit 1
}

if ($OutputSrt -eq "") {
    $OutputSrt = [System.IO.Path]::ChangeExtension($InputSrt, ".vi.srt")
}
$OutputBilingual = [System.IO.Path]::ChangeExtension($OutputSrt, ".bilingual.txt")

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   PRODUCTION AI SUBTITLE TRANSLATOR (SRT -> VIETNAMESE)        " -ForegroundColor Cyan
Write-Host "   Server: $ServerUrl | Model: $Model" -ForegroundColor Cyan
Write-Host "   Input : $InputSrt" -ForegroundColor Yellow
Write-Host "   Output: $OutputSrt" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Cyan

# Đọc và phân tích file SRT
$lines = Get-Content -Path $InputSrt -Encoding utf8
$blocks = @()
$currentBlock = $null

foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if ($trimmed -match '^\d+$' -and ($currentBlock -eq $null -or $currentBlock.text -ne "")) {
        if ($currentBlock -ne $null) {
            $blocks += $currentBlock
        }
        $currentBlock = [PSCustomObject]@{
            index = [int]$trimmed
            timecode = ""
            text = ""
        }
    } elseif ($trimmed -match '\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}') {
        if ($currentBlock -ne $null) {
            $currentBlock.timecode = $trimmed
        }
    } elseif ($trimmed -ne "") {
        if ($currentBlock -ne $null) {
            if ($currentBlock.text -ne "") { $currentBlock.text += " " }
            $currentBlock.text += $trimmed
        }
    }
}
if ($currentBlock -ne $null -and $currentBlock.text -ne "") {
    $blocks += $currentBlock
}

Write-Host "Đã phân tích thành công $($blocks.Count) khối phụ đề." -ForegroundColor Green

# Hàm làm sạch đầu ra (Pass 3 Sanitizer)
function Sanitize-SubtitleOutput($text, $sourceZh) {
    if ([string]::IsNullOrWhiteSpace($text)) { return "" }
    $t = $text.Trim()
    $t = $t -replace '[\(\（][^\)\）]*此处[^\)\）]*[\)\）]', ''
    $t = $t -replace '此处直译为.*', ''
    $t = $t -replace '建议使用.*', ''
    $t = $t -replace '为了符合.*', ''
    $t = $t -replace '块钱', ' tệ'
    $t = $t -replace '？', '?' -replace '！', '!' -replace '，', ', ' -replace '。', '. ' -replace '：', ': '
    $t = [regex]::Replace($t, '[\u4e00-\u9fff]', '')
    $t = $t -replace '\s+', ' '
    $t = $t -replace '\s+([,\.\?!;:])', '$1'
    $t = $t.Trim()
    if (-not ($t -match '[\.\?\!\…]$')) {
        if ($sourceZh -match '[\?？]' -or $t -match '(chưa|sao|không|gì|đâu|hả|à|nhỉ)$') {
            $t = $t + "?"
        } elseif ($sourceZh -match '[\!！]' -or $t -match '(ơi|nào|đi|mà|nhé)$') {
            $t = $t + "."
        } else {
            $t = $t + "."
        }
    }
    return $t
}

# Chia batch và dịch
$chunkSize = 12
$translatedBlocks = @()
$sw = [System.Diagnostics.Stopwatch]::StartNew()

for ($i = 0; $i -lt $blocks.Count; $i += $chunkSize) {
    $chunk = $blocks[$i..([math]::Min($i + $chunkSize - 1, $blocks.Count - 1))]
    $batchNum = [math]::Floor($i / $chunkSize) + 1
    $totalBatches = [math]::Ceiling($blocks.Count / $chunkSize)
    
    $cuesPayload = @()
    foreach ($b in $chunk) {
        $cuesPayload += @{
            id = $b.index
            zh = $b.text
        }
    }
    $cuesJson = ($cuesPayload | ConvertTo-Json -Compress)
    
    $systemPrompt = @"
Bạn là Chuyên gia Dịch thuật Phụ đề Phim Trung - Việt xuất sắc nhất.
Nhiệm vụ: Dịch toàn bộ danh sách phụ đề tiếng Trung sau sang tiếng Việt chuẩn khẩu ngữ điện ảnh.

BỐI CẢNH (DISCOURSE CONTEXT):
- Thể loại: $Genre
- Đại từ xưng hô bắt buộc: $Pronouns
- Thuật ngữ / NER: $Glossary

QUY TẮC BẮT BUỘC:
1. Dịch ngắn gọn, súc tích chuẩn phụ đề phim (dưới 38 ký tự/dòng).
2. Tuyệt đối tuân thủ đại từ xưng hô đã chỉ định xuyên suốt cả đoạn.
3. TUYỆT ĐỐI KHÔNG để sót chữ Hán, không xuất Pinyin, không xuất giải thích.
4. Xuất DUY NHẤT một mảng JSON thuần túy theo cấu trúc:
[
  {"id": 1, "vi": "Câu dịch tiếng Việt"},
  ...
]
"@

    $userPrompt = "Dịch danh sách sau sang JSON tiếng Việt:`n$cuesJson"
    
    $body = @{
        model = $Model
        messages = @(
            @{ role = "system"; content = $systemPrompt },
            @{ role = "user"; content = $userPrompt }
        )
        stream = $false
        format = "json"
        options = @{
            temperature = 0.15
            top_p = 0.9
            num_predict = 2048
        }
    } | ConvertTo-Json -Depth 6
    
    $swBatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $resp = Invoke-RestMethod -Uri "$ServerUrl/api/chat" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 120
        $swBatch.Stop()
        
        $content = $resp.message.content.Trim()
        $parsed = $null
        try {
            $parsed = $content | ConvertFrom-Json
            if ($parsed -is [PSCustomObject]) {
                foreach ($prop in $parsed.PSObject.Properties.Name) {
                    if ($parsed.$prop -is [System.Collections.IEnumerable]) {
                        $parsed = $parsed.$prop
                        break
                    }
                }
            }
        } catch {
            if ($content -match '\[\s*\{.*\}\s*\]') {
                $parsed = $matches[0] | ConvertFrom-Json
            }
        }
        
        $transMap = @{}
        if ($parsed) {
            foreach ($p in $parsed) {
                $cId = [int]$p.id
                $cVi = if ($p.vi) { [string]$p.vi } elseif ($p.target_vi) { [string]$p.target_vi } else { "" }
                $transMap[$cId] = $cVi
            }
        }
        
        for ($k = 0; $k -lt $chunk.Count; $k++) {
            $b = $chunk[$k]
            $rawVi = ""
            if ($transMap.ContainsKey($b.index)) {
                $rawVi = $transMap[$b.index]
            } elseif ($parsed -and $k -lt $parsed.Count) {
                $p = $parsed[$k]
                $rawVi = if ($p.vi) { [string]$p.vi } elseif ($p.target_vi) { [string]$p.target_vi } else { "" }
            }
            
            $cleanVi = Sanitize-SubtitleOutput -text $rawVi -sourceZh $b.text
            $translatedBlocks += [PSCustomObject]@{
                index = $b.index
                timecode = $b.timecode
                source_zh = $b.text
                target_vi = $cleanVi
            }
        }
        Write-Host "    [Batch $batchNum / $totalBatches] Hoàn tất $($chunk.Count) câu trong $([math]::Round($swBatch.Elapsed.TotalSeconds, 2))s ($([math]::Round($chunk.Count / $swBatch.Elapsed.TotalSeconds, 2)) câu/s)" -ForegroundColor Green
    } catch {
        Write-Host "    [Lỗi Batch $batchNum] $_" -ForegroundColor Red
        foreach ($b in $chunk) {
            $translatedBlocks += [PSCustomObject]@{
                index = $b.index
                timecode = $b.timecode
                source_zh = $b.text
                target_vi = "[Lỗi dịch]"
            }
        }
    }
}

$sw.Stop()
$totalSec = [math]::Round($sw.Elapsed.TotalSeconds, 2)
Write-Host "`nĐã hoàn thành dịch toàn bộ $($translatedBlocks.Count) câu trong $totalSec giây ($([math]::Round($translatedBlocks.Count / $totalSec, 2)) câu/giây)!" -ForegroundColor Cyan

# Xuất file SRT đích chuẩn UTF-8
$srtLines = @()
$txtLines = @(
    "=== BẢN DỊCH ĐỐI CHIẾU SONG NGỮ ===",
    "Mô hình: $Model | Thời gian: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "======================================",
    ""
)

foreach ($tb in $translatedBlocks) {
    $srtLines += "$($tb.index)"
    $srtLines += "$($tb.timecode)"
    $srtLines += "$($tb.target_vi)"
    $srtLines += ""
    
    $txtLines += "[$($tb.index)]"
    $txtLines += "  GỐC : $($tb.source_zh)"
    $txtLines += "  DỊCH: $($tb.target_vi)"
    $txtLines += ""
}

[System.IO.File]::WriteAllLines($OutputSrt, $srtLines, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllLines($OutputBilingual, $txtLines, [System.Text.Encoding]::UTF8)

Write-Host "Đã ghi file SRT: $OutputSrt" -ForegroundColor Green
Write-Host "Đã ghi file TXT: $OutputBilingual" -ForegroundColor Green

# Đồng bộ LAN
$lanShare = "\\pc6\SHARE PC6 HIEU"
if (Test-Path $lanShare) {
    try {
        Copy-Item -Path $OutputSrt -Destination (Join-Path $lanShare (Split-Path $OutputSrt -Leaf)) -Force
        Copy-Item -Path $OutputBilingual -Destination (Join-Path $lanShare (Split-Path $OutputBilingual -Leaf)) -Force
        Write-Host "ĐÃ ĐỒNG BỘ THÀNH CÔNG SANG MÁY KHÁCH: $lanShare" -ForegroundColor Green
    } catch {
        Write-Host "Lỗi đồng bộ LAN: $_" -ForegroundColor Yellow
    }
}
