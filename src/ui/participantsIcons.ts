import * as vscode from 'vscode';
import { Role } from '../connection/MessageTypes';

export function roleIcon(role?: Role): vscode.ThemeIcon {
  switch (role) {
    case 'root':
      return new vscode.ThemeIcon('crown');
    case 'collaborator':
      return new vscode.ThemeIcon('pencil');
    case 'viewer':
      return new vscode.ThemeIcon('eye');
    default:
      return new vscode.ThemeIcon('question');
  }
}
