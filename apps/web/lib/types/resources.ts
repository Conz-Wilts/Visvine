// Resources domain: uploaded files, cell comments, and proposed changes.

// Resource types
type ResourceFileType = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'image';
type ResourceChangeStatus = 'pending' | 'approved' | 'rejected';

export interface Resource {
  id: string;
  communityId: string;
  name: string;
  fileType: ResourceFileType;
  fileUrl: string;
  fileSize?: number;
  uploadedBy?: string;
  createdAt: string;
  metadata: {
    originalFilename?: string;
    sheetNames?: string[];
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
