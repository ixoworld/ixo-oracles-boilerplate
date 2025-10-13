import { Fragment, type ReactNode } from 'react';
import {
  resolveUIComponent,
  type UIComponents,
} from '../resolve-ui-component.js';
import { type IComponentMetadata, type MessageContent } from './types.js';

/**
 * Renders message content by transforming metadata into React components
 * This happens during render, not when storing state
 */
export function renderMessageContent(
  content: MessageContent,
  uiComponents?: UIComponents,
): ReactNode {
  // Simple string content
  if (typeof content === 'string') {
    return content;
  }

  // Single component metadata
  if (isComponentMetadata(content)) {
    return uiComponents ? resolveUIComponent(uiComponents, content) : null;
  }

  // Array of mixed content (strings and component metadata)
  if (Array.isArray(content)) {
    return (
      <>
        {content.map((item, index) => {
          if (typeof item === 'string') {
            return <Fragment key={index}>{item}</Fragment>;
          }
          if (isComponentMetadata(item) && uiComponents) {
            const component = resolveUIComponent(uiComponents, item);
            return <Fragment key={index}>{component}</Fragment>;
          }
          return null;
        })}
      </>
    );
  }

  return null;
}

function isComponentMetadata(value: unknown): value is IComponentMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'props' in value
  );
}
