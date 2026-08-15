import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NodesRepository } from '../nodes/nodes.repository';
import { StorageService } from '../storage/storage.service';
import { ABANDONED_AFTER_MS } from './files.service';

/**
 * Uploads that never finished: a closed tab, a lost connection, a browser that stopped
 * mid-transfer. Two things are left behind — a node holding a name nobody can see, and
 * an object in storage nobody points at — and both are removed here.
 *
 * A plain interval rather than `@nestjs/schedule`: this is one fixed period, which a
 * cron expression would only make less direct, and the package would be a dependency a
 * reviewer has to trust for a `setInterval` the platform already provides.
 */

const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_MS = 30 * 1000;
const BATCH_SIZE = 200;

@Injectable()
export class UploadSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadSweeper.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly repository: NodesRepository,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    // `unref` so neither timer holds the process open: without it a redeploy waits out
    // the full interval before the old container exits.
    this.timers.push(
      setTimeout(() => void this.sweep(), FIRST_RUN_MS).unref(),
      setInterval(() => void this.sweep(), INTERVAL_MS).unref(),
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  private async sweep(): Promise<void> {
    // A slow pass must not overlap the next tick — the second run would collect the
    // same rows and delete objects the first one is still working through.
    if (this.running) return;
    this.running = true;

    try {
      const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS);

      // Objects first: their keys live on the version rows about to be removed.
      const versions = await this.repository.findAbandonedVersions(
        cutoff,
        BATCH_SIZE,
      );
      for (const version of versions) {
        await this.storage.remove(version.storageKey);
        await this.repository.deleteVersion(version.id);
      }

      const tombstoned = await this.repository.softDeleteAbandonedUploads(
        cutoff,
        BATCH_SIZE,
      );

      if (versions.length > 0 || tombstoned > 0) {
        this.logger.log(
          `Swept ${versions.length} abandoned object(s) and ${tombstoned} stale upload row(s)`,
        );
      }
    } catch (error) {
      // Housekeeping failing is not worth crashing the process over; the next tick
      // picks up whatever is left.
      this.logger.warn(`Sweep failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
