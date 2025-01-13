import AirtableBase, { type FieldSet } from 'airtable';
import { type QueryParams } from 'airtable/lib/query_params';
import { type IDataStore } from '../types';
import { withReportError } from '../utils';

/**
 * AirtableDataStore class to interact with Airtable API implementing IDataStore interface
 *
 * Basic CRUD operations
 */
export class AirtableDataStore<TFields extends FieldSet>
  implements IDataStore<TFields>
{
  private readonly base: AirtableBase.Base;

  constructor() {
    if (!process.env.AIRTABLE_API_KEY) {
      throw new Error('AIRTABLE_API_KEY is required');
    }

    if (!process.env.AIRTABLE_BASE_ID) {
      throw new Error('AIRTABLE_BASE_ID is required');
    }

    this.base = new AirtableBase({ apiKey: process.env.AIRTABLE_API_KEY }).base(
      process.env.AIRTABLE_BASE_ID,
    );
  }

  private static withId<TFields extends FieldSet>(
    record: AirtableBase.Record<TFields>,
  ): TFields & { id: string } {
    return {
      ...record.fields,
      id: record.id,
    };
  }

  async getAllRecords(
    tableName: string,
    selectOptions?: QueryParams<TFields>,
  ): Promise<(TFields & { id: string })[]> {
    const records = await withReportError(
      this.base<TFields>(tableName).select(selectOptions).all(),
    );

    return records.map((record) => AirtableDataStore.withId(record));
  }

  async getRecord(
    tableName: string,
    recordId: string,
  ): Promise<TFields & { id: string }> {
    const record = await withReportError(
      this.base<TFields>(tableName).find(recordId),
    );

    return AirtableDataStore.withId(record);
  }

  async createRecord(
    tableName: string,
    recordData: TFields,
  ): Promise<TFields & { id: string }> {
    const record = await withReportError(
      this.base<TFields>(tableName).create(recordData),
    );
    return AirtableDataStore.withId(record);
  }

  async updateRecord(
    tableName: string,
    recordId: string,
    recordData: Partial<TFields>,
  ): Promise<TFields & { id: string }> {
    const record = await withReportError(
      this.base<TFields>(tableName).update([
        {
          id: recordId,
          fields: recordData,
        },
      ]),
    );
    if (!record[0]) {
      // this error will never be thrown as the airtable sdk will throw an error but to satisfy typescript
      throw new Error('Record not found');
    }
    return AirtableDataStore.withId(record[0]);
  }

  async batchUpdateRecords(
    tableName: string,
    records: {
      id: string;
      fields: Partial<
        TFields & {
          batch?: boolean;
        }
      >;
    }[],
  ): Promise<(TFields & { id: string })[]> {
    const updatedRecords = await withReportError(
      this.base<TFields>(tableName).update(records),
    );
    return updatedRecords.map((record) => AirtableDataStore.withId(record));
  }

  async deleteRecord(
    tableName: string,
    recordId: string,
  ): Promise<TFields & { id: string }> {
    const record = await withReportError(
      this.base<TFields>(tableName).destroy(recordId),
    );
    return AirtableDataStore.withId(record);
  }

  async getRecordByField(
    tableName: string,
    fieldName: string,
    fieldValue: string,
  ): Promise<(TFields & { id: string })[]> {
    const records = await withReportError(
      this.base<TFields>(tableName)
        .select({
          filterByFormula: `{${fieldName}} = "${fieldValue}"`,
        })
        .all(),
    );
    return records.map((record) => AirtableDataStore.withId(record));
  }

  public getLinkToRecord(recordId: string): string {
    if (!process.env.AITABLE_BASE_TABLE_LINK) {
      throw new Error('AITABLE_BASE_TABLE_LINK is required');
    }
    return `${process.env.AITABLE_BASE_TABLE_LINK}/${recordId}`;
  }
}

export type { FieldSet };
