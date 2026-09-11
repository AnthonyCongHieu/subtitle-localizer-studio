import { BridgeEventV1 } from '../types/api';

export type WsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export class StudioWebSocketClient {
  private ws: WebSocket | null = null;
  private lastSequence: number = 0;
  private listeners: ((event: BridgeEventV1) => void)[] = [];
  private statusListeners: ((status: WsConnectionStatus) => void)[] = [];
  private currentStatus: WsConnectionStatus = 'disconnected';
  private isConnecting: boolean = false;
  private reconnectTimer: any = null;
  private currentServerId: string | null = null;

  private notifyStatus(status: WsConnectionStatus) {
    this.currentStatus = status;
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (err) {
        console.error('Lỗi trong statusListener WebSocket:', err);
      }
    });
  }

  getStatus(): WsConnectionStatus {
    return this.currentStatus;
  }

  isConnected(): boolean {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  onStatusChange(callback: (status: WsConnectionStatus) => void): () => void {
    this.statusListeners.push(callback);
    // Bắn trạng thái hiện tại ngay khi đăng ký để UI đồng bộ tức thì
    callback(this.currentStatus);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== callback);
    };
  }

  connect() {
    if (this.isConnecting || (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    this.notifyStatus(this.currentStatus === 'reconnecting' ? 'reconnecting' : 'connecting');

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/api/v1/ws?after_sequence=${this.lastSequence}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = async () => {
        this.isConnecting = false;
        this.notifyStatus('connected');
        // Kiểm tra server_id khi kết nối / kết nối lại để tự động reload UI nếu server vừa restart/cập nhật
        try {
          const res = await fetch('/api/v1/health');
          if (res.ok) {
            const data = await res.json();
            const newServerId = data?.server_id;
            if (newServerId) {
              if (this.currentServerId && this.currentServerId !== newServerId) {
                console.warn('[Studio] Máy chủ đã cập nhật/khởi động lại. Đang tự động tải lại giao diện...');
                window.location.reload();
                return;
              }
              this.currentServerId = newServerId;
            }
          }
        } catch {
          // Bỏ qua nếu chưa sẵn sàng
        }
      };

      this.ws.onmessage = (e) => {
        try {
          const event: BridgeEventV1 = JSON.parse(e.data);
          // Kiểm tra sự kiện khởi động server hoặc cập nhật phiên bản server
          if (event.event_type === 'server_restarted') {
            console.warn('[Studio] Nhận tín hiệu server cập nhật. Đang tự động tải lại giao diện...');
            window.location.reload();
            return;
          }
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
        this.notifyStatus('reconnecting');
        // Tự động kết nối lại sau 2 giây
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        this.notifyStatus('disconnected');
        this.ws?.close();
      };
    } catch (err) {
      this.isConnecting = false;
      this.notifyStatus('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    }
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

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnecting = false;
    this.notifyStatus('disconnected');
  }
}

export const wsClient = new StudioWebSocketClient();
