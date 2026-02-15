import { Logger } from '@ixo/logger';
import { MatrixManager } from '@ixo/matrix';

const matrixManager = MatrixManager.getInstance();

interface IAction {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  error?: string;
  success: boolean;
}

export async function logActionToMatrix(
  action: IAction,
  config: {
    roomId: string;
    threadId?: string;
  },
) {
  if (!matrixManager.getInitializationStatus().isInitialized) {
    await matrixManager.init();
  }
  matrixManager
    .sendActionLog(config.roomId, action, config.threadId)
    .catch((error) => {
      Logger.error('Error sending action to matrix:', error);
    });
}
