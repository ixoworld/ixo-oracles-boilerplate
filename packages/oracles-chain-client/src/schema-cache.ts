import { type Schema } from 'ajv';
import axios from 'axios';
import store from 'store';
import { mapUri } from './url-map';

const StoreKey = 'schemas';

export const getSchema = async (
  schemaCid: string,
  schemaUrl: string,
): Promise<Schema | undefined> => {
  const schemas = (await store.get(StoreKey)) as
    | Record<string, Schema>
    | undefined;
  let schema = schemas?.[schemaCid];

  if (schema) return schema;

  const schemaRes = await axios.get(mapUri(schemaUrl));
  if (schemaRes.status !== 200) throw new Error(schemaRes.statusText);
  if (!schemaRes.data)
    throw new Error('Schema not found on collection protocol');
  schema = schemaRes.data as Schema;
  await store.set(StoreKey, { ...schemas, [schemaCid]: schema });
  return schema;
};
