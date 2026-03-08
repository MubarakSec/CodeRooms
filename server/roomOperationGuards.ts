export interface RoomOperationGuards {
  beginConnectionOperation(connectionId: string): boolean;
  endConnectionOperation(connectionId: string): void;
  beginJoinClaim(roomId: string, claimKey: string): boolean;
  endJoinClaim(roomId: string, claimKey: string): void;
}

export function createRoomOperationGuards(): RoomOperationGuards {
  const pendingConnectionOps = new Set<string>();
  const pendingJoinClaims = new Map<string, Set<string>>();

  return {
    beginConnectionOperation(connectionId: string): boolean {
      if (pendingConnectionOps.has(connectionId)) {
        return false;
      }
      pendingConnectionOps.add(connectionId);
      return true;
    },

    endConnectionOperation(connectionId: string): void {
      pendingConnectionOps.delete(connectionId);
    },

    beginJoinClaim(roomId: string, claimKey: string): boolean {
      const claims = pendingJoinClaims.get(roomId) ?? new Set<string>();
      if (claims.has(claimKey)) {
        return false;
      }
      claims.add(claimKey);
      pendingJoinClaims.set(roomId, claims);
      return true;
    },

    endJoinClaim(roomId: string, claimKey: string): void {
      const claims = pendingJoinClaims.get(roomId);
      if (!claims) {
        return;
      }
      claims.delete(claimKey);
      if (claims.size === 0) {
        pendingJoinClaims.delete(roomId);
      }
    }
  };
}

export function getJoinClaimKey(options: {
  token?: string;
  sessionToken?: string;
  connectionId: string;
}): string {
  if (options.token) {
    return `token:${options.token}`;
  }
  if (options.sessionToken) {
    return `session:${options.sessionToken}`;
  }
  return `connection:${options.connectionId}`;
}
