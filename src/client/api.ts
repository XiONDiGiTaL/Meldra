import type { Settings } from './settings.js';
import type { BaseRoom } from './net.js';
import type { GameMode } from '../shared/types.js';

export interface AppApi {
  settings: Settings;
  room: BaseRoom | null;
  setPalette(id: string): void;
  setName(name: string): void;
  updateSettings(patch: Partial<Settings>): void;
  playTogether(mode: GameMode): void;
  joinRoom(code: string): boolean;
  practice(mode: GameMode): void;
  openHelp(): void;
  showHome(): void;
  showLobby(): void;
  leaveRoom(): void;
  refresh(): void;
}
