import { walletClient } from '@/actions/client';
import { cosmos, ixo, utils } from '@ixo/impactxclient-sdk';
import { Client } from '@ixo/oracles-chain-client';
import {
  Badge,
  Box,
  Button,
  Divider,
  Grid,
  GridCol,
  Group,
  Paper,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconFileInvoice,
  IconScale,
  IconShieldChevron,
  IconShieldLock,
  IconUserShield,
  IconX,
} from '@tabler/icons-react';
import { revalidatePath } from 'next/cache';

interface AuthzForSubsProps {
  adminAddress: string;
  oraclesCollectionId: string;
}

const claimId = 'ixo-claim-133446';

async function AuthzForSubs({
  adminAddress,
  oraclesCollectionId,
}: AuthzForSubsProps) {
  if (!adminAddress || !oraclesCollectionId) {
    return (
      <Paper withBorder shadow="sm" p="lg" radius="md" mt="md">
        <Group>
          <IconAlertCircle size="2rem" />
          <Text>Admin address or oracles collection id is not set</Text>
        </Group>
      </Paper>
    );
  }

  const targetOracleAddress = 'ixo1x3y2cgtet56srvwuwtfsh9xvxxxp9ln73dexjl';

  const granteeAddress = (await walletClient.wallet.getAccounts())[0].address;

  const granteeGrants =
    await walletClient.queryClient.cosmos.authz.v1beta1.granteeGrants({
      grantee: granteeAddress,
    });

  const createAuth = granteeGrants.grants.find(
    (g) =>
      g.authorization?.typeUrl ==
        '/ixo.claims.v1beta1.CreateClaimAuthorizationAuthorization' &&
      g.granter == adminAddress,
  );

  const giveOracleAuthz = async () => {
    'use server';

    const message = {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: granteeAddress,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgCreateClaimAuthorization',
            value: ixo.claims.v1beta1.MsgCreateClaimAuthorization.encode(
              ixo.claims.v1beta1.MsgCreateClaimAuthorization.fromPartial({
                creatorAddress: granteeAddress,
                creatorDid: `did:ixo:${granteeAddress}`,
                adminAddress,
                granteeAddress: targetOracleAddress,
                collectionId: oraclesCollectionId,
                agentQuota: utils.proto.numberToLong(1000),
                maxAmount: [
                  {
                    denom: 'uixo',
                    amount: '100000000',
                  },
                ],

                authType:
                  ixo.claims.v1beta1.CreateClaimAuthorizationType.SUBMIT,
              }),
            ).finish(),
          },
        ],
      }),
    };

    const res = await walletClient.signAndBroadcast([message]);
    res.events.map(console.log);
    revalidatePath('/subscription');
  };

  const getTargetOracleHasAuthz = async () => {
    const granteeGrants =
      await walletClient.queryClient.cosmos.authz.v1beta1.granteeGrants({
        grantee: targetOracleAddress,
      });
    console.log(
      '🚀 ~ getTargetOracleHasAuthz ~ granteeGrants:',
      granteeGrants.grants.map((g) => ({
        typeUrl: g.authorization?.typeUrl,
        granter: g.granter,
        grantee: g.grantee,
      })),
    );
    return granteeGrants.grants.some(
      (g) =>
        g.authorization?.typeUrl ==
          '/ixo.claims.v1beta1.SubmitClaimAuthorization' &&
        g.granter == adminAddress,
    );
  };

  const isTargetOracleHasAuthz = await getTargetOracleHasAuthz();

  const submitClaim = async () => {
    'use server';
    const oracleWalletClient = await Client.createCustomClient(
      'gasp record inside giant bleak key wave choose number swallow valid spring',
    );
    const message = {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: targetOracleAddress,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgSubmitClaim',
            value: ixo.claims.v1beta1.MsgSubmitClaim.encode(
              ixo.claims.v1beta1.MsgSubmitClaim.fromPartial({
                adminAddress: adminAddress,
                agentAddress: targetOracleAddress,
                agentDid: `did:ixo:${targetOracleAddress}`,
                claimId,
                collectionId: oraclesCollectionId,

                amount: [{ denom: 'uixo', amount: '1000' }],
              }),
            ).finish(),
          },
        ],
      }),
    };

    const res = await oracleWalletClient.signAndBroadcast([message]);
    console.log(res);
    revalidatePath('/subscription');
  };

  const checkIsClaimSubmitted = async () => {
    try {
      const res = await walletClient.queryClient.ixo.claims.v1beta1.claim({
        id: claimId,
      });
      return !!res.claim;
    } catch (error) {
      return false;
    }
  };
  const isClaimSubmitted = await checkIsClaimSubmitted();

  const evaluateClaim = async () => {
    'use server';

    const walletClient = await Client.createCustomClient(
      'pull jungle sense giggle east wear comic meadow clog side foam pond',
    );
    const granteeAddress = (await walletClient.wallet.getAccounts())[0].address;
    const evaluateAuthz =
      await walletClient.queryClient.cosmos.authz.v1beta1.granteeGrants({
        grantee: granteeAddress,
      });
    evaluateAuthz.grants
      .map((g) => {
        try {
          return {
            constraines: walletClient.signingClient.registry.decode(
              g!.authorization!,
            ).constraints,
          };
        } catch (error) {
          return { constraines: null };
        }
      })
      .map(console.log);

    const message = {
      typeUrl: '/cosmos.authz.v1beta1.MsgExec',
      value: cosmos.authz.v1beta1.MsgExec.fromPartial({
        grantee: granteeAddress,
        msgs: [
          {
            typeUrl: '/ixo.claims.v1beta1.MsgEvaluateClaim',
            value: ixo.claims.v1beta1.MsgEvaluateClaim.encode(
              ixo.claims.v1beta1.MsgEvaluateClaim.fromPartial({
                adminAddress: adminAddress,
                agentAddress: granteeAddress,
                agentDid: `did:ixo:${granteeAddress}`,
                oracle: `did:ixo:${granteeAddress}`,
                claimId,
                collectionId: oraclesCollectionId,
                status: 1,
                reason: 1,
                verificationProof: 'cid of verificationProof',
                // if want to do custom amount, must be within allowed authz if through authz
                amount: [{ denom: 'uixo', amount: '1000' }],
              }),
            ).finish(),
          },
        ],
      }),
    };

    const res = await walletClient.signAndBroadcast([message]);
    console.log(res);
    revalidatePath('/subscription');
  };

  // Check if claim has been evaluated
  const checkIsClaimEvaluated = async () => {
    try {
      const res = await walletClient.queryClient.ixo.claims.v1beta1.claim({
        id: claimId,
      });
      console.log('🚀 ~ checkIsClaimEvaluated ~ res:', res);
      // Check the evaluated status in a way that avoids type errors
      return !!res.claim?.evaluation;
    } catch (error) {
      return false;
    }
  };
  const isClaimEvaluated = await checkIsClaimEvaluated();

  return (
    <Paper withBorder shadow="sm" p="lg" radius="md" mt="md">
      <Group mb="md" justify="space-between">
        <Group wrap="nowrap" gap="xs">
          <ThemeIcon size="sm" variant="light" color="blue">
            <IconShieldLock style={{ width: '70%', height: '70%' }} />
          </ThemeIcon>
          <Title order={4}>Oracle Authorization Status</Title>
        </Group>
        <Badge
          color={createAuth ? 'teal' : 'red'}
          variant="light"
          size="lg"
          leftSection={
            createAuth ? <IconCheck size={14} /> : <IconX size={14} />
          }
        >
          {createAuth ? 'Authorized' : 'Unauthorized'}
        </Badge>
      </Group>

      <Divider my={6} />
      <Grid columns={12} grow>
        <GridCol span={6} p={4}>
          <Title my={4} order={4}>
            As a User
          </Title>
          <Divider
            my={2}
            label="Submit Oracle Claim"
            labelPosition="center"
            mt="lg"
          />

          <Box mt="md">
            <Group justify="space-between" mb="sm">
              <Group wrap="nowrap" gap="xs">
                <ThemeIcon
                  size="sm"
                  variant="light"
                  color={createAuth ? 'teal' : 'gray'}
                >
                  <IconUserShield style={{ width: '70%', height: '70%' }} />
                </ThemeIcon>
                <Text size="sm">
                  {createAuth
                    ? 'authorized to give oracles Authz to submit claims'
                    : 'not authorized to give oracles Authz to submit claims'}
                </Text>
              </Group>
              <Badge
                color={createAuth ? 'teal' : 'gray'}
                variant="light"
                size="sm"
                leftSection={createAuth ? <IconCheck size={12} /> : undefined}
              >
                {createAuth ? 'Authorized' : 'Pending'}
              </Badge>
            </Group>

            <Group justify="space-between" mt="xs" mb="md">
              <Text size="xs" c="dimmed">
                User Address:
                <Text component="span" ff="monospace">
                  {granteeAddress.slice(0, 10)}...
                </Text>
              </Text>
              <Text size="xs" c="dimmed">
                Oracle Address:{' '}
                <Text component="span" ff="monospace">
                  {targetOracleAddress.slice(0, 10)}...
                </Text>
              </Text>
            </Group>

            <Button
              type="submit"
              color={isTargetOracleHasAuthz ? 'gray' : 'teal'}
              variant="light"
              fullWidth
              mt="xs"
              leftSection={
                isTargetOracleHasAuthz ? (
                  <IconCheck size="1rem" />
                ) : (
                  <IconShieldChevron size="1rem" />
                )
              }
              onClick={giveOracleAuthz}
              disabled={isTargetOracleHasAuthz}
            >
              {isTargetOracleHasAuthz
                ? 'Oracle Already Authorized'
                : 'Grant Oracle Authorization'}
            </Button>
          </Box>

          <>
            <Divider
              my={2}
              label="Evaluate Oracle Claim"
              labelPosition="center"
              mt="lg"
            />

            <Box mt="md">
              <Group justify="space-between" mb="sm">
                <Group wrap="nowrap" gap="xs">
                  <ThemeIcon
                    size="sm"
                    variant="light"
                    color={isClaimEvaluated ? 'teal' : 'violet'}
                  >
                    <IconScale style={{ width: '70%', height: '70%' }} />
                  </ThemeIcon>
                  <Text size="sm">
                    {isClaimEvaluated
                      ? 'Claim has been approved'
                      : 'Evaluate and approve the submitted claim'}
                  </Text>
                </Group>
                <Badge
                  color={isClaimEvaluated ? 'teal' : 'violet'}
                  variant="light"
                  size="sm"
                  leftSection={
                    isClaimEvaluated ? <IconCheck size={12} /> : undefined
                  }
                >
                  {isClaimEvaluated ? 'Approved' : 'Needs Approval'}
                </Badge>
              </Group>

              <Group justify="space-between" mt="xs" mb="md">
                <Text size="xs" c="dimmed">
                  Status:{' '}
                  <Text component="span" ff="monospace">
                    {/* 1 (Approve) */}
                    {/* {res.claim?.evaluation?.status} */}
                  </Text>
                </Text>
                <Text size="xs" c="dimmed">
                  Payout:{' '}
                  <Text component="span" ff="monospace">
                    Amount: 1000 uixo
                  </Text>
                </Text>
              </Group>

              <Button
                color={isClaimEvaluated ? 'gray' : 'violet'}
                variant="light"
                fullWidth
                leftSection={
                  isClaimEvaluated ? (
                    <IconCheck size="1rem" />
                  ) : (
                    <IconScale size="1rem" />
                  )
                }
                onClick={evaluateClaim}
                disabled={isClaimEvaluated || !isClaimSubmitted}
              >
                {!isClaimSubmitted
                  ? 'Oracle did not submit claim yet'
                  : isClaimEvaluated
                    ? 'Claim Already Approved'
                    : 'Approve Claim'}
              </Button>
            </Box>
          </>
        </GridCol>
        <GridCol span={6} p={4}>
          <Title my={4} order={4}>
            As an Oracle
          </Title>
          {createAuth && (
            <>
              {isTargetOracleHasAuthz && (
                <>
                  <Divider
                    my={2}
                    label="Submit Oracle Claim"
                    labelPosition="center"
                    mt="lg"
                  />

                  <Box mt="md">
                    <Group justify="space-between" mb="sm">
                      <Group wrap="nowrap" gap="xs">
                        <ThemeIcon
                          size="sm"
                          variant="light"
                          color={isClaimSubmitted ? 'teal' : 'blue'}
                        >
                          <IconFileInvoice
                            style={{ width: '70%', height: '70%' }}
                          />
                        </ThemeIcon>
                        <Text size="sm">
                          {isClaimSubmitted
                            ? 'Oracle claim has been submitted'
                            : 'Test submit a claim as oracle'}
                        </Text>
                      </Group>
                      <Badge
                        color={isClaimSubmitted ? 'teal' : 'blue'}
                        variant="light"
                        size="sm"
                        leftSection={
                          isClaimSubmitted ? <IconCheck size={12} /> : undefined
                        }
                      >
                        {isClaimSubmitted ? 'Submitted' : 'Ready'}
                      </Badge>
                    </Group>

                    <Group justify="space-between" mt="xs" mb="md">
                      <Text size="xs" c="dimmed">
                        Claim ID:{' '}
                        <Text component="span" ff="monospace">
                          ixo-claim-1234
                        </Text>
                      </Text>
                      <Text size="xs" c="dimmed">
                        Amount:{' '}
                        <Text component="span" ff="monospace">
                          10000 uixo
                        </Text>
                      </Text>
                    </Group>

                    <Button
                      color={isClaimSubmitted ? 'gray' : 'blue'}
                      variant="light"
                      fullWidth
                      leftSection={
                        isClaimSubmitted ? (
                          <IconCheck size="1rem" />
                        ) : (
                          <IconFileInvoice size="1rem" />
                        )
                      }
                      onClick={submitClaim}
                      disabled={isClaimSubmitted}
                    >
                      {isClaimSubmitted
                        ? 'Claim Already Submitted'
                        : 'Submit Test Claim'}
                    </Button>
                  </Box>
                </>
              )}
            </>
          )}
        </GridCol>
      </Grid>
    </Paper>
  );
}

export default AuthzForSubs;
