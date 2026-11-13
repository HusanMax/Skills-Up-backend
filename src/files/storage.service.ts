import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import type { Readable } from 'stream';

export interface StoredStream {
  body: Readable;
  status: 200 | 206;
  headers: Record<string, string>;
}

/**
 * Where uploaded files are kept: Cloudflare R2 (any S3-compatible storage) when the R2_* variables are set,
 * otherwise the local upload folder. The bucket stays PRIVATE: files are always served through the API,
 * which checks who may open them.
 */
@Injectable()
export class StorageService {
  private log = new Logger('Storage');
  private client: S3Client | null = null;
  private bucket = '';

  constructor(config: ConfigService) {
    let endpoint = config.get<string>('R2_ENDPOINT')?.trim();
    let bucket = config.get<string>('R2_BUCKET')?.trim();
    // Forgiving: if the bucket name was pasted at the end of the endpoint (https://<id>.r2.cloudflarestorage.com/<bucket>),
    // keep only the origin and use that name as the bucket when R2_BUCKET is empty.
    if (endpoint) {
      try {
        const url = new URL(endpoint);
        const fromPath = url.pathname.replace(/^\/+|\/+$/g, '');
        if (fromPath && !bucket) bucket = fromPath;
        endpoint = url.origin;
      } catch {
        /* an invalid URL is reported by the S3 client on first use */
      }
    }
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY');
    if (endpoint && bucket && accessKeyId && secretAccessKey) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        // R2 does not need the extra checksum trailers newer SDK versions add by default
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
      this.bucket = bucket;
      this.log.log(`Files are stored in Cloudflare R2 (bucket "${bucket}")`);
    } else {
      this.log.log('R2 is not configured: files are stored in the local upload folder');
    }
  }

  /** True when files go to R2. */
  get remote() {
    return this.client !== null;
  }

  /** Name of the storage new files are written to (saved with each file row). */
  get kind(): 'r2' | 'local' {
    return this.remote ? 'r2' : 'local';
  }

  /** Uploads a local (temporary) file to R2 and removes the local copy. */
  async put(key: string, localPath: string, contentType: string) {
    await this.client!.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: fs.createReadStream(localPath), ContentLength: fs.statSync(localPath).size, ContentType: contentType }));
    fs.rmSync(localPath, { force: true });
  }

  /** Opens an object from R2, honouring a Range header so that videos can be played and skipped through. */
  async open(key: string, range?: string): Promise<StoredStream> {
    const out = await this.client!.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }));
    const headers: Record<string, string> = { 'Accept-Ranges': 'bytes' };
    if (out.ContentLength !== undefined) headers['Content-Length'] = String(out.ContentLength);
    if (out.ContentRange) headers['Content-Range'] = out.ContentRange;
    if (out.ContentType) headers['Content-Type'] = out.ContentType;
    return { body: out.Body as Readable, status: out.ContentRange ? 206 : 200, headers };
  }

  async remove(key: string) {
    await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
