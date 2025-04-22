import { getAuthHeadersValue } from '@/common/get-auth-headers-value.js';
import { Entities } from '@ixo/oracles-chain-client';
import Payments from '@ixo/oracles-chain-client/client/payments/payments';
import { z } from 'zod';
import {
  validateRequestBody,
  validateRequestParams,
} from 'zod-express-middleware';
import AsyncRouter from '../common/AsyncRouter.js';
import envService from '../env/index.js';
import { checkIfOracleHasClaimSubmitAuthorization } from '@/services/authz/authz.js';
export const paymentsRouter = AsyncRouter();

const payments = new Payments();

const schema = z.object({
  amount: z
    .object({
      amount: z.string(),
      denom: z.string(),
    })
    .optional(),
  userAddress: z.string(),
});

paymentsRouter.post('/pay', validateRequestBody(schema), async (req, res) => {
  const { amount: _amount, userAddress } = req.body;
  
  const granteeAddress = envService.get('ORACLE_ADDRESS');
  const hasClaimSubmitAuthorization = await checkIfOracleHasClaimSubmitAuthorization({
    granterAddress: userAddress,
    oracleDid: envService.get('ORACLE_DID'),
  })

  if (!hasClaimSubmitAuthorization) {
    return res.status(400).json({
      message: 'Oracle does not have claim submit authorization',
    });
  }

  let amount = _amount;
  if (!amount) {
    const priceList = await getPriceList();
    amount = priceList[0].amount;
  }

  // check for active intent
  const activeIntent = await payments.checkForActiveIntent({
    amount,
    userAddress,
    granteeAddress,
  });
  if (activeIntent) {
    return res.status(400).json({
      message: 'Payment already initiated; please evaluate the claim',
    });
  }

  // submit intent to user's claim collection
  await payments.sendPaymentToEscrow({
    amount,
    userAddress,
    granteeAddress,
  });
  return res.status(200).json({
    message: 'Payment initiated',
  });
});

paymentsRouter.post(
  '/intent/status',
  validateRequestBody(
    schema.merge(
      z.object({
        granteeAddress: z.string(),
      }),
    ),
  ),
  async (req, res) => {
    const priceList = await getPriceList(envService.get('ORACLE_DID'));
    const { amount: _amount, userAddress, granteeAddress } = req.body;
    const amount = _amount ?? priceList[0].amount;
    const activeIntent = await payments.checkForActiveIntent({
      amount,
      userAddress,
      granteeAddress,
    });
    return res.status(200).json({
      activeIntent: !!activeIntent,
    });
  },
);

paymentsRouter.get(
  '/outstanding/:userAddress',
  validateRequestParams(
    z.object({
      userAddress: z.string(),
    }),
  ),
  async (req, res) => {
    const outstanding = await payments.getOutstandingPayments({
      userAddress: req.params.userAddress,
      oracleAddress: envService.get('ORACLE_ADDRESS'),
    });
    return res.status(200).json({ outstanding });
  },
);

export const getPriceList = async (
  oracleDid = envService.get('ORACLE_DID'),
) => {
  try {
    const priceList = await Entities.getOraclePricingList(oracleDid);
    return priceList;
  } catch (error) {
    return [
      {
        amount: {
          amount: '1000',
          denom: 'uixo',
        },
        title: 'Domain Creation',
        description: 'Create a domain',
      },
    ];
  }
};
