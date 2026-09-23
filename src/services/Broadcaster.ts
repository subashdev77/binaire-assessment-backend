import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';

export type BroadcastEventType = 
  | 'QUEUE_SNAPSHOT'
  | 'JOB_STATUS_CHANGED'
  | 'JOB_PROGRESS'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  | 'WORKER_UPDATE'
  | 'SYSTEM_METRICS';

export interface BroadcastMessage {
  type: BroadcastEventType;
  payload: any;
  timestamp: number;
}

/**
 * Real-time event broadcasting service using WebSockets.
 * Broadcasts system and queue state to all connected client machines.
 */
export class Broadcaster {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  public attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('WebSocket client error:', err);
        this.clients.delete(ws);
      });

      // Send initial hello
      this.sendToClient(ws, {
        type: 'SYSTEM_METRICS',
        payload: { connectedClients: this.clients.size, message: 'Connected to Queue Engine' },
        timestamp: Date.now()
      });
    });
  }

  public broadcast(type: BroadcastEventType, payload: any): void {
    const message: BroadcastMessage = {
      type,
      payload,
      timestamp: Date.now()
    };
    const serialized = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }

  private sendToClient(client: WebSocket, message: BroadcastMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  public getConnectedClientCount(): number {
    return this.clients.size;
  }
}
