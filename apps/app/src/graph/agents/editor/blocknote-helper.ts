/**
 * Helper functions for Y.js BlockNote operations
 *
 * These functions handle the low-level Y.Doc operations
 * that the LangChain tools use.
 *
 * Matches the pattern from the CLI commands (runAddBlock, runEditBlock, etc.)
 */

import type { MatrixClient } from 'matrix-js-sdk';
import * as Y from 'yjs';

import type { AppConfig } from './config';
import { MatrixProviderManager } from './provider';
import { parseSurveyAnswers, parseSurveySchema } from './survey-helpers';

// Re-export helpers from blockActions for consistency
export { appendBlock, editBlock, type BlockSnapshot } from './block-actions';

export interface BlockDetail {
  id: string;
  blockType: string;
  nodeName: string;
  attributes: Record<string, any>;
  text?: string;
  children?: BlockDetail[];
}

/**
 * Initialize provider, do work, and dispose
 * This matches the pattern from runAddBlock.ts exactly
 */
export async function withProvider<T>(
  matrixClient: MatrixClient,
  config: AppConfig,
  work: (doc: Y.Doc) => T | Promise<T>,
): Promise<T> {
  const providerManager = new MatrixProviderManager(matrixClient, config);

  try {
    const { doc } = await providerManager.init();
    const result = await work(doc);
    return result;
  } finally {
    await providerManager.dispose();
  }
}

/**
 * Find a block container by ID
 */
export function findBlockById(
  container: Y.XmlElement | Y.XmlFragment,
  blockId: string,
): Y.XmlElement | null {
  const nodes = container.toArray();

  for (const node of nodes) {
    if (!(node instanceof Y.XmlElement)) {
      continue;
    }

    const candidateId = node.getAttribute('id');
    if (candidateId === blockId) {
      return node;
    }

    // Recursively search nested structures
    const nested = findBlockById(node, blockId);
    if (nested) {
      return nested;
    }
  }

  return null;
}

// Helper to get any attribute (same as blockActions.ts)
export const getAnyAttribute = <T>(
  element: Y.XmlElement,
  key: string,
): T | undefined => {
  return element.getAttribute(key) as unknown as T | undefined;
};

/**
 * Extract text content from an element (EXACT copy from runListBlocks.ts)
 */
export function extractText(element: Y.XmlElement): string {
  const parts: string[] = [];
  const visit = (node: Y.XmlElement | Y.XmlText) => {
    if (node instanceof Y.XmlText) {
      parts.push(node.toString());
      return;
    }
    node.toArray().forEach((child) => {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
        visit(child);
      }
    });
  };
  visit(element);
  return parts.join('');
}

/**
 * Extract complete block details (EXACT copy from runListBlocks.ts - THE WORKING VERSION!)
 */
function extractBlockDetail(
  element: Y.XmlElement | Y.XmlText,
): BlockDetail | null {
  if (element instanceof Y.XmlText) {
    return {
      id: '',
      nodeName: '#text',
      blockType: '',
      attributes: {},
      children: [],
      text: element.toString(),
    };
  }

  const detail: BlockDetail = {
    id: element.getAttribute('id') || '',
    nodeName: element.nodeName,
    blockType: '',
    attributes: {},
  };

  const xmlAttrs = element.getAttributes();
  for (const [key, value] of Object.entries(xmlAttrs)) {
    detail.attributes[key] = value;
  }

  const attrsValue = getAnyAttribute<Record<string, unknown>>(element, 'attrs');
  if (attrsValue) {
    detail.attributes.attrs = attrsValue;
    // Extract blockType from attrs if available
    const attrs = attrsValue as Record<string, any>;
    if (attrs.type) {
      detail.blockType = attrs.type as string;
    }
  }

  const children = element.toArray();
  detail.children = [];
  for (const child of children) {
    if (child instanceof Y.XmlElement || child instanceof Y.XmlText) {
      const childDetail = extractBlockDetail(child);
      if (childDetail) {
        detail.children.push(childDetail);
      }
    }
  }

  const textContent = extractText(element);
  if (textContent.length > 0) {
    detail.text = textContent;
  }

  return detail;
}

