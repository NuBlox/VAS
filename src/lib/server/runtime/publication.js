/** Immutable published snapshot identity, separate from the legacy 32-bit editor revision. */
import { createHash } from 'node:crypto';
import { RecordError } from '../../studio/records.js';
import { projectRevision } from '../../studio/revision.js';

export function releaseId(project) {
  return createHash('sha256').update(JSON.stringify(project)).digest('hex');
}

export function validatePublication(project,manifest) {
  if (!manifest || manifest.version!==1 || manifest.projectId!==project.id ||
      manifest.releaseId!==releaseId(project) || manifest.editorRevision!==projectRevision(project) ||
      typeof manifest.publishedAt!=='string' || Number.isNaN(Date.parse(manifest.publishedAt)))
    throw new RecordError('Published application manifest does not match the active project snapshot',503);
  return manifest;
}
