import { getAuthHeadersValue } from '@/common/get-auth-headers-value.js';
import { DomainOracleService } from '@/services/domain-oracle/domain-oracle.service.js';
import { sendMessageSchema } from '@/services/domain-oracle/schema.js';
import { Logger } from '@ixo/logger';
import Payments from '@ixo/oracles-chain-client/client/payments/payments';
import httpErrors from 'http-errors';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';
import AsyncRouter from '../common/AsyncRouter.js';
import envService from '../env/index.js';
import { getPriceList } from './payments.js';

export const messagesRouter = AsyncRouter();
const oracleService = new DomainOracleService();
const payments = new Payments();

messagesRouter.get(
  '/:sessionId',
  validateRequest({
    params: z.object({
      sessionId: z.string(),
    }),
  }),
  async (req, res) => {
    try {
      const { did, matrixAccessToken } = getAuthHeadersValue(req);

      const { sessionId } = req.params;

      const messages = await oracleService.listMessages({
        sessionId,
        matrixAccessToken,
        did,
      });
      return res.status(200).json(messages);
    } catch (error) {
      Logger.error('Error listing messages', error);
      throw httpErrors.BadRequest('Error listing messages' + error.message);
    }
  },
);

messagesRouter.post(
  '/:sessionId?',
  validateRequest({
    params: z.object({
      sessionId: z.string().optional(),
    }),
    body: sendMessageSchema,
  }),
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { message, stream } = req.body;
      const priceList = await getPriceList();
      const { did, matrixAccessToken } = getAuthHeadersValue(req);
      const userHasActiveIntent = await payments.checkForActiveIntent({
        amount: priceList[0].amount,
        userAddress: did,
        granteeAddress: envService.get('ORACLE_ADDRESS'),
      });

      // if (!userHasActiveIntent) {
      //   throw new httpErrors.PaymentRequired(
      //     'User has no active intent to send message; please use the /payments/pay endpoint to create an intent',
      //   );
      // }

      const result = await oracleService.sendMessage({
        sessionId,
        matrixAccessToken,
        did,
        message,
        stream: stream ?? false,
        res,
      });

      if (!stream) {
        return res.status(200).json(result);
      }
    } catch (error) {
      if (error instanceof httpErrors.PaymentRequired) {
        return res.status(402).json({
          message: error.message,
        });
      }
      Logger.error('Error sending message', error);
      throw httpErrors.BadRequest('Error sending message' + error.message);
    }
  },
);
