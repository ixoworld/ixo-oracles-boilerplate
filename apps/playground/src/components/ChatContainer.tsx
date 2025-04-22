'use client';
import { Container, Grid, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { ChatInterface } from './ChatInterface';
import { SessionList } from './SessionList';

interface ChatContainerProps {
  oracleDid: string;
  defaultSessionId?: string;
  baseUrl: string;
}

export function ChatContainer({
  oracleDid,
  defaultSessionId,
  baseUrl,
}: ChatContainerProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    defaultSessionId || '',
  );

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
  };

  return (
    <Container size="xl" py="xl" mah={'100%'} h="80vh" maw="100%">
      <Title order={1} mb="lg">
        Oracle Chat Interface
      </Title>
      <Text c="dimmed" mb="xl">
        Connected to oracle: {oracleDid}
      </Text>

      <Grid
        h="100%"
        styles={{
          inner: {
            height: '100%',
          },
          root: {
            height: '100%',
          },
          container: {
            height: '100%',
          },
          col: {
            height: '100%',
          },
        }}
      >
        <Grid.Col span={4} h="100%">
          <SessionList
            oracleDid={oracleDid}
            baseUrl={baseUrl}
            onSelectSession={handleSelectSession}
            currentSessionId={selectedSessionId}
          />
        </Grid.Col>

        <Grid.Col span={8} h="100%">
          <ChatInterface
            oracleDid={oracleDid}
            sessionId={selectedSessionId}
            baseUrl={baseUrl}
          />
        </Grid.Col>
      </Grid>
    </Container>
  );
}
