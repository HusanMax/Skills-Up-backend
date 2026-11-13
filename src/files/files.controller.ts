import { Controller, Get, Param, ParseIntPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import { AuthUser, CurrentUser } from '../common/decorators';
import { FilePurpose, FilesService } from './files.service';
import { StorageService } from './storage.service';

const PURPOSES: FilePurpose[] = ['answer', 'task', 'video'];

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private files: FilesService, private storage: StorageService) {}

  /**
   * Upload one file (multipart field "file"). ?purpose=answer|task|video picks the rule (type and size, docs section 8).
   * Folders are not accepted: send a ZIP.
   */
  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.resolve('uploads')),
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: 300 * 1024 * 1024, files: 1 },
    }),
  )
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Query('purpose') purpose: string = 'answer') {
    if (!file) throw new BadRequestException('Fayl yuborilmadi.');
    if (!PURPOSES.includes(purpose as FilePurpose)) throw new BadRequestException("purpose: answer, task yoki video bo'lsin.");
    return this.files.register(user, file, purpose as FilePurpose);
  }

  /** Download / stream. Express answers Range requests, so videos can be played and seeked. */
  @Get(':id')
  async open(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Req() req: Request, @Res() res: Response) {
    const f = await this.files.byId(id);
    await this.files.assertCanOpen(user, f);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.originalName)}`);
    if (f.storage === 'r2') {
      // the bucket is private: the API reads the object (with the browser's Range) and passes it on
      const out = await this.storage.open(f.storageKey, req.headers.range);
      res.status(out.status);
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
      res.type(f.mimeType);
      out.body.on('error', () => res.destroy());
      return out.body.pipe(res);
    }
    res.type(f.mimeType);
    return res.sendFile(this.files.pathOf(f));
  }
}
