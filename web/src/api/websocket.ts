import { BridgeEventV1 } from '../types/api';

export class StudioWebSocketClient {
  private ws: WebSocket | null = null;
  private lastSequence: number = 0;
  private listeners: ((event: BridgeEventV1) => void)[] = [];
  private isConnecting: boolean = false;

  connect() {
    if (this.isConnecting || (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))) {
      return;
    }
    this.isConnecting = true;
    const url = `ws://127.0.0.1:8000/api/v1/ws?after_sequence=${this.lastSequence}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.isConnecting = false;
    };

    this.ws.onmessage = (e) => {
      try {
        const event: BridgeEventV1 = JSON.parse(e.data);
        if (event.sequence) {
          this.lastSequence = Math.max(this.lastSequence, event.sequence);
        }
        this.listeners.forEach((listener) => listener(event));
      } catch (err) {
        console.error('Lỗi phân tích WebSocket message:', err);
      }
    };

    this.ws.onclose = () => {
      this.isConnecting = false;
      // Tự động kết nối lại sau 2 giây
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  onEvent(callback: (event: BridgeEventV1) => void) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}

export const wsClient = new StudioWebSocketClient();
