import { type CleanAdditionalKwargs } from '@ixo/common';

/**
 * Cleans up additional_kwargs by extracting reasoning information and keeping only essential fields
 * @param additionalKwargs - The original additional_kwargs object
 * @param msgFromMatrixRoom - Whether the message came from Matrix room
 * @returns Cleaned additional_kwargs with only essential fields
 */
export function cleanAdditionalKwargs(
  additionalKwargs: any,
  msgFromMatrixRoom: boolean,
): CleanAdditionalKwargs {
  // Extract reasoning information from raw response
  // Note: Reasoning is only available when the AI model supports it (e.g., GPT-OSS-120B with include_reasoning: true)
  const rawResponse = additionalKwargs.__raw_response;

  // Check if reasoning exists in the response
  // Reasoning will not be present in all AI responses, only when the model supports it
  const hasReasoning = rawResponse?.choices?.[0]?.delta?.reasoning;
  const reasoning = hasReasoning
    ? rawResponse.choices[0].delta.reasoning
    : undefined;
  const reasoningDetails =
    hasReasoning && rawResponse.choices[0].delta.reasoning_details
      ? rawResponse.choices[0].delta.reasoning_details
      : undefined;

  // Return cleaned additional_kwargs with only essential fields
  const cleanedKwargs: CleanAdditionalKwargs = {
    msgFromMatrixRoom,
    timestamp: new Date().toISOString(),
    oracleName: process.env.ORACLE_NAME || 'IXO Oracle',
  };

  // Add reasoning fields only if they exist
  if (reasoning) {
    cleanedKwargs.reasoning = reasoning;
  }
  if (
    reasoningDetails &&
    Array.isArray(reasoningDetails) &&
    reasoningDetails.length > 0
  ) {
    // Clean up reasoning details - remove useless format field and keep only useful data
    cleanedKwargs.reasoningDetails = reasoningDetails
      .filter(
        (
          detail,
        ): detail is NonNullable<
          CleanAdditionalKwargs['reasoningDetails']
        >[number] => {
          // Type guard to ensure detail has required properties
          return (
            detail &&
            typeof detail === 'object' &&
            typeof detail.type === 'string' &&
            typeof detail.text === 'string' &&
            detail.text.trim().length > 0 // Only keep details with actual text content
          );
        },
      )
      .map((detail) => ({
        type: detail.type,
        text: detail.text,
        // Skip index and format fields - not useful
      }));
  }

  return cleanedKwargs;
}
