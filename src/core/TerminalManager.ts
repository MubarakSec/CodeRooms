import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../util/logger';
import * as cp from 'child_process';
import * as os from 'os';

export class TerminalManager {
  private disposables: vscode.Disposable[] = [];
  
  // Host state
  private sharedTerminals = new Map<string, { terminal: vscode.Terminal, process: cp.ChildProcess, isReadOnly: boolean }>();
  
  // Collaborator state
  private remoteTerminals = new Map<string, { terminal: vscode.Terminal, writeEmitter: vscode.EventEmitter<string> }>();

  constructor(
    private readonly sendTerminalCreate: (terminalId: string, name: string, isReadOnly: boolean) => void,
    private readonly sendTerminalData: (terminalId: string, data: string) => void,
    private readonly sendTerminalInput: (terminalId: string, data: string) => void,
    private readonly sendTerminalClose: (terminalId: string) => void
  ) {
    this.disposables.push(
      vscode.window.onDidCloseTerminal(terminal => {
        // If it's a terminal we were sharing, notify the server and kill process
        for (const [id, entry] of this.sharedTerminals.entries()) {
          if (entry.terminal === terminal) {
            entry.process.kill();
            this.sharedTerminals.delete(id);
            this.sendTerminalClose(id);
            return;
          }
        }
        // If it's a remote terminal that was closed locally by the user, we just clean up
        for (const [id, t] of this.remoteTerminals.entries()) {
          if (t.terminal === terminal) {
            this.remoteTerminals.delete(id);
            return;
          }
        }
      })
    );
  }

  public createAndShareTerminal(isReadOnly: boolean = true): void {
    const id = uuidv4();
    const writeEmitter = new vscode.EventEmitter<string>();
    
    // Simple shell fallback without full PTY
    const shell = os.platform() === 'win32' ? 'cmd.exe' : 'bash';
    const child = cp.spawn(shell, [], {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
      env: process.env
    });

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      // Normalize line endings for VS Code terminal
      const normalized = text.replace(/\r?\n/g, '\r\n');
      writeEmitter.fire(normalized);
      this.sendTerminalData(id, normalized);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      const normalized = text.replace(/\r?\n/g, '\r\n');
      writeEmitter.fire(normalized);
      this.sendTerminalData(id, normalized);
    });

    child.on('close', () => {
      writeEmitter.fire('\r\n[Process Exited]\r\n');
      this.sendTerminalClose(id);
    });

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {
        logger.info(`Opened shared terminal: CodeRooms Shared Shell`);
      },
      close: () => {
        child.kill();
      },
      handleInput: (data: string) => {
        // Echo input for basic local echo (since it's not a real PTY)
        writeEmitter.fire(data === '\r' ? '\r\n' : data);
        if (data === '\r') {
          child.stdin.write('\n');
        } else {
          child.stdin.write(data);
        }
      }
    };

    const terminal = vscode.window.createTerminal({ name: `Shared Shell`, pty });
    this.sharedTerminals.set(id, { terminal, process: child, isReadOnly });
    this.sendTerminalCreate(id, 'Shared Shell', isReadOnly);
    terminal.show();
    logger.info(`Started sharing terminal (id: ${id}, readOnly: ${isReadOnly})`);
  }

  // Called on the Host when a collaborator types
  public handleTerminalInputFromRemote(terminalId: string, data: string): void {
    const shared = this.sharedTerminals.get(terminalId);
    if (shared && !shared.isReadOnly && shared.process.stdin) {
      if (data === '\r') {
        shared.process.stdin.write('\n');
      } else {
        shared.process.stdin.write(data);
      }
    }
  }

  public handleTerminalCreate(terminalId: string, name: string, isReadOnly: boolean = true): void {
    if (this.remoteTerminals.has(terminalId)) {
      return;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {
        logger.info(`Opened remote terminal: ${name}`);
      },
      close: () => {
        logger.info(`Closed remote terminal: ${name}`);
      },
      handleInput: (data: string) => {
        if (!isReadOnly) {
          this.sendTerminalInput(terminalId, data);
        } else {
          void vscode.window.showWarningMessage('This shared terminal is read-only.');
        }
      }
    };

    const modeStr = isReadOnly ? 'Read-Only' : 'Read/Write';
    const terminal = vscode.window.createTerminal({ name: `[Remote] ${name} (${modeStr})`, pty });
    this.remoteTerminals.set(terminalId, { terminal, writeEmitter });
    terminal.show();
  }

  public handleTerminalData(terminalId: string, data: string): void {
    const remote = this.remoteTerminals.get(terminalId);
    if (remote) {
      remote.writeEmitter.fire(data);
    }
  }

  public handleTerminalClose(terminalId: string): void {
    const remote = this.remoteTerminals.get(terminalId);
    if (remote) {
      remote.terminal.dispose();
      this.remoteTerminals.delete(terminalId);
    }
  }

  public reset(): void {
    for (const remote of this.remoteTerminals.values()) {
      remote.terminal.dispose();
    }
    this.remoteTerminals.clear();
    for (const shared of this.sharedTerminals.values()) {
      shared.process.kill();
      shared.terminal.dispose();
    }
    this.sharedTerminals.clear();
  }

  public dispose(): void {
    this.reset();
    this.disposables.forEach(d => d.dispose());
  }
}