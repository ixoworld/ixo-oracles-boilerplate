import { Logger } from '@ixo/logger';
// import {
//   LLMGraphTransformer,
//   SYSTEM_PROMPT,
//   type LLMGraphTransformerProps,
// } from '@langchain/community/experimental/graph_transformers/llm';
import { type GraphDocument } from '@langchain/community/graphs/document';
import { Neo4jGraph } from '@langchain/community/graphs/neo4j_graph';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { Neo4jError } from 'neo4j-driver';

interface IKnowledgeGraphConfig {
  graphDB: {
    url: string;
    username: string;
    password: string;
  };

  graphTransformerConfig?: any;
}

export class KnowledgeGraph {
  private readonly graph: Neo4jGraph;
  private initialized = false;
  private static instance: KnowledgeGraph;

  private constructor(private readonly config: IKnowledgeGraphConfig) {
    if (
      !config.graphDB.url ||
      !config.graphDB.username ||
      !config.graphDB.password
    ) {
      throw new Error('url, username, and password must be set');
    }
    this.graph = new Neo4jGraph({
      url: config.graphDB.url,
      username: config.graphDB.username,
      password: config.graphDB.password,
    });

    if (
      !config.graphTransformerConfig?.allowedNodes ||
      !config.graphTransformerConfig.allowedRelationships
    ) {
      Logger.warn(
        'No allowedNodes or allowedRelationships set. This will allow the LLM to create any node or relationship type. It is recommended to set allowedNodes and allowedRelationships to limit the types of nodes and relationships that can be created.',
      );
    }
  }

  public static getInstance(config: IKnowledgeGraphConfig): KnowledgeGraph {
    if (!KnowledgeGraph.instance) {
      KnowledgeGraph.instance = new KnowledgeGraph(config);
    }
    return KnowledgeGraph.instance;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.graph.verifyConnectivity();

    try {
      await this.graph.refreshSchema();
      await this.createFullTextIndex();
      this.initialized = true;
    } catch (error: unknown) {
      Logger.error(
        `Error refreshing schema${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      if (
        error instanceof Neo4jError &&
        error.code === 'Neo.ClientError.Procedure.ProcedureNotFound'
      ) {
        throw new Error(
          "Could not use APOC procedures. Please ensure the APOC plugin is installed in Neo4j and that 'apoc.meta.data()' is allowed in Neo4j configuration.",
        );
      }

      throw error;
    }
  }

  async insertKnowledge(texts: string[]): Promise<GraphDocument[]> {
    await this.init();
    try {
      const schema = this.graph.getStructuredSchema();
      Logger.info('Inserting knowledge into the graph...');
      // const llmGraphTransformer = new LLMGraphTransformer({
      //   llm: this.config.graphTransformerConfig?.llm ?? new ChatOpenAI(),
      //   prompt:
      //     this.config.graphTransformerConfig?.prompt ??
      //     ChatPromptTemplate.fromMessages([
      //       ['system', SYSTEM_PROMPT],
      //       [
      //         'human',
      //         'Tip: Make sure to answer in the correct format and do not include any explanations. Use the given format to extract information from the following input: {input}',
      //       ],
      //     ]),
      //   ...this.config.graphTransformerConfig,
      // });
      // const result = await llmGraphTransformer.convertToGraphDocuments(
      //   texts.map(
      //     (text) =>
      //       new Document({
      //         pageContent: text,
      //         metadata: {},
      //       }),
      //   ),
      // );

      // Logger.info(`Created ${result.length} documents`);

      // const reletionShipSet = new Set();
      // for (const doc of result) {
      //   for (const relationship of doc.relationships) {
      //     reletionShipSet.add(relationship.type);
      //   }
      // }
      // Logger.info(
      //   `Relationships: ${JSON.stringify(Array.from(reletionShipSet))}`,
      // );
      // await this.graph.addGraphDocuments(result, {
      //   includeSource: true,
      //   baseEntityLabel: true,
      // });

      // const totals = result.reduce(
      //   (acc, curr) => {
      //     acc.nodes += curr.nodes.length;
      //     acc.relationships += curr.relationships.length;
      //     return acc;
      //   },
      //   { nodes: 0, relationships: 0 },
      // );

      // Logger.info(
      //   `Knowledge inserted into the graph successfully\n Number of nodes: ${totals.nodes} \n Number of relationships: ${totals.relationships}`,
      // );
      // return result;
      return [];
    } catch (error) {
      Logger.error(
        `Error inserting knowledge into the graph${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw error;
    }
  }

  async createFullTextIndex(): Promise<void> {
    // This will create a fulltext index if it doesn't exist
    // Neo4j fulltext indexes are automatically updated when new records are inserted
    // No need to manually update the index after inserting new nodes
    const query = `
    CREATE FULLTEXT INDEX fulltext_entity_id IF NOT EXISTS
    FOR (n:__Entity__) 
    ON EACH [n.id];
    `;
    await this.graph.query(query);
  }
}
