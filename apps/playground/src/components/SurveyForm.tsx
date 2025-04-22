'use client';
import {
  Box,
  Button,
  Card,
  Flex,
  Group,
  Loader,
  Text,
  Title,
} from '@mantine/core';
import { IconForms } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react';
import './defaultV2.css';
import { surveyTheme } from './theme';

interface SurveyFormProps {
  protocolDid: string;
  output: string;
  isLoading: boolean;
}

// Define a basic theme for the survey
const surveyTheme = {
  cssVariables: {
    '--sjs-general-backcolor': '#ffffff',
    '--sjs-general-forecolor': '#404040',
    '--sjs-font-size': '16px',

    '--sjs-corner-radius': '4px',
    '--sjs-base-unit': '8px',

    // Header
    '--sjs-header-backcolor': '#f8f9fa',
    '--sjs-header-forecolor': '#1864ab',

    // Main elements
    '--sjs-question-backcolor': '#ffffff',
    '--sjs-question-forecolor': '#404040',

    // Buttons
    '--sjs-primary-backcolor': '#1971c2',
    '--sjs-primary-forecolor': '#ffffff',
    '--sjs-primary-hovercolor': '#1864ab',

    // Secondary buttons
    '--sjs-secondary-backcolor': '#f1f3f5',
    '--sjs-secondary-forecolor': '#212529',
    '--sjs-secondary-hovercolor': '#dee2e6',
  },
};

export function SurveyForm({
  protocolDid,
  output,
  isLoading,
}: SurveyFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [surveyComplete, setSurveyComplete] = useState(false);
  const [parsedOutput, setParsedOutput] = useState<any>(null);

  // Parse the output when it changes
  useEffect(() => {
    if (output && !isLoading) {
      try {
        const parsed = JSON.parse(output);
        setParsedOutput(parsed);
        setError(null);
      } catch (err) {
        console.error('Failed to parse survey JSON:', err);
        setError('Failed to parse survey data. Please try again.');
      }
    }
  }, [output, isLoading]);

  // Create survey model using useMemo to prevent recreation on every render
  const survey = useMemo(() => {
    if (!parsedOutput?.surveyJson) return null;

    try {
      const model = new Model(parsedOutput.surveyJson);

      // Apply theme

      model.applyTheme(surveyTheme);

      // Set text update mode for better UX
      model.textUpdateMode = 'onTyping';

      // Add completion callback
      model.onComplete.add((sender) => {
        console.log('Survey complete! Results:', sender.data);
        setSurveyComplete(true);
        // Here you could send the results back to your server/API
      });

      return model;
    } catch (err) {
      console.error('Error creating survey model:', err);
      setError('Error creating survey. Invalid survey configuration.');
      return null;
    }
  }, [parsedOutput]);

  return (
    <Card withBorder p="md" radius="md" my="md">
      <Group mb="md">
        <IconForms size="1.5rem" />
        <Title order={4}>Interactive Form</Title>
      </Group>

      <Box mb="md">
        <Text fw={500} mb={5}>
          Protocol ID:
        </Text>
        <Text size="sm" style={{ wordBreak: 'break-all' }}>
          {protocolDid}
        </Text>
      </Box>

      {isLoading ? (
        <Flex align="center" justify="center" py="xl" gap="md">
          <Loader size="sm" />
          <Text>Loading form...</Text>
        </Flex>
      ) : (
        <>
          {error ? (
            <Text c="red" ta="center" py="md">
              {error}
            </Text>
          ) : survey ? (
            <Box>
              {surveyComplete ? (
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  py="xl"
                  gap="md"
                >
                  <Text fw={600} size="lg" c="green">
                    Thank you for completing the form!
                  </Text>
                  <Button
                    variant="outline"
                    onClick={() => setSurveyComplete(false)}
                  >
                    Fill out again
                  </Button>
                </Flex>
              ) : (
                <Survey model={survey} />
              )}
            </Box>
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
                No form data available. Please try again.
              </Text>
            </Flex>
          )}
        </>
      )}
    </Card>
  );
}
