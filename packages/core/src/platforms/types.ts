export interface PlatformDefaultTemplates {
  fetchNote: string;
  fetchComments?: string;
  fetchMedia: string;
}

export interface PlatformCreatorTemplates {
  profileFetch: string;
  postsFetch: string;
}

export interface PlatformAdapter {
  id: string;
  defaultTemplates: PlatformDefaultTemplates;
  creatorTemplates?: PlatformCreatorTemplates;
  directoryName: string;
  fieldMap: Record<string, string>;
}
