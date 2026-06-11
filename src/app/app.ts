import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { ProgParserService } from './services/prog-parser.service';
import { ChannelLink, ProgEvent, ProgSchedule } from './models/prog.model';
import { toFeedPath } from './feed-url';

/**
 * Source URL of the schedule data — a direct .txt link.
 * If the file matches the expected format it is displayed; otherwise the table
 * stays empty. Replace with your own CORS-enabled .txt URL.
 */
const DATA_SOURCE_URL = 'https://sportsonline.pk/prog.txt';

/** How often to poll for a newer deployed version (auto-update detection). */
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '(document:keydown.escape)': 'closePlayer()' },
})
export class App implements OnInit {
  private readonly parser = inject(ProgParserService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly swUpdate = inject(SwUpdate);

  protected readonly schedule = signal<ProgSchedule | null>(null);
  protected readonly activeDay = signal<string>('');
  protected readonly loading = signal<boolean>(true);

  /** True once a new app version has been downloaded and is ready to activate. */
  protected readonly updateAvailable = signal<boolean>(false);

  /** Channel currently shown in the embedded player, or null when closed. */
  protected readonly playerLink = signal<ChannelLink | null>(null);

  /**
   * Same-origin, sanitized iframe src for the active player.
   * Built from the `/__feed` proxy path so the real host is never exposed.
   */
  protected readonly playerSrc = computed<SafeResourceUrl | null>(() => {
    const link = this.playerLink();
    if (!link) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(toFeedPath(link.url));
  });

  /** Events of the currently selected day. */
  protected readonly activeEvents = computed<ProgEvent[]>(() => {
    const sched = this.schedule();
    if (!sched) return [];
    return sched.days.find((d) => d.name === this.activeDay())?.events ?? [];
  });

  ngOnInit(): void {
    this.load();
    this.watchForUpdates();
  }

  /**
   * Listen for newer deployed versions. When one is downloaded and ready, flip
   * `updateAvailable` so the home page shows the "Update" button. Also polls
   * periodically so a long-open tab/installed PWA notices new releases.
   */
  private watchForUpdates(): void {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.updateAvailable.set(true));

    this.swUpdate.checkForUpdate();
    setInterval(() => this.swUpdate.checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
  }

  /** Activate the downloaded version and reload into it. */
  protected applyUpdate(): void {
    this.swUpdate.activateUpdate().then(() => document.location.reload());
  }

  /**
   * Load and parse the schedule from DATA_SOURCE_URL.
   * Any failure (network, CORS, 404, wrong format) just leaves an empty table.
   */
  protected load(): void {
    this.loading.set(true);
    this.parser.load(DATA_SOURCE_URL).subscribe({
      next: (sched) => this.applySchedule(sched),
      error: () => this.applySchedule({ lastUpdate: null, days: [] }),
    });
  }

  private applySchedule(sched: ProgSchedule): void {
    this.schedule.set(sched);
    this.activeDay.set(sched.days.length ? sched.days[0].name : '');
    this.loading.set(false);
  }

  protected selectDay(name: string): void {
    this.activeDay.set(name);
  }

  /** Open a channel inside the on-site player (the remote host stays hidden). */
  protected open(link: ChannelLink): void {
    this.playerLink.set(link);
  }

  /** Close the embedded player. */
  protected closePlayer(): void {
    this.playerLink.set(null);
  }

  /** Bootstrap button color based on the channel language (visual grouping only). */
  protected btnClass(link: ChannelLink): string {
    const map: Record<string, string> = {
      ENGLISH: 'btn-primary',
      FRENCH: 'btn-info',
      GERMAN: 'btn-warning',
      SPANISH: 'btn-danger',
      ITALIAN: 'btn-success',
      ARABIC: 'btn-dark',
      BRAZILIAN: 'btn-secondary',
    };
    return map[link.language] ?? 'btn-outline-secondary';
  }
}
