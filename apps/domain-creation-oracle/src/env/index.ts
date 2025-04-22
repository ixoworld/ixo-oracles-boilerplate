import { EnvService } from '@ixo/common';
import { envSchema, Schema } from './schema.js';

EnvService.initialize(envSchema);

const envService = EnvService.getInstance<Schema>();

export default envService;
