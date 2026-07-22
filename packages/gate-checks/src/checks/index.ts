import { type FunctionCatalog } from '../types.js';
import { fn as getInboundCommits, requiredArgs as getInboundCommitsArgs } from './get-inbound-commits.js';

export const catalog: FunctionCatalog = {
  'get-inbound-commits': { fn: getInboundCommits, requiredArgs: getInboundCommitsArgs },
};
