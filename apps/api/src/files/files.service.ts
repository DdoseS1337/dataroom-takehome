import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/current-user.decorator';
import { ApiError } from '../common/api-error';
import { nextCandidateName } from '../nodes/node-name';
import {
  buildStorageKey,
  isUniqueViolation,
  MAX_DEPTH,
  NodesRepository,
  type NewUpload,
  type NodeWithRoom,
  type SiblingRow,
} from '../nodes/nodes.repository';
import {
  NodesService,
  toSummary,
  type NodeSummary,
} from '../nodes/nodes.service';
import { canWrite } from '../permissions/resolve-permission';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  StorageService,
  type StoredObject,
} from '../storage/storage.service';
import type { ConflictPolicy, InitUploadDto } from './files.dto';

/**
 * Upload is two-phase: `init` reserves the name and mints a URL, the browser sends the
 * bytes straight to storage, and `complete` verifies what actually landed. See
 * docs/architecture.md — the reasoning for the split, and for the unique index covering
 * `uploading` rows, is there rather than repeated here.
 */

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ABANDONED_AFTER_MS = 15 * 60 * 1000;

const KEEP_BOTH_ATTEMPTS = 20;
const VERSION_INSERT_ATTEMPTS = 3;
const PDF_MAGIC = Buffer.from('%PDF-', 'latin1');

const EMPTY_FILE = 'This file is empty, so it cannot be a PDF.';
const TOO_LARGE = `This file is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit.`;
const NOT_PDF = 'This file is not a PDF — it carries no PDF header.';
const NOT_STORED_AS_PDF =
  'This file was not stored as a PDF. Try uploading it again.';
const NEVER_ARRIVED =
  'The upload did not finish. Try uploading this file again.';
const NOT_IN_PROGRESS = 'This upload is no longer in progress.';
const STILL_UPLOADING = 'This file has not finished uploading yet.';

export interface DownloadUrl {
  url: string;
  expiresAt: string;
}

export interface InitUploadResponse {
  uploadUrl: string;
  nodeId: string;
  /** What the file was actually stored as — "Keep both" may have adjusted the name. */
  name: string;
  /** Handed back so `complete` and `cancel` act on this upload rather than the node's
   * newest one, which may belong to a replacement running alongside it. */
  versionId: string;
}

/** An upload that has rows but no bytes yet. */
interface Reservation extends NewUpload {
  /** False for a replacement, whose node existed before and must survive a discard. */
  isNewNode: boolean;
}

@Injectable()
export class FilesService {
  constructor(
    private readonly nodes: NodesService,
    private readonly repository: NodesRepository,
    private readonly storage: StorageService,
  ) {}

  async init(dto: InitUploadDto, user: AuthUser): Promise<InitUploadResponse> {
    const { node: parent, permission } = await this.nodes.authorise(
      dto.parentId,
      user,
    );

    if (!canWrite(permission)) throw ApiError.forbidden();
    if (parent.type !== 'folder') {
      throw ApiError.invalid('A file can only be uploaded into a folder.');
    }
    if (parent.depth + 1 > MAX_DEPTH) {
      throw ApiError.invalid(
        `Folders can be nested up to ${MAX_DEPTH} levels deep.`,
      );
    }
    // Both bounds are re-checked against the stored object in `complete`; rejecting
    // here only saves the user a transfer that was always going to be refused.
    if (dto.sizeBytes === 0) throw ApiError.invalid(EMPTY_FILE);
    if (dto.sizeBytes > MAX_FILE_BYTES) throw ApiError.invalid(TOO_LARGE);

    const reservation = await this.reserve(
      parent,
      dto.name,
      user.id,
      dto.onConflict ?? 'error',
    );

    try {
      return {
        uploadUrl: await this.storage.signUploadUrl(reservation.storageKey),
        nodeId: reservation.nodeId,
        name: reservation.name,
        versionId: reservation.versionId,
      };
    } catch (error) {
      // The rows are already written. Leaving them would hold the name for fifteen
      // minutes over a failure the user can neither see nor retry past.
      await this.discard(reservation);
      throw error;
    }
  }

