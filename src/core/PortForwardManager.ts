import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../util/logger';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export class PortForwardManager {
  private disposables: vscode.Disposable[] = [];
  
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;
  
  // Host state
  private sharedPorts = new Set<number>();
  
  // Collaborator state: port -> local http server
  private localServers = new Map<number, http.Server>();
  
  // Pending requests mapping: requestId -> { res: http.ServerResponse }
  private pendingRequests = new Map<string, { res: http.ServerResponse, timer: NodeJS.Timeout }>();

  constructor(
    private readonly sendTunnelStart: (port: number) => void,
    private readonly sendTunnelRequest: (requestId: string, port: number, method: string, path: string, headers: Record<string, string>, body?: string) => void,
    private readonly sendTunnelResponse: (requestId: string, statusCode: number, headers: Record<string, string>, body?: string, error?: string) => void
  ) {}

  public getSharedPorts(): number[] {
    return Array.from(this.sharedPorts);
  }

  public getLocalServers(): number[] {
    return Array.from(this.localServers.keys());
  }

  // --- Host Methods ---

  public sharePort(port: number): void {
    if (this.sharedPorts.has(port)) {
      void vscode.window.showInformationMessage(`Port ${port} is already being shared.`);
      return;
    }
    this.sharedPorts.add(port);
    this._onDidChange.fire();
    this.sendTunnelStart(port);
    logger.info(`Started sharing port ${port}`);
    void vscode.window.showInformationMessage(`Sharing port ${port} with the room.`);
  }

  public async handleTunnelRequest(requestId: string, port: number, method: string, path: string, headers: Record<string, string>, body?: string): Promise<void> {
    if (!this.sharedPorts.has(port)) {
      this.sendTunnelResponse(requestId, 502, {}, undefined, `Port ${port} is not being shared.`);
      return;
    }

    try {
      const targetUrl = new URL(path, `http://127.0.0.1:${port}`);
      
      const options: http.RequestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: method,
        headers: headers
      };

      const req = http.request(options, (res) => {
        let responseBody = '';
        res.setEncoding('base64'); // Transfer binary data as base64 safely
        
        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          this.sendTunnelResponse(requestId, res.statusCode || 200, res.headers as Record<string, string>, responseBody);
        });
      });

      req.on('error', (e) => {
        logger.error(`Error forwarding request to port ${port}: ${e.message}`);
        this.sendTunnelResponse(requestId, 502, {}, undefined, `Bad Gateway: ${e.message}`);
      });

      if (body) {
        req.write(Buffer.from(body, 'base64'));
      }
      req.end();

    } catch (e) {
       this.sendTunnelResponse(requestId, 500, {}, undefined, `Internal proxy error: ${String(e)}`);
    }
  }

  // --- Collaborator Methods ---

  public handleTunnelStart(port: number): void {
    if (this.localServers.has(port)) return;

    const server = http.createServer((req, res) => {
      const requestId = uuidv4();
      
      let requestBody = '';
      req.setEncoding('base64');
      req.on('data', chunk => {
        requestBody += chunk;
      });

      req.on('end', () => {
        // Send the request to the host
        this.sendTunnelRequest(
          requestId,
          port,
          req.method || 'GET',
          req.url || '/',
          req.headers as Record<string, string>,
          requestBody.length > 0 ? requestBody : undefined
        );

        // Store response object to complete it later
        const timer = setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            const pending = this.pendingRequests.get(requestId)!;
            pending.res.writeHead(504, { 'Content-Type': 'text/plain' });
            pending.res.end('Gateway Timeout: Host did not respond in time.');
            this.pendingRequests.delete(requestId);
          }
        }, 30000); // 30 second timeout

        this.pendingRequests.set(requestId, { res, timer });
      });
    });

    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        logger.warn(`Port ${port} is already in use locally, trying to bind on a random port...`);
        // We could bind to port 0 here, but for simplicity we just log. 
        // In a full implementation, we'd pick a dynamic port and show a notification.
        void vscode.window.showWarningMessage(`CodeRooms: Host shared port ${port}, but it is in use on your machine.`);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      logger.info(`Collaborator listening on localhost:${port} to proxy to host.`);
      this._onDidChange.fire();
      void vscode.window.showInformationMessage(`Host is sharing port ${port}. You can access it at http://localhost:${port}`);
    });

    this.localServers.set(port, server);
    // Also fire right away so it shows up in UI as 'starting...' or similar if we wanted,
    // but the listen callback is fast enough.
  }

  public handleTunnelResponse(requestId: string, statusCode: number, headers: Record<string, string>, body?: string, error?: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);

    const { res } = pending;

    if (error) {
      res.writeHead(statusCode || 502, { 'Content-Type': 'text/plain' });
      res.end(error);
      return;
    }

    try {
      res.writeHead(statusCode, headers);
      if (body) {
        res.end(Buffer.from(body, 'base64'));
      } else {
        res.end();
      }
    } catch (e) {
      logger.error(`Error writing response to local browser: ${String(e)}`);
      res.socket?.destroy(); // Force close
    }
  }

  public reset(): void {
    this.sharedPorts.clear();
    
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.res.writeHead(503, { 'Content-Type': 'text/plain' });
      pending.res.end('Service Unavailable: Connection reset');
    }
    this.pendingRequests.clear();

    for (const server of this.localServers.values()) {
      server.close();
    }
    this.localServers.clear();
    this._onDidChange.fire();
  }

  public dispose(): void {
    this.reset();
    this.disposables.forEach(d => d.dispose());
  }
}