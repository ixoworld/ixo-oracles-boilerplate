'use client';

import SignButton from '@/components/SignButton';
import { Authz } from '@ixo/oracles-chain-client/react';
import { useOracleSessions } from '@ixo/oracles-client-sdk';
import {
  Button,
  Container,
  Divider,
  Group,
  List,
  Loader,
  Paper,
  Text,
  Title,
} from '@mantine/core';
import { useEffect } from 'react';

const userAddress = 'ixo1xpww6379u29ydvh54vmn6na2eyxyp8rk7fsrr0';
const oracleAddress = 'ixo1qlmum93dly86yhlm9hundtz2kw5l2spgeuslzj';

export default function Client() {
  const {
    sessions,
    isLoading,
    error,
    createSession,
    isCreatingSession,
    isCreateSessionError,
    deleteSession,
    isDeletingSession,
  } = useOracleSessions('did:ixo:entity:27d36161eb4c90a9d49fa867eccc86a1', {
    baseUrl: 'http://localhost:4200',
  });

  useEffect(() => {
    if (isCreateSessionError) {
      console.error(isCreateSessionError);
    }
  }, [isCreateSessionError]);

  return (
    <Container>
      <Title>Sessions</Title>
      <Group>
        <SignButton
          sign={async () => {
            const authz = new Authz({
              oracleName: 'test',
              granteeAddress: oracleAddress,
              requiredPermissions: [
                // '/ixo.claims.v1beta1.SubmitClaimAuthorization',
                '/ixo.entity.v1beta1.MsgCreateEntity',
              ],
              granterAddress: userAddress,
            });
            await authz.contractOracle((c) => console.log(c));
          }}
          loading={isCreatingSession}
        >
          Contract
        </SignButton>
        <Button onClick={() => createSession()} loading={isCreatingSession}>
          Create Session
        </Button>
        <Button
          variant="outline"
          color="red"
          disabled={!sessions?.[0].sessionId}
          onClick={() => deleteSession(sessions?.[0].sessionId ?? '')}
          loading={isDeletingSession}
        >
          Delete Session
        </Button>
      </Group>
      {isLoading && <Loader />}
      {error && <Text>{error.message}</Text>}
      <Text>Total sessions: {sessions?.length}</Text>
      <List>
        {sessions?.map((session, idx) => (
          <Paper
            key={idx.toString() + session.sessionId}
            p="md"
            withBorder
            radius="md"
            style={{ marginBottom: '10px' }}
          >
            <Title order={3}>
              {session.oracleName}: {session.title}
            </Title>
            <div>
              <Text>#{session.sessionId}</Text>
            </div>
            <Divider />
            <div>
              <Text>{session.oracleName}</Text>
              <Text>{session.lastUpdatedAt}</Text>
              <Text>{session.createdAt}</Text>
            </div>
          </Paper>
        ))}
      </List>
    </Container>
  );
}
