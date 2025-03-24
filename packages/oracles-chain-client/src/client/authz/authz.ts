import {
  cosmos,
  createQueryClient,
  ixo,
  QueryClient,
  utils,
} from '@ixo/impactxclient-sdk';
import { ValidationError } from '../../utils/validation-error.js';
import { addDays } from '../../utils/general.js';
import { Entities } from '../entities/entity.js';
import {
  AuthorizationType,
  GetOracleAuthZConfigParams,
  IAuthzConfig,
  Permission,
  TransactionFn,
  validateAuthzConfig,
} from './types.js';

export class Authz {
  constructor(
    private readonly config: IAuthzConfig,
    private readonly queryClientPromise: Promise<QueryClient> = createQueryClient(
      process.env.RPC_URL ?? '',
    ),
  ) {
    if (!process.env.RPC_URL) {
      throw new Error('RPC_URL is not set');
    }
    this.config = validateAuthzConfig(config);
  }

  /**
   * Grants the permissions to the grantee address
   * @param overrideConfig - Optional override config
   * @returns The generic and send authorizations
   */
  public async grant(
    transactionFn: TransactionFn,
    overrideConfig?: Partial<IAuthzConfig>,
  ) {
    const {
      granteeAddress,
      granterAddress,
      oracleName,
      expirationDays = 30,
      spendLimit,
      requiredPermissions,
    } = {
      ...this.config,
      ...overrideConfig,
    };

    const genericAuthorization = [];
    const sendAuthorization = [];

    for (const permission of requiredPermissions) {
      const payload = {
        // client
        spendLimit,
        granterAddress,
        // server
        granteeAddress,
        oracleName,
        expirationDays,
        permission,
      };
      if (this.shouldUseSendAuthorization(permission)) {
        sendAuthorization.push(Authz.createMsgGrantSend(payload));
      } else {
        genericAuthorization.push(Authz.createMsgGrantAuthz(payload));
      }
    }

    const tx = await transactionFn(
      [...genericAuthorization, ...sendAuthorization],
      `Grant Authorization ${oracleName}`,
    );
    return tx;
  }
  public async checkPermissions() {
    const queryClient = await this.queryClientPromise;

    // Fetch all grants where our address is the grantee (receiver of permissions)
    const granteeGrants = await queryClient.cosmos.authz.v1beta1.granteeGrants({
      grantee: this.config.granteeAddress,
    });

    // Array to collect the permissions we have
    const permissions: Permission<AuthorizationType>[] = [];

    // Process each grant
    for (const grant of granteeGrants.grants) {
      const granteeAddress = grant.grantee;
      const granterAddress = grant.granter;
      const authorization = grant.authorization;
      const expiration = grant.expiration;
      if (!authorization) {
        continue;
      }

      // Check if the grant is expired
      const isExpired = expiration
        ? new Date(expiration.seconds.toNumber() * 1000) < new Date()
        : false;

      if (isExpired) {
        continue;
      }

      // Check if the grant is for the correct granter and grantee
      if (
        grant.granter !== this.config.granterAddress ||
        grant.grantee !== this.config.granteeAddress
      ) {
        continue;
      }
      // Handle different authorization types
      try {
        // Decode the authorization based on its type
        switch (authorization.typeUrl) {
          case '/cosmos.authz.v1beta1.GenericAuthorization': {
            const decoded = cosmos.authz.v1beta1.GenericAuthorization.decode(
              authorization.value,
            );
            permissions.push({
              msgTypeUrl: decoded.msg,
              granter: granterAddress,
              grantee: granteeAddress,
              expiration: expiration
                ? new Date(expiration.seconds.toNumber() * 1000)
                : null,
            } satisfies Permission<'/cosmos.authz.v1beta1.GenericAuthorization'>);
            break;
          }
          case '/cosmos.bank.v1beta1.SendAuthorization': {
            const decoded = cosmos.bank.v1beta1.SendAuthorization.decode(
              authorization.value,
            );
            permissions.push({
              msgTypeUrl: authorization.typeUrl,
              spendLimit: decoded.spendLimit,
              granter: granterAddress,
              grantee: granteeAddress,
              expiration: expiration
                ? new Date(expiration.seconds.toNumber() * 1000)
                : null,
            } satisfies Permission<'/cosmos.bank.v1beta1.SendAuthorization'>);
            break;
          }

          case '/ixo.claims.v1beta1.SubmitClaimAuthorization': {
            // Decode submit claim authorization
            const decoded = ixo.claims.v1beta1.SubmitClaimAuthorization.decode(
              authorization.value,
            );
            permissions.push({
              msgTypeUrl: authorization.typeUrl,
              admin: decoded.admin,
              constraints: decoded.constraints,
              granter: granterAddress,
              grantee: granteeAddress,
              expiration: expiration
                ? new Date(expiration.seconds.toNumber() * 1000)
                : null,
            } satisfies Permission<'/ixo.claims.v1beta1.SubmitClaimAuthorization'>);
            break;
          }
          // Add more authorization types as needed
          default:
            console.log(`Unknown authorization type: ${authorization.typeUrl}`);
            break;
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error(`Error decoding authorization: ${error.message}`);
        } else {
          console.error(`Error decoding authorization: ${String(error)}`);
        }
      }
    }
    return permissions;
  }
  public async hasPermission(
    msgTypeUrl: string | string[],
  ) {
    const permissions = await this.checkPermissions();
    const permissionsToCheck = Array.isArray(msgTypeUrl)
      ? msgTypeUrl
      : [msgTypeUrl];
    return permissions.some((p) => permissionsToCheck.includes(p.msgTypeUrl));
  }

