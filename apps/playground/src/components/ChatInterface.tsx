'use client';
import { useChat } from '@ixo/oracles-client-sdk';
import {
  ActionIcon,
  Box,
  Card,
  CheckIcon,
  Flex,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Text,
  TextInput,
  Title,
  useMantineTheme,
} from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Memoized markdown component for better performance
const MarkdownContent = memo(({ content }: { content: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      p: ({ children }) => <Text size="sm">{children}</Text>,
      a: ({ href, children }) => (
        <Text component="a" href={href} size="sm" c="blue" target="_blank">
          {children}
        </Text>
      ),
    }}
  >
    {content}
  </ReactMarkdown>
));
MarkdownContent.displayName = 'MarkdownContent';

// Message content renderer that handles both string and component content
const MessageContent = memo(({ content }: { content: unknown }) => {
  // If the content is a string, render it as markdown
  if (typeof content === 'string') {
    return <MarkdownContent content={content} />;
  }

  // Otherwise, it's a component or other content type, so render as is
  if (content !== null && content !== undefined) {
    return <>{content}</>;
  }

  // Fallback for null/undefined content
  return (
    <Text size="sm" c="dimmed">
      [Empty message]
    </Text>
  );
});
MessageContent.displayName = 'MessageContent';

interface ChatInterfaceProps {
  oracleDid: string;
  sessionId: string;
  baseUrl: string;
}

export function ChatInterface({
  oracleDid,
  sessionId,
  baseUrl,
}: ChatInterfaceProps) {
  const [message, setMessage] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const theme = useMantineTheme();

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    isSending,
    isRealTimeConnected,
  } = useChat({
    oracleDid,
    sessionId,
    uiComponents: {
      render_survey_js_form: (props) => {
        const { protocolDid, output, isLoading } = props;
        // Import dynamically to avoid circular dependencies
        const { SurveyForm } = require('../components/SurveyForm');
        return (
          <SurveyForm
            protocolDid={protocolDid}
            output={output}
            isLoading={isLoading}
          />
        );
      },
      search_domain_with_semantic_search: (props) => {
        const { searchQuery, domainName, isLoading, output } = props;
        // Import dynamically to avoid circular dependencies
        const { DomainSearch } = require('../components/DomainSearch');
        return (
          <DomainSearch
            searchQuery={searchQuery}
            domainName={domainName}
            isLoading={isLoading}
            output={output}
          />
        );
      },
      select_domain: (props) => {
        const { domainId } = props;
        return (
          <Group>
            <Text>
              Domain <b>{domainId}</b> selected
            </Text>
            <ActionIcon color="green" variant="outline">
              <CheckIcon />
            </ActionIcon>
          </Group>
        );
      },
    },
    overrides: {
      baseUrl,
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (viewportRef.current && scrollAreaRef.current) {
      const scrollElement = viewportRef.current;
      setTimeout(() => {
        scrollElement.scrollTo({
          top: scrollElement.scrollHeight,
          behavior: 'smooth',
        });
      }, 50);
    }
  }, [messages]);

  const handleSendMessage = () => {
    if (message.trim() && !isSending && sessionId) {
      sendMessage({ message, sId: sessionId });
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!sessionId) {
    return (
      <Card withBorder p="xl">
        <Text ta="center" c="dimmed">
          Select a session to start chatting
        </Text>
      </Card>
    );
  }

  return (
    <Card withBorder h="100%">
      <Group justify="space-between" mb="md">
        <Title order={3}>Chat</Title>
        <Group gap="xs">
          {isLoading && <Loader size="xs" />}
          <Text size="xs" c={isRealTimeConnected ? 'green' : 'red'}>
            {isRealTimeConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </Group>
      </Group>

      {error && (
        <Text c="red" mb="md">
          {error.message}
        </Text>
      )}

      <ScrollArea
        h={400}
        scrollbarSize={6}
        viewportRef={viewportRef}
        ref={scrollAreaRef}
      >
        {messages.length === 0 ? (
          <Text ta="center" c="dimmed" py="xl">
            No messages yet
          </Text>
        ) : (
          <Box p="xs">
            {messages.map((msg) => (
              <Paper
                key={msg.id}
                p="sm"
                mb="xs"
                withBorder
                style={{
                  backgroundColor:
                    msg.type === 'human'
                      ? theme.colors.gray[0]
                      : theme.colors.blue[0],
                  maxWidth: '80%',
                  marginLeft: msg.type === 'human' ? 'auto' : 0,
                }}
              >
                <MessageContent content={msg.content} />

                {msg.toolCalls && (
                  <Box mt="xs">
                    {msg.toolCalls.map((tool, idx) => (
                      <Text key={idx} size="xs" c="dimmed">
                        Tool: {tool.name} - Status: {tool.status || 'pending'}
                      </Text>
                    ))}
                  </Box>
                )}
              </Paper>
            ))}
            {isSending && (
              <Flex align="center" gap="sm" ml="xs">
                <Loader size="sm" />
                <Text size="sm">AI is typing...</Text>
              </Flex>
            )}
          </Box>
        )}
      </ScrollArea>

      <Group justify="space-between" mt="md">
        <TextInput
          placeholder="Type your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          style={{ flex: 1 }}
          rightSection={
            <ActionIcon
              color="blue"
              onClick={handleSendMessage}
              disabled={!message.trim() || isSending}
              loading={isSending}
            >
              <IconSend size="1.1rem" />
            </ActionIcon>
          }
        />
      </Group>
    </Card>
  );
}
