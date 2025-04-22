'use client';
import {
  Accordion,
  Badge,
  Box,
  Card,
  Flex,
  Group,
  Loader,
  Text,
  Title,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';

interface DomainSearchProps {
  searchQuery: string;
  domainName: string | null;
  isLoading: boolean;
  output: string | null;
}

export function DomainSearch({
  searchQuery,
  domainName,
  isLoading,
  output,
}: DomainSearchProps) {
  return (
    <Card withBorder p="md" radius="md" my={'md'}>
      <Group mb="md">
        <IconSearch size="1.5rem" />
        <Title order={4}>Domain Search</Title>
      </Group>

      <Box mb="md">
        <Text fw={500} mb={5}>
          Search Term:
        </Text>
        <Badge size="lg" color="blue" variant="light">
          {searchQuery}
        </Badge>
      </Box>

      {isLoading ? (
        <Flex align="center" justify="center" py="xl" gap="md">
          <Loader size="sm" />
          <Text>Searching for relevant information...</Text>
        </Flex>
      ) : (
        <>
          {output ? (
            <Accordion>
              {domainName && (
                <Accordion.Item value="domain">
                  <Accordion.Control>
                    <Text fw={600}>Domain Information</Text>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Text>{domainName}</Text>
                  </Accordion.Panel>
                </Accordion.Item>
              )}

              <Accordion.Item value="results">
                <Accordion.Control>
                  <Text fw={600}>Search Results</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Text style={{ whiteSpace: 'pre-wrap' }}>{output}</Text>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          ) : (
            <Flex
              direction="column"
              align="center"
              justify="center"
              py="lg"
              style={(theme) => ({
                backgroundColor: theme.colors.gray[0],
                borderRadius: theme.radius.sm,
              })}
            >
              <Text c="dimmed" ta="center">
                {searchQuery
                  ? 'No results found for your search query.'
                  : 'Enter a search query to find relevant information.'}
              </Text>
            </Flex>
          )}
        </>
      )}
    </Card>
  );
}
