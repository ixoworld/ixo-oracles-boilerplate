/**
 * Chroma-specific document content filter operators
 */
export interface IChromaDocumentFilter {
  $contains?: string;
  $not_contains?: string;
}

/**
 * Chroma-specific metadata filter operators
 */
export type IChromaMetadataFilter = Record<
  string,
  string | number | boolean | null | IChromaMetadataOperators
>;

export interface IChromaMetadataOperators {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: number;
  $gte?: number;
  $lt?: number;
  $lte?: number;
  $in?: unknown[];
  $nin?: unknown[];
  $and?: IChromaMetadataFilter[];
  $or?: IChromaMetadataFilter[];
}