  async complete(
    id: string,
    versionId: string,
    user: AuthUser,
  ): Promise<NodeSummary> {
    const { node, permission } = await this.nodes.authorise(id, user);
    if (!canWrite(permission)) throw ApiError.forbidden();
    if (node.type !== 'file') {
      throw ApiError.invalid('Only a file upload can be completed.');
    }

    const version = await this.repository.findInFlightVersion(
      node.id,
      versionId,
    );
    if (!version) return this.alreadyComplete(node, versionId);

    const inFlight = {
      nodeId: node.id,
      versionId: version.id,
      storageKey: version.storageKey,
      isNewNode: node.status === 'uploading',
    };

    // The authoritative check. The browser looked at these bytes too, but it was
    // looking at a file on disk — this is the object that actually reached storage.
    const stored = await this.storage.probe(version.storageKey);

    if (stored.kind !== 'object') {
      await this.discard(inFlight);
      throw ApiError.invalid(
        stored.kind === 'empty' ? EMPTY_FILE : NEVER_ARRIVED,
      );
    }

    const rejection = rejectionFor(stored);
    if (rejection) {
      // Cleaning up here rather than leaving it to the sweeper: a rejected upload that
      // keeps its row holds the name for fifteen minutes while the folder shows nothing.
      await this.discard(inFlight);
      throw ApiError.invalid(rejection);
    }

    return toSummary(
      await this.repository.completeUpload(
        node,
        version.id,
        stored.sizeBytes,
        stored.etag,
      ),
    );
  }

