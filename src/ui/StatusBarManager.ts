import * as vscode from 'vscode';
import { RoomState } from '../core/RoomState';
import { FollowController } from '../core/FollowController';
import { buildStatusBarViewModel, ConnectionState } from './viewState';

export class StatusBarManager {
  private readonly item: vscode.StatusBarItem;
  private connectionState: ConnectionState = 'disconnected';
  private connectionDetail?: string;
  private reconnectAttempt = 0;

  constructor(private readonly roomState: RoomState, private readonly followController?: FollowController) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'coderooms.openParticipantsView';
    this.update();
    this.item.show();
  }

  setConnectionState(state: ConnectionState, detail?: string, reconnectAttempt?: number): void {
    this.connectionState = state;
    this.connectionDetail = detail;
    if (reconnectAttempt !== undefined) {
      this.reconnectAttempt = reconnectAttempt;
    }
    this.update();
  }

  update(): void {
    const presentation = buildStatusBarViewModel({
      connectionState: this.connectionState,
      connectionDetail: this.connectionDetail,
      reconnectAttempt: this.reconnectAttempt,
      roomId: this.roomState.getRoomId(),
      role: this.roomState.getRole(),
      activeDocumentLabel: this.roomState.getActiveSharedDocLabel(),
      participantCount: this.roomState.getParticipants().length,
      isFollowing: this.followController?.isFollowing() ?? false,
      collaboratorDirectMode: this.roomState.isCollaboratorInDirectMode()
    });

    this.item.text = presentation.text;
    this.item.tooltip = presentation.tooltip;
    this.item.command = presentation.command;
    this.item.backgroundColor = presentation.emphasis === 'warning'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : presentation.emphasis === 'error'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
