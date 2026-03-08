import { getClientMessageAckKey } from '../shared/ackKeys';
import { ClientToServerMessage, ServerToClientMessage } from './types';

export function buildTrackedErrorResponses(
  message: ClientToServerMessage,
  errorMessage: string,
  code: string
): ServerToClientMessage[] {
  const responses: ServerToClientMessage[] = [{ type: 'error', message: errorMessage, code }];
  const ackKey = getClientMessageAckKey(message);
  if (ackKey) {
    responses.push({ type: 'ack', key: ackKey });
  }
  return responses;
}
