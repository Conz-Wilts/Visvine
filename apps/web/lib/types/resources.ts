// Resources domain: uploaded files, cell comments, and proposed changes.

// Resource types
type ResourceFileType =
  | 'pdf' | 'xlsx' | 'csv' | 'docx' | 'image'
  | 'markdown' | 'json' | 'text' | 'file';
type ResourceChangeStatus = 'pending' | 'approved' | 'rejected';

/**
 * Where a Drive file got to in the RAG pipeline. `unsupported` is not a failure
 * — an image has no text to index — which is why it is a separate state from
 * `failed` and reads differently in the UI.
 */
type ResourceIndexState = 'pending' | 'indexed' | 'unsupported' | 'failed';

export interface Resource {
  id: string;
  spaceId: string;
  name: string;
  fileType: ResourceFileType;
  /**
   * A download URL signed for this response. NOT an identifier and never stored
   * — see the note on `Resource.gcsPath` in the schema — so it must be used from
   * the payload that carried it and never cached.
   */
  fileUrl: string | null;
  fileSize?: number | null;
  uploadedBy?: string;
  /** The context source holding this file's chunks; null when it has none. */
  sourcePath?: string | null;
  indexState: ResourceIndexState;
  indexError?: string | null;
  /** Chunks this file contributed to retrieval — 0 until it is indexed. */
  chunkCount?: number;
  createdAt: string;
  metadata: {
    originalFilename?: string;
    sheetNames?: string[];
    mimeType?: string;
  };
}

export interface ResourceComment {
  id: string;
  resourceId: string;
  cellRef?: string;
  author: string;
  content: string;
  createdAt: string;
}

export interface ResourceChange {
  id: string;
  resourceId: string;
  cellRef: string;
  originalValue?: string;
  proposedValue: string;
  reason?: string;
  proposedBy: string;
  status: ResourceChangeStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}