  /**
   * A short-lived URL the browser reads the bytes from directly — the API never proxies
   * them. Read access is enough: this is the only thing a read-only recipient needs.
   *
   * `expiresAt` is part of the frozen contract and says how long the URL is good for. It
   * is computed from the TTL asked for rather than parsed out of the token, and starts
   * its clock before the round trip, so it errs early rather than late. Today's viewer
   * does not read it — pdf.js takes the whole document in one request, so the URL has
   * done its work by the time it lapses — but a client that streamed would need it.
   */
  async downloadUrl(
    id: string,
    disposition: 'inline' | 'attachment',
    user: AuthUser | undefined,
  ): Promise<DownloadUrl> {
    const requestedAt = Date.now();
    const { node } = await this.nodes.authorise(id, user);

    if (node.type !== 'file') {
      throw ApiError.invalid('Only a file can be downloaded.');
    }

    const storageKey = await this.repository.findCurrentStorageKey(node.id);
    // A node with no current version is an upload that never finished. It is not in any
    // listing, so this is a stale tab or a hand-typed id rather than a broken file.
    if (!storageKey) throw ApiError.invalid(STILL_UPLOADING);

    return {
      url: await this.storage.signDownloadUrl(
        storageKey,
        disposition === 'attachment' ? node.name : undefined,
      ),
      expiresAt: new Date(
        requestedAt + DOWNLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  /**
   * Cancelling an upload in flight. Without it, a cancelled file keeps its name for
   * fifteen minutes, and dropping the same file again answers with a conflict against
   * a row the folder does not show.
   */
  async cancel(
    id: string,
    versionId: string | undefined,
    user: AuthUser,
  ): Promise<void> {
    const { node, permission } = await this.nodes.authorise(id, user);
    if (!canWrite(permission)) throw ApiError.forbidden();
    if (node.type !== 'file') {
      throw ApiError.invalid('Only a file upload can be cancelled.');
    }

    const version = await this.repository.findInFlightVersion(
      node.id,
      versionId,
    );

    // Not a delete endpoint — a finished file goes through DELETE /nodes/:id. Without
    // this guard, cancelling a replacement twice would take the original with it.
    if (!version && node.status === 'ready') {
      throw ApiError.invalid(NOT_IN_PROGRESS);
    }

    await this.discard({
      nodeId: node.id,
      versionId: version?.id ?? null,
      storageKey: version?.storageKey ?? null,
      isNewNode: node.status === 'uploading',
    });
  }

  /**
   * Resolves the name, and only the name. Everything here either returns rows that own
   * a free name or throws — no SELECT ever runs before an insert to predict a conflict.
   */
  private async reserve(
    parent: NodeWithRoom,
    name: string,
    createdBy: string,
    policy: ConflictPolicy,
  ): Promise<Reservation> {
    if (policy === 'keepBoth') {
      return this.reserveKeepingBoth(parent, name, createdBy);
    }

    try {
      return asNewNode(
        await this.repository.createFileNode(parent, name, createdBy),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const sibling = await this.repository.findSiblingByName(parent.id, name);

    // The row that caused the collision is already gone — a delete landed between the
    // failed insert and this lookup, so the name is free and the retry is the whole fix.
    if (!sibling) return this.retryOnce(parent, name, createdBy);

    // An upload nobody finished is not a conflict. Without this, a closed tab holds the
    // name until the sweeper next runs.
    if (isAbandonedUpload(sibling)) {
      await this.repository.softDeleteNode(sibling.id);
      return this.retryOnce(parent, name, createdBy);
    }

    if (policy === 'replace') return this.reserveReplacement(parent, sibling);

    throw ApiError.nameConflict(name, { existingType: sibling.type });
  }

  private async retryOnce(
    parent: NodeWithRoom,
    name: string,
    createdBy: string,
  ): Promise<Reservation> {
    try {
      return asNewNode(
        await this.repository.createFileNode(parent, name, createdBy),
      );
    } catch (error) {
      // Exactly one retry. A second collision means a live sibling took the name in
      // between, which is an ordinary conflict and the user's to resolve.
      if (isUniqueViolation(error)) throw ApiError.nameConflict(name);
      throw error;
    }
  }

  /**
   * The suffix comes from retrying the insert, not from reading the folder and picking
   * the next free number. Two uploads of the same name racing would read the same
   * folder, choose the same "(2)", and one of them would fail on a name nobody typed.
   */
  private async reserveKeepingBoth(
    parent: NodeWithRoom,
    name: string,
    createdBy: string,
  ): Promise<Reservation> {
    let candidate = name;

    for (let attempt = 0; attempt < KEEP_BOTH_ATTEMPTS; attempt++) {
      try {
        return asNewNode(
          await this.repository.createFileNode(parent, candidate, createdBy),
        );
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        candidate = nextCandidateName(candidate);
      }
    }

    throw ApiError.nameConflict(name);
  }

  /** Replace never overwrites bytes: it adds a version and repoints the node later. */
  private async reserveReplacement(
    parent: NodeWithRoom,
    sibling: SiblingRow,
  ): Promise<Reservation> {
    if (sibling.type !== 'file') {
      throw ApiError.invalid(
        `A folder named "${sibling.name}" already exists here, so it cannot be replaced by a file.`,
      );
    }
    // Another upload of this name is still in flight and not yet abandoned. Replacing a
    // file that has no bytes of its own would leave the folder holding neither.
    if (sibling.status !== 'ready') {
      throw ApiError.nameConflict(sibling.name, { existingType: 'file' });
    }

    const versionId = randomUUID();
    const storageKey = buildStorageKey(
      parent.dataRoomId,
      sibling.id,
      versionId,
    );
    await this.addVersion(sibling.id, versionId, storageKey);

    return {
      nodeId: sibling.id,
      name: sibling.name,
      versionId,
      storageKey,
      isNewNode: false,
    };
  }

  private async addVersion(
    nodeId: string,
    versionId: string,
    storageKey: string,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.repository.addVersion(nodeId, versionId, storageKey);
        return;
      } catch (error) {
        // Two replacements of the same file at once derive the same version number and
        // collide on (node_id, version_no). Re-deriving it is the retry.
        if (!isUniqueViolation(error) || attempt >= VERSION_INSERT_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  private async alreadyComplete(
    node: NodeWithRoom,
    versionId: string,
  ): Promise<NodeSummary> {
    // Only if *this* version is the one the node now serves. A retried request whose
    // first response was lost lands here and gets the truthful answer instead of a
    // retry loop over work that already succeeded.
    //
    // The comparison is against the requested version, not merely "the node is ready":
    // a replacement whose own upload was swept or cancelled would otherwise be told it
    // had succeeded, and handed the size of the file it was meant to replace.
    const summary =
      node.currentVersionId === versionId
        ? await this.repository.findSummary(node.id)
        : null;

    if (!summary) throw ApiError.invalid(NOT_IN_PROGRESS);
    return toSummary(summary);
  }

  private async discard(upload: {
    nodeId: string;
    versionId: string | null;
    storageKey: string | null;
    isNewNode: boolean;
  }): Promise<void> {
    if (upload.storageKey) await this.storage.remove(upload.storageKey);
    if (upload.versionId) await this.repository.deleteVersion(upload.versionId);
    if (upload.isNewNode) await this.repository.softDeleteNode(upload.nodeId);
  }
}

function asNewNode(upload: NewUpload): Reservation {
  return { ...upload, isNewNode: true };
}

export function isAbandonedUpload(sibling: SiblingRow): boolean {
  return (
    sibling.status === 'uploading' &&
    Date.now() - sibling.createdAt.getTime() > ABANDONED_AFTER_MS
  );
}

function rejectionFor(
  object: Extract<StoredObject, { kind: 'object' }>,
): string | null {
  if (object.sizeBytes === 0) return EMPTY_FILE;
  if (object.sizeBytes > MAX_FILE_BYTES) return TOO_LARGE;
  // Searched rather than matched at offset zero: the header is allowed to sit further
  // in, and every reader looks for it that way. See `HEADER_SCAN_BYTES`.
  if (!object.firstBytes.includes(PDF_MAGIC)) return NOT_PDF;
  // The stored content type is fixed at upload and cannot be corrected afterwards, so a
  // wrong one has to be rejected rather than recorded — a later download would serve it.
  if (
    object.contentType.split(';')[0]?.trim().toLowerCase() !== 'application/pdf'
  ) {
    return NOT_STORED_AS_PDF;
  }
  return null;
}
