import * as net from 'net';
import * as fs from 'fs';
import { IPC_SOCKET_PATH } from '../shared/constants';
import { JsonRpcRequest, JsonRpcResponse } from '../shared/types';

export type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class IpcServer {
  private server: net.Server;
  private handler: RequestHandler;

  constructor(handler: RequestHandler) {
    this.handler = handler;
    this.server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', async (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const req: JsonRpcRequest = JSON.parse(line);
            const result = await this.handler(req.method, req.params ?? {});
            const resp: JsonRpcResponse = { jsonrpc: '2.0', result, id: req.id };
            socket.write(JSON.stringify(resp) + '\n');
          } catch (err) {
            const resp: JsonRpcResponse = {
              jsonrpc: '2.0',
              error: { code: -32603, message: String(err) },
              id: 0,
            };
            socket.write(JSON.stringify(resp) + '\n');
          }
        }
      });
      socket.on('error', () => {});
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      if (fs.existsSync(IPC_SOCKET_PATH)) {
        fs.unlinkSync(IPC_SOCKET_PATH);
      }
      this.server.listen(IPC_SOCKET_PATH, () => resolve());
    });
  }

  stop(): void {
    this.server.close();
    if (fs.existsSync(IPC_SOCKET_PATH)) {
      fs.unlinkSync(IPC_SOCKET_PATH);
    }
  }
}

export async function sendIpcRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(IPC_SOCKET_PATH);
    let buffer = '';
    const req: JsonRpcRequest = { jsonrpc: '2.0', method, params, id: Date.now() };
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp: JsonRpcResponse = JSON.parse(line);
          if (resp.error) {
            reject(new Error(resp.error.message));
          } else {
            resolve(resp.result);
          }
        } catch {
          // ignore
        }
      }
    });
    socket.on('error', reject);
    socket.write(JSON.stringify(req) + '\n');
    socket.end();
  });
}
