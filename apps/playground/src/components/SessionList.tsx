'use client';
import { useOracleSessions } from '@ixo/oracles-client-sdk';
import {
  ActionIcon,
  Button,
  Card,
  Flex,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Title,
  useMantineTheme,
} from '@mantine/core';
import { IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';

interface SessionListProps {
  oracleDid: string;
  baseUrl: string;
  onSelectSession: (sessionId: string) => void;
  currentSessionId?: string;
}

export function SessionList({
  oracleDid,
  baseUrl,
  onSelectSession,
  currentSessionId,
}: SessionListProps) {
  const {
    sessions,
    isLoading,
    error,
    refetch,
    createSession,
    isCreatingSession,
    deleteSession,
    isDeletingSession,
  } = useOracleSessions(oracleDid, {
    baseUrl,
  });

  const theme = useMantineTheme();

  const handleCreateSession = async () => {
    try {
      const newSession = await createSession();
      if (newSession) {
        onSelectSession(newSession.sessionId);
        await refetch();
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const handleDeleteSession = async (
    sessionId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation(); // Prevent triggering the card click
    try {
      await deleteSession(sessionId);
      if (currentSessionId === sessionId) {
        onSelectSession('');
      }
      await refetch();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="md">
        <Title order={3}>Sessions ({sessions?.length || 0})</Title>
        <Group gap="xs">
          <ActionIcon
            color="blue"
            variant="light"
            onClick={handleCreateSession}
            title="Create new session"
            loading={isCreatingSession}
          >
            <IconPlus size="1.1rem" />
          </ActionIcon>
          <ActionIcon
            variant="light"
            onClick={() => refetch()}
            title="Refresh sessions list"
          >
            <IconRefresh size="1.1rem" />
          </ActionIcon>
        </Group>
      </Group>

      {isLoading && <Loader size="sm" />}
      {error && (
        <Text c="red" mb="md">
          {error.message}
        </Text>
      )}

      <ScrollArea h={400} scrollbarSize={6}>
        <Stack gap="sm">
          {sessions?.map((session , idx) => (
            <Card
              key={session.sessionId ?? `session-${idx}`}
              withBorder
              p="sm"
              style={{
                backgroundColor:
                  session.sessionId === currentSessionId
                    ? theme.colors.gray[1]
                    : 'transparent',
                cursor: 'pointer',
              }}
              onClick={() => onSelectSession(session.sessionId)}
            >
              <Group justify="space-between" mb={5}>
                <Text fw={600} size="sm">
                  {session.title || 'Untitled Session'}
                </Text>
                <ActionIcon
                  color="red"
                  variant="subtle"
                  size="sm"
                  onClick={(e) => handleDeleteSession(session.sessionId, e)}
                  loading={isDeletingSession}
                >
                  <IconTrash size="1rem" />
                </ActionIcon>
              </Group>
              <Text size="xs" c="dimmed">
                ID: {session.sessionId}
              </Text>
              <Group justify="space-between" mt={5}>
                <Text size="xs" c="dimmed">
                  Created: {new Date(session.createdAt).toLocaleString()}
                </Text>
                <Text size="xs" c="dimmed">
                  Oracle: {session.oracleName}
                </Text>
              </Group>
            </Card>
          ))}

          {sessions?.length === 0 && !isLoading && (
            <Flex direction="column" align="center" py="lg" gap="md">
              <Text c="dimmed" ta="center">
                No sessions found
              </Text>
              <Button
                variant="light"
                leftSection={<IconPlus size="1rem" />}
                onClick={handleCreateSession}
                loading={isCreatingSession}
              >
                Create your first session
              </Button>
            </Flex>
          )}
        </Stack>
      </ScrollArea>
    </Card>
  );
}
