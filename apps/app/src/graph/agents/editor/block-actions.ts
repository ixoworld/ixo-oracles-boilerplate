import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';

const logger = {
  ...Logger,
  info: Logger.log,
};

export interface AppendBlockOptions {
  blockId?: string;
  blockType?: string;
  text?: string;
  attributes?: Record<string, unknown>;
  docName?: string;
  namespace?: string;
}

export interface EditBlockOptions {
  blockId: string;
  docName?: string;
  attributes?: Record<string, unknown>;
  removeAttributes?: string[];
  text?: string | null;
}

export interface BlockSnapshot {
  id: string;
  type: string;
  text: string;
  attributes: Record<string, unknown>;
}

export interface ProposalBlockProps {
  status?: ProposalStatus;
  title?: string;
  description?: string;
  icon?: string;
  proposalId?: string;
}

export type ProposalStatus =
  | 'draft'
  | 'open'
  | 'passed'
  | 'rejected'
  | 'executed'
  | 'closed'
  | 'execution_failed'
  | 'veto_timelock';

export const PROPOSAL_STATUS_VALUES: ProposalStatus[] = [
  'draft',
  'open',
  'passed',
  'rejected',
  'executed',
  'closed',
  'execution_failed',
  'veto_timelock',
];

const DEFAULT_FRAGMENT_NAME = 'document';
const DEFAULT_BLOCK_TYPE = 'paragraph';
const MUTATION_ORIGIN = 'blocknote-crdt-playground';

const randomId = () => randomUUID();

const setAnyAttribute = (
  element: Y.XmlElement,
  key: string,
  value: unknown,
) => {
  (
    element as unknown as { setAttribute: (attr: string, val: unknown) => void }
  ).setAttribute(key, value);
};

