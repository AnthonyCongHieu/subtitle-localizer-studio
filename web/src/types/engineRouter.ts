// web/src/types/engineRouter.ts
// Định nghĩa cấu trúc dữ liệu cho Engine Router (Hệ thống điều phối các API Engine theo dạng Matrix)

export type ServiceType = 'translation' | 'ocr' | 'dubbing';

export type ProviderProtocol =
  | 'gemini'
  | 'openai_compatible'
  | 'ollama'
  | 'capcut'
  | 'edge_tts'
  | 'rapidocr'
  | 'ppocrv5';

export interface EngineNodeConfig {
  id: string;
  name: string;
  serviceType: ServiceType;
  protocol: ProviderProtocol;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  isCustom?: boolean;
  isActive?: boolean;
  isFallback?: boolean;
  latencyMs?: number;
  status?: 'ready' | 'cooldown' | 'error' | 'testing' | 'offline';
  statusMessage?: string;
  extraParams?: Record<string, any>;
}

export interface RoutingServiceMatrix {
  serviceType: ServiceType;
  displayName: string;
  description: string;
  activeEngineId: string;
  fallbackEngineId?: string;
  autoFallback: boolean;
  availableEngines: EngineNodeConfig[];
}

// Danh mục các Engine mặc định sẵn có trong hệ thống
export const BUILTIN_ROUTER_ENGINES: EngineNodeConfig[] = [
  // 1. Translation Engines
  {
    id: 'engine-trans-gemini-2.5-flash',
    name: 'Google Gemini 2.5 Flash',
    serviceType: 'translation',
    protocol: 'gemini',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    status: 'ready',
    statusMessage: 'Cloud Key Pool tự động xoay tua',
  },
  {
    id: 'engine-trans-gemini-3.7-flash',
    name: 'Google Gemini 3.7 Flash',
    serviceType: 'translation',
    protocol: 'gemini',
    model: 'gemini-3.7-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    status: 'ready',
    statusMessage: 'Cloud Key Pool tự động xoay tua',
  },
  {
    id: 'engine-trans-deepseek-v3',
    name: 'DeepSeek V3 (OpenAI Compatible)',
    serviceType: 'translation',
    protocol: 'openai_compatible',
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    isCustom: true,
    status: 'ready',
    statusMessage: 'API Gateway tuân thủ chuẩn OpenAI',
  },
  {
    id: 'engine-trans-ollama-qwen',
    name: 'Qwen 2.5 7B Instruct (Ollama Local)',
    serviceType: 'translation',
    protocol: 'ollama',
    model: 'qwen2.5:14b',
    baseUrl: 'http://localhost:11434',
    status: 'ready',
    statusMessage: 'GPU NVIDIA RTX 3050 Cục bộ',
  },

  // 2. OCR Subtitle Extraction Engines
  {
    id: 'engine-ocr-ppocrv5',
    name: 'PP-OCRv5 Server (GPU NVDEC)',
    serviceType: 'ocr',
    protocol: 'ppocrv5',
    model: 'ppocrv5-server',
    status: 'ready',
    statusMessage: 'Chạy trực tiếp trên GPU CUDA',
  },
  {
    id: 'engine-ocr-rapidocr',
    name: 'RapidOCR ONNX FP16',
    serviceType: 'ocr',
    protocol: 'rapidocr',
    model: 'ch_PP-OCRv4_rec',
    status: 'ready',
    statusMessage: 'Siêu nhẹ ~550MB VRAM',
  },
  {
    id: 'engine-ocr-gemini-vlm',
    name: 'Gemini VLM Vision Multimodal',
    serviceType: 'ocr',
    protocol: 'gemini',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
    status: 'ready',
    statusMessage: 'Đọc phụ đề cứng từ khung hình video',
  },
  {
    id: 'engine-ocr-capcut-cloud',
    name: 'CapCut Cloud ASR (ByteDance)',
    serviceType: 'ocr',
    protocol: 'capcut',
    model: 'bytedance-speech-v2',
    baseUrl: 'https://editor-api-sg.capcutapi.com',
    status: 'ready',
    statusMessage: 'Tách lời thoại siêu tốc từ âm thanh',
  },

  // 3. Dubbing / TTS Engines
  {
    id: 'engine-tts-edge',
    name: 'Microsoft Edge-TTS',
    serviceType: 'dubbing',
    protocol: 'edge_tts',
    model: 'vi-VN-NamMinhNeural',
    status: 'ready',
    statusMessage: 'Miễn phí, giọng chuẩn truyền cảm',
  },
  {
    id: 'engine-tts-capcut',
    name: 'CapCut Viral Voice (ByteDance)',
    serviceType: 'dubbing',
    protocol: 'capcut',
    model: 'BV075_streaming',
    status: 'ready',
    statusMessage: 'Giọng đọc TikTok phong phú biểu cảm',
  },
  {
    id: 'engine-tts-gemini-audio',
    name: 'Google Gemini Native Audio',
    serviceType: 'dubbing',
    protocol: 'gemini',
    model: 'gemini-2.0-flash',
    status: 'ready',
    statusMessage: 'Giọng AI thế hệ mới với phong cách tùy biến',
  },
];

const STORAGE_KEY = 'sls_engine_router_matrix_v1';

export function loadRouterMatrix(): RoutingServiceMatrix[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Lỗi khi đọc Router Matrix từ localStorage:', e);
  }

  // Khởi tạo mặc định nếu chưa có
  return [
    {
      serviceType: 'translation',
      displayName: 'Dịch Thuật Văn Bản (AI Translation)',
      description: 'Điều phối các mô hình ngôn ngữ dịch thuật phụ đề theo ngữ cảnh văn hóa.',
      activeEngineId: 'engine-trans-gemini-2.5-flash',
      fallbackEngineId: 'engine-trans-ollama-qwen',
      autoFallback: true,
      availableEngines: BUILTIN_ROUTER_ENGINES.filter((e) => e.serviceType === 'translation'),
    },
    {
      serviceType: 'ocr',
      displayName: 'Trích Xuất Phụ Đề (OCR / ASR)',
      description: 'Nhận dạng chữ trên video hoặc trích xuất lời thoại từ âm thanh.',
      activeEngineId: 'engine-ocr-ppocrv5',
      fallbackEngineId: 'engine-ocr-gemini-vlm',
      autoFallback: true,
      availableEngines: BUILTIN_ROUTER_ENGINES.filter((e) => e.serviceType === 'ocr'),
    },
    {
      serviceType: 'dubbing',
      displayName: 'Giọng Đọc Thuyết Minh (TTS Dubbing)',
      description: 'Chuyển văn bản thành giọng đọc truyền cảm lồng ghép vào video.',
      activeEngineId: 'engine-tts-edge',
      fallbackEngineId: 'engine-tts-capcut',
      autoFallback: true,
      availableEngines: BUILTIN_ROUTER_ENGINES.filter((e) => e.serviceType === 'dubbing'),
    },
  ];
}

export function saveRouterMatrix(matrix: RoutingServiceMatrix[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(matrix));
    window.dispatchEvent(new CustomEvent('engine-router-matrix-updated', { detail: matrix }));
  } catch (e) {
    console.error('Lỗi khi lưu Router Matrix vào localStorage:', e);
  }
}
