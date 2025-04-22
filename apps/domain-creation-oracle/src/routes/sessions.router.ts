import { getAuthHeadersValue } from '@/common/get-auth-headers-value.js';
import { SessionManagerService } from '@ixo/common';
import { Logger } from '@ixo/logger';
import httpErrors from 'http-errors';
import { ORACLE_NAME } from 'src/config.js';
import AsyncRouter from '../common/AsyncRouter.js';
export const sessionsRouter = AsyncRouter();

const sessionManager = new SessionManagerService();

sessionsRouter.post('/', async (req, res) => {
  try {
    const { matrixAccessToken, did } = getAuthHeadersValue(req);
    const session = await sessionManager.createSession({
      did,
      matrixAccessToken,
      oracleName: ORACLE_NAME,
    });
    return res.status(201).json(session);
  } catch (error) {
    Logger.error('SessionsError', error);
    throw httpErrors.BadRequest('SessionsError' + error.message);
  }
});

sessionsRouter.get('/', async (req, res) => {
  try {
    const { matrixAccessToken, did } = getAuthHeadersValue(req);
    const sessions = await sessionManager.listSessions({
      matrixAccessToken,
      did,
    });

    const sortedSessions = sessions.sessions.sort((a, b) => {
      return new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime();
    });
    return res.status(200).json({
      sessions: sortedSessions,
    });
  } catch (error) {
    Logger.error('SessionsError', error);
    throw httpErrors.BadRequest('SessionsError' + error.message);
  }
});

sessionsRouter.delete('/:sessionId', async (req, res) => {
  try {
    const { matrixAccessToken, did } = getAuthHeadersValue(req);
    const { sessionId } = req.params;
    await sessionManager.deleteSession({
      matrixAccessToken,
      did,
      sessionId,
    });
    return res.status(200).json({ message: 'Session deleted' });
  } catch (error) {
    Logger.error('SessionsError', error);
    throw httpErrors.BadRequest('SessionsError' + error.message);
  }
});
