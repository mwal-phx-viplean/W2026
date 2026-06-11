import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ProgParserService } from './services/prog-parser.service';
import { ChannelLink, ProgEvent, ProgSchedule } from './models/prog.model';

/**
 * Source URL of the schedule data — a direct .txt link.
 * If the file matches the expected format it is displayed; otherwise the table
 * stays empty. Replace with your own CORS-enabled .txt URL.
 */
const DATA_SOURCE_URL = 'https://sportsonline.pk/prog.txt';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly parser = inject(ProgParserService);

  protected readonly schedule = signal<ProgSchedule | null>(null);
  protected readonly activeDay = signal<string>('');
  protected readonly loading = signal<boolean>(true);

  /** Events of the currently selected day. */
  protected readonly activeEvents = computed<ProgEvent[]>(() => {
    const sched = this.schedule();
    if (!sched) return [];
    return sched.days.find((d) => d.name === this.activeDay())?.events ?? [];
  });

  ngOnInit(): void {
    this.load();
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

  /** Open a channel link in a new browser tab. */
  protected open(link: ChannelLink): void {
    window.open(link.url, '_blank', 'noopener,noreferrer');
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
