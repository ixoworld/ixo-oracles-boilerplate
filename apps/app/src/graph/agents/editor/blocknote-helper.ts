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
  const attrs = detail.attributes?.attrs as Record<string, any> | undefined;

  if (!attrs) {
    return {};
  }

  // Priority: props (edit storage) > top-level attrs (old create storage)
  const props = attrs.props as Record<string, any> | undefined;

  // Merge top-level and props, with props taking priority
  const merged = { ...attrs };
  delete merged.props; // Remove the nested props object

  if (props) {
    Object.assign(merged, props);
  }

  // Clean up internal metadata that agents don't need
  delete merged.id;
  delete merged.type;
  delete merged.textColor;
  delete merged.backgroundColor;

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

  return {
    id: detail.id,
    type: blockType,
    properties: extractBlockProperties(detail),
    ...(detail.text && { text: detail.text }),
  };
}

/**
 * Collect all block containers from the document (EXACT copy from runListBlocks.ts)
 */
export function collectAllBlocks(
  fragment: Y.XmlFragment,
  includeText: boolean = true,
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
  includeText: boolean = true,
): BlockDetail | null {
  const fragment = doc.getXmlFragment('document');
  const blockContainer = findBlockById(fragment, blockId);

  if (!blockContainer) {
    return null;
  }

  return extractBlockDetail(blockContainer);
}

/**
 * Validate block type
 */
export function isValidBlockType(blockType: string): boolean {
  const validTypes = [
    'paragraph',
    'heading',
    'proposal',
    'checkbox',
    'apiRequest',
    'list',
    'notification',
    'proposalVote',
    'bulletListItem',
    'numberedListItem',
  ];

  return validTypes.includes(blockType);
}

/**
 * Get block type-specific default attributes
 */
export function getDefaultAttributes(blockType: string): Record<string, any> {
  const defaults: Record<string, Record<string, any>> = {
    proposal: {
      status: 'draft',
      title: '',
      description: '',
      icon: 'square-check',
      proposalId: '',
      actions: '[]',
      voteEnabled: false,
      voteTitle: '',
      voteSubtitle: '',
      voteIcon: 'checklist',
      daysLeft: 0,
      proposalContractAddress: '',
      coreAddress: '',
      conditions: '',
    },
    checkbox: {
      checked: false,
      title: '',
      description: '',
      icon: 'square-check',
      allowedCheckers: 'all',
      initialChecked: false,
      conditions: '',
    },
    apiRequest: {
      title: '',
      description: '',
      endpoint: '',
      method: 'GET',
      headers: '[]',
      body: '[]',
      response: '',
      status: 'idle',
      conditions: '',
    },
    list: {
      title: '',
      did: '',
      fragmentIdentifier: '',
      conditions: '',
    },
    paragraph: {},
    heading: {
      level: 1,
    },
  };

  return defaults[blockType] || {};
}
