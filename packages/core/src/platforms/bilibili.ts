import type { PlatformAdapter } from './types';

export const bilibiliAdapter: PlatformAdapter = {
  id: 'bilibili',
  defaultTemplates: {
    fetchNote: '',
    fetchMedia: 'opencli bilibili download {url} --output {download_dir}/{platform} -f json',
  },
  directoryName: 'bilibili',
  fieldMap: {},
};