const getAnyAttribute = <T>(
  element: Y.XmlElement,
  key: string,
): T | undefined => {
  return element.getAttribute(key) as unknown as T | undefined;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ensureRootGroup = (fragment: Y.XmlFragment): Y.XmlElement => {
  const existingGroup = fragment
    .toArray()
    .find(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement && node.nodeName === 'blockGroup',
    );

  if (existingGroup) {
    return existingGroup;
  }

  const blockGroup = new Y.XmlElement('blockGroup');
  fragment.push([blockGroup]);
  return blockGroup;
};

const createBlockStructure = (
  blockId: string,
  blockType: string,
  text: string | undefined,
  attributes: Record<string, unknown>,
): Y.XmlElement => {
  const blockContainer = new Y.XmlElement('blockContainer');
  blockContainer.setAttribute('id', blockId);

  // BlockNote UI requires these attributes directly on blockContainer
  blockContainer.setAttribute('textColor', 'default');
  blockContainer.setAttribute('backgroundColor', 'default');

  const mergedAttributes = {
    id: blockId,
    type: blockType,
    ...attributes,
  } satisfies Record<string, unknown>;

  // Set attrs on parent blockContainer
  setAnyAttribute(blockContainer, 'attrs', mergedAttributes);

  const blockContent = new Y.XmlElement(blockType);
  blockContent.setAttribute('id', `${blockId}:content`);

  // Also set props on child element (matching edit behavior)
  if (isPlainObject(attributes)) {
    const props = attributes.props;
    if (isPlainObject(props)) {
      for (const [key, value] of Object.entries(props)) {
        blockContent.setAttribute(key, value as string);
      }
    }
  }

  if (typeof text === 'string') {
    const inlineText = new Y.XmlText();
    inlineText.insert(0, text);
    blockContent.push([inlineText]);
  }

  blockContainer.push([blockContent]);
  return blockContainer;
};

const findBlockById = (
  container: Y.XmlElement | Y.XmlFragment,
  blockId: string,
): Y.XmlElement | null => {
  const nodes = container.toArray();
  for (const node of nodes) {
    if (!(node instanceof Y.XmlElement)) {
      continue;
    }

    const candidateId =
      getAnyAttribute<string>(node, 'id') ?? node.getAttribute('id');
    if (candidateId === blockId) {
      return node;
    }

    const nested = findBlockById(node, blockId);
    if (nested) {
      return nested;
    }
  }

  return null;
};

const extractText = (element: Y.XmlElement): string => {
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
};

const snapshotBlock = (element: Y.XmlElement): BlockSnapshot => {
  const attrs =
    getAnyAttribute<Record<string, unknown>>(element, 'attrs') ?? {};
  const blockId =
    (attrs.id as string | undefined) ?? getAnyAttribute<string>(element, 'id');

  if (!blockId) {
    throw new Error('Unable to derive block id from element');
  }

  const blockType = (attrs.type as string | undefined) ?? element.nodeName;
  const textNode = element
    .toArray()
    .find(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement && node.nodeName !== 'blockGroup',
    );

  return {
    id: blockId,
    type: blockType,
    text: textNode ? extractText(textNode) : '',
    attributes: attrs,
  };
};

const applyAttributeUpdates = (
  element: Y.XmlElement,
  updates: Record<string, unknown> = {},
  removals: string[] = [],
) => {
  const existing =
    getAnyAttribute<Record<string, unknown>>(element, 'attrs') ?? {};
  const { props: propsUpdates, ...rest } = updates;

  const next: Record<string, unknown> = { ...existing, ...rest };

  if (isPlainObject(propsUpdates)) {
    const existingProps = isPlainObject(existing.props) ? existing.props : {};
    next.props = { ...existingProps, ...propsUpdates };
  }

  for (const key of removals) {
    if (key.startsWith('props.')) {
      const propKey = key.slice('props.'.length);
      if (isPlainObject(next.props)) {
        delete next.props[propKey];
      }
      continue;
    }

    delete next[key];
  }

  setAnyAttribute(element, 'attrs', next);

  const nextId = next.id;
  if (typeof nextId === 'string') {
    element.setAttribute('id', nextId);
  }

  // Also update the child element's direct attributes with props
  const blockContent = element
    .toArray()
    .find(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement && node.nodeName !== 'blockGroup',
    );

  if (blockContent && isPlainObject(propsUpdates)) {
    for (const [key, value] of Object.entries(propsUpdates)) {
      blockContent.setAttribute(key, value as string);
    }
  }

  // Handle removals on child element too
  if (blockContent && removals.length > 0) {
    for (const key of removals) {
      if (key.startsWith('props.')) {
        const propKey = key.slice('props.'.length);
        blockContent.removeAttribute(propKey);
      }
    }
  }
};

const applyTextUpdate = (
  element: Y.XmlElement,
  text: string | null | undefined,
) => {
  if (typeof text === 'undefined') {
    return;
  }

  const blockContent = element
    .toArray()
    .find(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement && node.nodeName !== 'blockGroup',
    );

  if (!blockContent) {
    // TODO: Adapt logic when working with complex blocks (tables, media, custom nodes).
    if (text === null || text === '') {
      return;
    }

    const contentNode = new Y.XmlElement(DEFAULT_BLOCK_TYPE);
    const inlineText = new Y.XmlText();
    inlineText.insert(0, text);
    contentNode.push([inlineText]);
    element.push([contentNode]);
    return;
  }

  const textNode = blockContent
    .toArray()
    .find((child): child is Y.XmlText => child instanceof Y.XmlText);

  if (!textNode) {
    if (text === null || text === '') {
      return;
    }
    const inlineText = new Y.XmlText();
    inlineText.insert(0, text);
    blockContent.push([inlineText]);
    return;
  }

  textNode.delete(0, textNode.length);
  if (text && text.length > 0) {
    textNode.insert(0, text);
  }
};
export const appendBlock = (
  doc: Y.Doc,
  options: AppendBlockOptions,
): BlockSnapshot => {
  const {
    blockId,
    blockType = DEFAULT_BLOCK_TYPE,
    text,
    attributes = {},
    docName = DEFAULT_FRAGMENT_NAME,
    namespace,
  } = options;

  const resolvedBlockId =
    blockId ?? (namespace ? `${namespace}-${randomId()}` : randomId());

  let snapshot: BlockSnapshot | undefined;

  doc.transact(() => {
    const fragment = doc.getXmlFragment(docName);
    const rootGroup = ensureRootGroup(fragment);
    const block = createBlockStructure(
      resolvedBlockId,
      blockType,
      text,
      attributes,
    );
    rootGroup.push([block]);
    snapshot = snapshotBlock(block);
  }, MUTATION_ORIGIN);

  if (!snapshot) {
    throw new Error('Failed to create block snapshot');
  }

  return snapshot;
};

export const editBlock = (
  doc: Y.Doc,
  options: EditBlockOptions,
): BlockSnapshot => {
  const {
    blockId,
    attributes = {},
    removeAttributes = [],
    text,
    docName = DEFAULT_FRAGMENT_NAME,
  } = options;

  let snapshot: BlockSnapshot | undefined;

  doc.transact(() => {
    const fragment = doc.getXmlFragment(docName);
    const target = findBlockById(fragment, blockId);

    if (!target) {
      throw new Error(`Block with id ${blockId} not found`);
    }

    const currentSnapshot = snapshotBlock(target);
    logger.info(
      'Block found - current state:',
      JSON.stringify(currentSnapshot, null, 2),
    );

    // Log the actual XML element attributes
    const allAttrs: Record<string, unknown> = {};
    const attrs = target.getAttributes();
    for (const [key, value] of Object.entries(attrs)) {
      allAttrs[key] = value;
    }
    logger.info(
      'Target element raw attributes:',
      JSON.stringify(allAttrs, null, 2),
    );

    // Log children
    const children = target.toArray();
    logger.info('Target has', children.length, 'children');
    children.forEach((child, idx) => {
      if (child instanceof Y.XmlElement) {
        const childAttrs: Record<string, unknown> = {};
        const cAttrs = child.getAttributes();
        for (const [key, value] of Object.entries(cAttrs)) {
          childAttrs[key] = value;
        }
        logger.info(
          `Child ${idx} (${child.nodeName}):`,
          JSON.stringify(childAttrs, null, 2),
        );
      }
    });

    applyAttributeUpdates(target, attributes, removeAttributes);
    applyTextUpdate(target, text);

    snapshot = snapshotBlock(target);
  }, MUTATION_ORIGIN);

  if (!snapshot) {
    throw new Error('Failed to update block snapshot');
  }

  return snapshot;
};
