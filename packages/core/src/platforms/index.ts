export type { PlatformAdapter, PlatformDefaultTemplates, PlatformCreatorTemplates } from './types';
export { registerPlatform, getPlatformAdapter, getAllPlatformAdapters } from './registry';

import { registerPlatform } from './registry';
import { xhsAdapter } from './xhs';
import { douyinAdapter } from './douyin';
import { bilibiliAdapter } from './bilibili';

registerPlatform(xhsAdapter);
registerPlatform(douyinAdapter);
registerPlatform(bilibiliAdapter);
