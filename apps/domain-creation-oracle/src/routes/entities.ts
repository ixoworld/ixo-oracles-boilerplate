import { Entities } from '@ixo/oracles-chain-client';
import { z } from 'zod';
import { validateRequestBody } from 'zod-express-middleware';
import AsyncRouter from '../common/AsyncRouter.js';

export const entitiesRouter = AsyncRouter();
const entities = new Entities();

entitiesRouter.post(
  '/',
  validateRequestBody(
    z.object({
      message: z.instanceof(Uint8Array).or(z.array(z.number())).or(z.string()),
    }),
  ),
  async (req, res) => {
    try {
      const { message } = req.body;
      let buffer: Buffer;

      if (message instanceof Uint8Array) {
        buffer = Buffer.from(message);
      } else if (Array.isArray(message)) {
        buffer = Buffer.from(message);
      } else {
        buffer = Buffer.from(message, 'utf-8');
      }
      const entity = await entities.create(buffer);

      // Process the buffer here

      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error processing entity:', error);
      res
        .status(400)
        .json({ error: 'Error processing entity: ' + error.message });
    }
  },
);
