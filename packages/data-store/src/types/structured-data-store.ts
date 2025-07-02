interface IQueryParams<T> {
  filterByFormula?: string;
  maxRecords?: number;
  pageSize?: number;
  fields?: (keyof T)[];
  view?: string;
}

export interface IDataStore<T> {
  getAllRecords: (
    tableName: string,
    selectOptions: IQueryParams<T>,
  ) => Promise<T[]>;
  /**
   * Get a record by its ID or throw an error if not found
   */
  getRecord: (tableName: string, recordId: string) => Promise<T>;
  createRecord: (tableName: string, recordData: T) => Promise<T>;
  updateRecord: (
    tableName: string,
    recordId: string,
    recordData: T,
  ) => Promise<T>;
  batchUpdateRecords: (
    tableName: string,
    records: { id: string; fields: T }[],
  ) => Promise<T[]>;
  deleteRecord: (tableName: string, recordId: string) => Promise<T>;
  getRecordByField: (
    tableName: string,
    fieldName: string,
    fieldValue: string,
  ) => Promise<T[]>;
}
