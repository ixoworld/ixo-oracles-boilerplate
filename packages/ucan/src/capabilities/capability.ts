/**
 * @fileoverview Generic capability definition helpers
 *
 * This module provides a simple way to define capabilities for any service.
 * The capability definitions are used for both delegation creation and
 * invocation validation, including custom caveat (nb) validation.
 *
 * Type inference follows ucanto's pattern - types flow automatically from
 * schema definitions to callback parameters.
 */

import { capability, URI, Schema } from '@ucanto/validator';
import type { Capability as UcantoCapability } from '@ucanto/interface';

// Re-export Schema for use in caveat definitions
export { Schema };

// =============================================================================
// Type Utilities (matching ucanto's pattern)
// =============================================================================

/**
 * Extracts the output type O from a Reader/Schema
 * A Reader<O, I> has a read method that returns { ok: O } | { error: ... }
 */
type Infer<T> = T extends {
  read(input: unknown): { ok: infer O } | { error: unknown };
}
  ? O
  : never;

/**
 * Maps a struct shape to its output types
 * { limit: Schema<number | undefined> } -> { limit?: number }
 */
type InferStruct<U extends Record<string, unknown>> = {
  [K in keyof U]: Infer<U[K]>;
};

// =============================================================================
// Capability Definition Types
// =============================================================================

/**
 * Options for defining a capability
 *
 * @template NBSchema - The schema shape for caveats (nb field).
 *                      Types are automatically inferred from the schema.
 *
 * @example
 * ```typescript
 * // Type inference happens automatically!
 * const EmployeesRead = defineCapability({
 *   can: 'employees/read',
 *   protocol: 'myapp:',
 *   nb: { limit: Schema.integer().optional() },
 *   derives: (claimed, delegated) => {
 *     // claimed.nb?.limit is typed as number | undefined
 *     const claimedLimit = claimed.nb?.limit ?? Infinity;
 *     const delegatedLimit = delegated.nb?.limit ?? Infinity;
 *     if (claimedLimit > delegatedLimit) {
 *       return { error: new Error('Limit exceeds delegation') };
 *     }
 *     return { ok: {} };
 *   }
 * });
 * ```
 */
export interface DefineCapabilityOptions<
  // NBSchema is the schema SHAPE, e.g., { limit: Schema<number | undefined> }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  NBSchema extends Record<string, any> = Record<string, never>,
> {
  /**
   * The action this capability authorizes
   * Use "/" to namespace actions (e.g., 'employees/read', 'files/write')
   */
  can: string;

  /**
   * URI protocol for the resource
   * @default 'urn:'
   * @example 'myapp:', 'ixo:', 'https:'
   */
  protocol?: string;

  /**
   * Whether to support wildcard matching in resource URIs
   * When true, 'myapp:users/*' will match 'myapp:users/123'
   * @default true
   */
  supportWildcards?: boolean;

  /**
   * Schema for caveats (nb field)
   * Use Schema from @ucanto/validator to define caveat types.
   * Types are automatically inferred - no need to specify generics!
   *
   * @example
   * ```typescript
   * nb: {
   *   limit: Schema.integer().optional(),
   *   department: Schema.string().optional(),
   * }
   * ```
   */
  nb?: NBSchema;

  /**
   * Custom derivation function to validate capability attenuation.
   * Called when checking if a claimed capability can be derived from a delegated one.
   *
   * The types for claimed.nb and delegated.nb are automatically inferred
   * from the nb schema definition above.
   *
   * @example
   * ```typescript
   * derives: (claimed, delegated) => {
   *   // Types are inferred! claimed.nb?.limit is number | undefined
   *   const claimedLimit = claimed.nb?.limit ?? Infinity;
   *   const delegatedLimit = delegated.nb?.limit ?? Infinity;
   *   if (claimedLimit > delegatedLimit) {
   *     return { error: new Error(`Limit exceeds delegation`) };
   *   }
   *   return { ok: {} };
   * }
   * ```
   */
  derives?: (
    claimed: { with: string; nb?: InferStruct<NBSchema> },
    delegated: { with: string; nb?: InferStruct<NBSchema> },
  ) => { ok: Record<string, never> } | { error: Error };
}

/**
 * Define a capability for your service with optional caveat validation.
 *
 * Types flow automatically from schema definitions - no need to specify
 * generic type parameters manually!
 *
 * @param options - Capability definition options
 * @returns A ucanto capability definition
 *
 * @example
 * ```typescript
 * // Simple capability without caveats
 * const EmployeesRead = defineCapability({
 *   can: 'employees/read',
 *   protocol: 'myapp:'
 * });
 *
 * // Capability with caveat validation - types are inferred!
 * const EmployeesReadLimited = defineCapability({
 *   can: 'employees/read',
 *   protocol: 'myapp:',
 *   nb: {
 *     limit: Schema.integer().optional(),
 *   },
 *   derives: (claimed, delegated) => {
 *     // claimed.nb?.limit is automatically typed as number | undefined
 *     const claimedLimit = claimed.nb?.limit ?? Infinity;
 *     const delegatedLimit = delegated.nb?.limit ?? Infinity;
 *     if (claimedLimit > delegatedLimit) {
 *       return { error: new Error(`Cannot request ${claimedLimit}, limit is ${delegatedLimit}`) };
 *     }
 *     return { ok: {} };
 *   }
 * });
 * ```
 */
 
export function defineCapability<
  NBSchema extends Record<string, any> = Record<string, never>,
>(options: DefineCapabilityOptions<NBSchema>) {
  const protocol = (options.protocol ?? 'urn:') as `${string}:`;
  const supportWildcards = options.supportWildcards ?? true;

  // Build the nb schema - Schema.struct handles the schema object
  const nbSchema = options.nb
    ? Schema.struct(options.nb as Parameters<typeof Schema.struct>[0])
    : Schema.struct({});

  return capability({
    can: options.can as `${string}/${string}`,
    with: URI.match({ protocol }),
    nb: nbSchema,
    derives: (claimed, delegated) => {
      const claimedUri = claimed.with;
      const delegatedUri = delegated.with;

      // First check resource URI matching
      if (claimedUri !== delegatedUri) {
        // Handle wildcard patterns if enabled
        if (supportWildcards) {
          // Single wildcard: myapp:users/* matches myapp:users/123
          if (delegatedUri.endsWith('/*')) {
            const baseUri = delegatedUri.slice(0, -1);
            if (!claimedUri.startsWith(baseUri)) {
              return {
                error: new Error(
                  `Resource '${claimedUri}' not covered by '${delegatedUri}'`,
                ),
              };
            }
          }
          // Double wildcard at end: myapp:* matches myapp:anything/here
          else if (delegatedUri.endsWith(':*')) {
            const baseUri = delegatedUri.slice(0, -1);
            if (!claimedUri.startsWith(baseUri)) {
              return {
                error: new Error(
                  `Resource '${claimedUri}' not covered by '${delegatedUri}'`,
                ),
              };
            }
          } else {
            return {
              error: new Error(
                `Resource '${claimedUri}' does not match '${delegatedUri}'`,
              ),
            };
          }
        } else {
          return {
            error: new Error(
              `Resource '${claimedUri}' does not match '${delegatedUri}'`,
            ),
          };
        }
      }

      // Then run custom derives if provided (for caveat validation)
      if (options.derives) {
        return options.derives(
          { with: claimedUri, nb: claimed.nb as InferStruct<NBSchema> },
          { with: delegatedUri, nb: delegated.nb as InferStruct<NBSchema> },
        );
      }

      return { ok: {} };
    },
  });
}

// Re-export useful types
export type { UcantoCapability, Infer, InferStruct };
