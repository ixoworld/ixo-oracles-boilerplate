import { Logger } from '@ixo/logger';
import { Authz } from '@ixo/oracles-chain-client';
import express, { type Request, type Response, type Router } from 'express';

const router: Router = express.Router();
// Create a logger instance with a context for routes
const routeLogger = Logger.getInstance().setContext('Routes');

// GET / - Get configuration
router.get('/config/:domainDid', async (req: Request, res: Response) => {
  try {
    const domainDid = req.params.domainDid;
    if (!domainDid) {
      return res.status(400).json({ error: 'Domain DID is required' });
    }

    const config = await Authz.getOracleAuthZConfig({
      oracleDid: domainDid,
      granterAddress: '0x0000000000000000000000000000000000000000',
    });

    routeLogger.info('Configuration fetched successfully');
    return res.json({ config });
  } catch (error) {
    routeLogger.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

export default router;
