import * as vscode from 'vscode';

export class FollowController {
  public stateVersion = 0;
  private followingRoot = false;
  private readonly emitter = new vscode.EventEmitter<boolean>();

  readonly onDidChange = this.emitter.event;

  isFollowing(): boolean {
    return this.followingRoot;
  }

  setFollowing(value: boolean): void {
    if (this.followingRoot === value) {
      return;
    }
    this.followingRoot = value;
    this.stateVersion++;
    this.emitter.fire(this.followingRoot);
  }

  toggle(): void {
    this.setFollowing(!this.followingRoot);
  }

  reset(): void {
    this.setFollowing(false);
  }
}
