/**
 * Firebase Storage interfaces
 */

import { UploadTaskSnapshot } from '@angular/fire/storage';

/**
 * Progress tracking for file uploads
 */
export interface UploadProgress {
  progress: number;
  snapshot: UploadTaskSnapshot;
}
