import { defineConfig } from 'vitest/config';

const coreCoverageFiles = [
  'shared/ackKeys.ts',
  'server/authorization.ts',
  'server/backupPersistence.ts',
  'server/joinAccess.ts',
  'server/protocolValidation.ts',
  'server/recoveryState.ts',
  'server/roomClosure.ts',
  'server/roomInvariants.ts',
  'server/roomOperationGuards.ts',
  'server/roomSessions.ts',
  'server/suggestions.ts',
  'server/trackedResponses.ts',
  'src/core/DocumentSync.ts',
  'src/core/OutboundMessageQueue.ts',
  'src/core/SuggestionManager.ts',
  'src/core/roomMetadata.ts',
  'src/core/storagePaths.ts',
  'src/core/storageRetention.ts',
  'src/ui/chatRenderPlan.ts',
  'src/ui/viewState.ts',
  'src/util/roomNotices.ts'
];

export default defineConfig({
  test: {
    exclude: [
      'node_modules/**',
      '.coverage-v8/**',
      'coverage/**',
      'out/**',
      'out-server/**',
      'tests/serverStress.test.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      all: false,
      include: coreCoverageFiles,
      exclude: [
        'tests/**',
        'server/**/*.test.ts',
        'server/logger.ts',
        'server/server.ts',
        'server/types.ts',
        'shared/protocol.ts',
        'src/connection/**/*.ts',
        'src/extension.ts',
        'src/core/ChatManager.ts',
        'src/core/CursorManager.ts',
        'src/core/FollowController.ts',
        'src/core/RoomState.ts',
        'src/core/RoomStorage.ts',
        'src/ui/ChatView.ts',
        'src/ui/ParticipantsView.ts',
        'src/ui/StatusBarManager.ts',
        'src/ui/participantsIcons.ts',
        'src/util/config.ts',
        'src/util/crypto.ts',
        'src/util/logger.ts',
        'src/util/roomSecrets.ts'
      ],
      thresholds: {
        perFile: true,
        lines: 50,
        functions: 50,
        statements: 50,
        branches: 45
      }
    }
  }
});
