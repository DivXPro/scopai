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
  profileFieldMap?: Record<string, string>;
  commentFieldMap?: Record<string, string>;
  homepageUrlTemplate?: string;
  /** Extract the platform's native note/post ID from a URL or other identifier */
  extractNoteId?: (url: string) => string | undefined;
}
