import { Injectable, Logger } from '@nestjs/common';

/**
 * The four Supabase Storage calls this app makes, and nothing else.
 *
 * File bytes never pass through the API — see docs/architecture.md — so this mints a
 * URL the browser uploads to directly, mints one it reads back from, reads the first
 * bytes of a stored object to verify it, and deletes objects the sweeper has given up on.
 *
 * Plain `fetch` rather than `supabase-js`: these are four HTTP requests, and the
 * browser half of the upload has to be `XMLHttpRequest` anyway to get progress events,
 * so the client library would earn its place on neither side.
 */

export type StoredObject =
  | {
      kind: 'object';
      /** Up to `HEADER_SCAN_BYTES` from the front — enough to find a PDF header that
       * does not sit at offset zero. */
      firstBytes: Buffer;
      sizeBytes: number;
      contentType: string;
      etag: string | null;
    }
  /** The object exists but holds nothing. Storage accepts a zero-byte PUT. */
  | { kind: 'empty' }
  | { kind: 'missing' };

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Short by design — docs/architecture.md fixes it at 60s. A leaked URL stops working
 * within the minute, and the viewer refetches rather than holding a long-lived one.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

/**
 * How much of the object to read back when verifying it. A PDF header does not have to
 * sit at byte zero — the spec tolerates leading bytes, and pdf.js, Acrobat and every
 * other reader search the first kilobyte for it. Reading only the first few bytes
 * rejected real, readable documents: a PDF wrapped in a PKCS#7 signature container, the
 * usual form of a qualified electronic signature, carries its header around offset 70.
 */
export const HEADER_SCAN_BYTES = 1024;

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly baseUrl = `${process.env.SUPABASE_URL!.replace(/\/+$/, '')}/storage/v1`;
  private readonly bucket = process.env.STORAGE_BUCKET!;
  private readonly headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
  };

  /**
   * A URL the browser can `PUT` to with no credentials of its own, valid for two hours.
   * That is what makes an upload progress bar possible: the request carries no header
   * we would have to keep secret.
   */
  async signUploadUrl(key: string): Promise<string> {
    const response = await this.request(
      `${this.baseUrl}/object/upload/sign/${this.bucket}/${key}`,
      { method: 'POST', headers: this.headers },
    );

    if (!response.ok) {
      throw new Error(
        `Storage refused to sign an upload URL (${response.status}): ${await safeText(response)}`,
      );
    }

    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== 'string') {
      throw new Error('Storage signed an upload URL but returned no path.');
    }

    // The response carries a path, not an address.
    return `${this.baseUrl}${body.url}`;
  }

  /**
   * A URL the browser can read the object from with no credentials of its own. Without
   * `downloadAs` the object is served inline — Storage sends no `Content-Disposition`,
   * so the viewer renders it in place; with a filename it is served as an attachment
   * under that name, and Storage builds the RFC 5987 header itself.
   *
   * The signed path already carries `?token=`, which is why the filename is appended
   * with `&` — a second `?` would make it part of the token value.
   */
  async signDownloadUrl(key: string, downloadAs?: string): Promise<string> {
    const response = await this.request(
      `${this.baseUrl}/object/sign/${this.bucket}/${key}`,
      {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: DOWNLOAD_URL_TTL_SECONDS }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Storage refused to sign a download URL (${response.status}): ${await safeText(response)}`,
      );
    }

    const body = (await response.json()) as { signedURL?: unknown };
    if (typeof body.signedURL !== 'string') {
      throw new Error('Storage signed a download URL but returned no path.');
    }

    const filename = downloadAs
      ? `&download=${encodeURIComponent(downloadAs)}`
      : '';
    return `${this.baseUrl}${body.signedURL}${filename}`;
  }

  /**
   * The authoritative check on an uploaded object, in one request. A `Range` read of the
   * first kilobyte answers three questions at once: what the file contains at the front,
   * how large it actually is (`content-range` carries the total), and what content type
   * it was stored under.
   *
   * Two responses are not errors and must not be treated as one: `416` means the object
   * exists and is empty, and a `400` here means no such object — Storage does not answer
   * `404` on this route.
   *
   * Anything else throws rather than reporting `missing`. The caller deletes the whole
   * upload on `missing`, so mapping a transient Storage fault to it would destroy a file
   * that had arrived perfectly well, and tell the user it never finished.
   */
  async probe(key: string): Promise<StoredObject> {
    const response = await this.request(
      `${this.baseUrl}/object/${this.bucket}/${key}`,
      {
        headers: {
          ...this.headers,
          Range: `bytes=0-${HEADER_SCAN_BYTES - 1}`,
        },
      },
    );

    if (response.status === 416) return { kind: 'empty' };

    if (response.status === 400 || response.status === 404) {
      this.logger.debug(`Probe of ${key} answered ${response.status}`);
      return { kind: 'missing' };
    }

    if (response.status !== 206) {
      throw new Error(
        `Storage answered ${response.status} to a range read of ${key}`,
      );
    }

    const sizeBytes = totalFromContentRange(
      response.headers.get('content-range'),
    );
    if (sizeBytes === null) {
      throw new Error('Storage answered 206 without a usable content-range.');
    }

    return {
      kind: 'object',
      firstBytes: Buffer.from(await response.arrayBuffer()),
      sizeBytes,
      contentType: response.headers.get('content-type') ?? '',
      etag: response.headers.get('etag')?.replace(/"/g, '') ?? null,
    };
  }

  /**
   * Never throws. Every caller is cleaning up after a failure or sweeping, and an
   * object that cannot be deleted must not stop the database row from being removed —
   * a stuck row is visible to the user, a stray object is not.
   */
  async remove(key: string): Promise<void> {
    try {
      const response = await this.request(
        `${this.baseUrl}/object/${this.bucket}/${key}`,
        { method: 'DELETE', headers: this.headers },
      );
      if (!response.ok && response.status !== 400 && response.status !== 404) {
        this.logger.warn(`Could not delete ${key}: ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Could not delete ${key}: ${(error as Error).message}`);
    }
  }

  private request(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }
}

/** `bytes 0-7/16` -> 16. A short object answers `bytes 0-4/5`, so the total is the only
 * field worth reading — the returned length is not the file size. */
function totalFromContentRange(header: string | null): number | null {
  const total = header?.split('/')[1]?.trim();
  if (!total) return null;
  const parsed = Number(total);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '<no body>';
  }
}
