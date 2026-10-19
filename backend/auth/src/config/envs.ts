import 'dotenv/config';
import { validateEnvs } from './env.schema';

export const envs = validateEnvs(process.env);