  static createMsgGrantAuthz(
    payload: Pick<
      IAuthzConfig,
      'granterAddress' | 'granteeAddress' | 'oracleName' | 'expirationDays'
    > & {
      permission: string;
    },
  ) {
    return {
      typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
      value: cosmos.authz.v1beta1.MsgGrant.fromPartial({
        granter: payload.granterAddress,
        grantee: payload.granteeAddress,
        grant: cosmos.authz.v1beta1.Grant.fromPartial({
          authorization: {
            typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
            value: cosmos.authz.v1beta1.GenericAuthorization.encode(
              cosmos.authz.v1beta1.GenericAuthorization.fromPartial({
                msg: payload.permission,
              }),
            ).finish(),
          },
          expiration: utils.proto.toTimestamp(
            addDays(new Date(), payload.expirationDays ?? 30),
          ),
        }),
      }),
    };
  }
  static createMsgExecAuthZ(
    payload: Pick<IAuthzConfig, 'granteeAddress'> & {
      messages: {
        typeUrl: string;
        value: Uint8Array;
      }[];
    },
  ) {
    return {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: payload.granteeAddress,
        msgs: payload.messages,
      }),
    };
  }

  static createMsgGrantSend(
    payload: Pick<
      IAuthzConfig,
      | 'granterAddress'
      | 'granteeAddress'
      | 'oracleName'
      | 'expirationDays'
      | 'spendLimit'
    >,
  ) {
    return {
      typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
      value: cosmos.authz.v1beta1.MsgGrant.fromPartial({
        granter: payload.granterAddress,
        grantee: payload.granteeAddress,
        grant: cosmos.authz.v1beta1.Grant.fromPartial({
          authorization: {
            typeUrl: '/cosmos.bank.v1beta1.SendAuthorization',
            value: cosmos.bank.v1beta1.SendAuthorization.encode(
              cosmos.bank.v1beta1.SendAuthorization.fromPartial({
                spendLimit: payload.spendLimit?.map((spendLimit) =>
                  cosmos.base.v1beta1.Coin.fromPartial({
                    amount: spendLimit.amount,
                    denom: spendLimit.denom,
                  }),
                ),
              }),
            ).finish(),
          },
          expiration: utils.proto.toTimestamp(
            addDays(new Date(), payload.expirationDays ?? 30),
          ),
        }),
      }),
    };
  }
  static createMsgExecSend(
    payload: Pick<
      IAuthzConfig,
      'granterAddress' | 'granteeAddress' | 'oracleName' | 'expirationDays'
    > & {
      amounts: {
        amount: string;
        denom: string;
      }[];
    },
  ) {
    return {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: payload.granteeAddress,
        msgs: [
          {
            typeUrl: '/cosmos.bank.v1beta1.MsgSend',
            value: cosmos.bank.v1beta1.MsgSend.encode(
              cosmos.bank.v1beta1.MsgSend.fromPartial({
                amount: payload.amounts?.map((amount) =>
                  cosmos.base.v1beta1.Coin.fromPartial({
                    amount: amount.amount,
                    denom: amount.denom,
                  }),
                ),
                fromAddress: payload.granterAddress,
                toAddress: payload.granteeAddress,
              }),
            ).finish(),
          },
        ],
      }),
    };
  }
  static async getOracleAuthZConfig(
    params: GetOracleAuthZConfigParams,
  ): Promise<IAuthzConfig> {
    const config = await Entities.getSettingsResource({
      protocolDid: params.oracleDid,
      key: 'oracleAuthZConfig',
    });

    if (!params.granterAddress) {
      throw new ValidationError(
        'Missing granterAddress: Please provide a granterAddress.',
      );
    }

    const validConfig = validateAuthzConfig(config, false);
    return {
      ...validConfig,
      granterAddress: params.granterAddress,
    };
  }


  private shouldUseSendAuthorization(permission: string) {
    const sendMsgTypes = [
      // MsgSend - Allows transferring tokens from one account to another
      '/cosmos.bank.v1beta1.MsgSend',
      // MsgMultiSend - Allows transferring tokens from one or more input accounts to one or more output accounts
      '/cosmos.bank.v1beta1.MsgMultiSend',
    ];
    return sendMsgTypes.includes(permission);
  }
}