/**
 * Extract user-facing properties from a block
 * Flattens the internal CRDT structure to show clean properties
 */
export function extractBlockProperties(
  detail: BlockDetail,
): Record<string, any> {
  const merged: Record<string, any> = {};

  // Special handling for domainCreator blocks: parse surveySchema and answers
  // Check if this is a domainCreator block (either by blockType or by checking children)
  const isDomainCreator =
    detail.blockType === 'domainCreator' ||
    detail.nodeName === 'domainCreator' ||
    detail.children?.some((c) => c.nodeName === 'domainCreator');

  if (isDomainCreator) {
    // Check both direct attributes and props for surveySchema and answers
    // Also check child element attributes (domainCreator is typically a child of blockContainer)
    const directAttrs = detail.attributes || {};
    const childAttrs =
      detail.children?.find((c) => c.nodeName === 'domainCreator')
        ?.attributes || {};

    const surveySchemaString =
      merged.surveySchema ||
      directAttrs.surveySchema ||
      childAttrs.surveySchema;

    const answersString =
      merged.answers || directAttrs.answers || childAttrs.answers;

    if (typeof surveySchemaString === 'string') {
      const parsedSchema = parseSurveySchema(surveySchemaString);
      if (parsedSchema) {
        merged.surveySchema = parsedSchema;
      }
    }

    if (typeof answersString === 'string') {
      const parsedAnswers = parseSurveyAnswers(answersString);
      if (parsedAnswers && Object.keys(parsedAnswers).length > 0) {
        merged.answers = parsedAnswers;
      }
    }
  }

  return merged;
}

/**
 * Transform block detail into agent-friendly format
 */
export function simplifyBlockForAgent(detail: BlockDetail): {
  id: string;
  type: string;
  properties: Record<string, any>;
  text?: string;
} {
  // Use detail.blockType (already extracted in extractBlockDetail)
  // If not available, check first child element's nodeName
  // Fallback to nodeName
  let blockType = detail.blockType;

  if (!blockType && detail.children && detail.children.length > 0) {
    const firstChild = detail.children.find(
      (c) =>
        c.nodeName && c.nodeName !== '#text' && c.nodeName !== 'blockGroup',
    );
    if (firstChild) {
      blockType = firstChild.nodeName;
    }
  }

  if (!blockType) {
    blockType = detail.nodeName;
  }

  const properties = extractBlockProperties(detail);

  return {
    id: detail.id,
    type: blockType,
    properties,
    ...(detail.text && { text: detail.text }),
  };
}

/**
 * Collect all block containers from the document (EXACT copy from runListBlocks.ts)
 */
export function collectAllBlocks(
  fragment: Y.XmlFragment,
  includeText = true,
): BlockDetail[] {
  const results: BlockDetail[] = [];

  function collectBlockContainers(
    container: Y.XmlElement | Y.XmlFragment,
    results: BlockDetail[],
  ): void {
    const nodes = container.toArray();
    for (const node of nodes) {
      if (!(node instanceof Y.XmlElement)) {
        continue;
      }

      if (node.nodeName === 'blockContainer') {
        const detail = extractBlockDetail(node);
        if (detail) {
          results.push(detail);
        }
      }
      collectBlockContainers(node, results);
    }
  }

  collectBlockContainers(fragment, results);
  return results;
}

/**
 * Get block by ID and return its details
 */
export function getBlockDetail(
  doc: Y.Doc,
  blockId: string,
  includeText = true,
): BlockDetail | null {
  const fragment = doc.getXmlFragment('document');
  const blockContainer = findBlockById(fragment, blockId);

  if (!blockContainer) {
    return null;
  }

  return extractBlockDetail(blockContainer);
}
