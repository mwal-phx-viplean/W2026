import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ChannelLink, ProgDay, ProgEvent, ProgSchedule } from '../models/prog.model';

/** Day names recognized as tab headers in the source file. */
const DAY_NAMES = new Set([
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
]);

/** Times before this many minutes are treated as "after midnight" and sorted last. */
const ROLLOVER_CUTOFF_MIN = 6 * 60; // 06:00

/** Matches a channel definition line like "HD1 ENGLISH" (no pipe, no time). */
const CHANNEL_DEF_RE = /^([A-Za-z]{2,5}\d{1,3})\s+([A-Za-z][A-Za-z \-()]*?)\s*$/;

/** Matches an event line like "20:00   Team A x Team B | https://host/.../hd1.php". */
const EVENT_RE = /^(\d{1,2}:\d{2})\s+(.*?)\s*\|\s*(\S+)\s*$/;

/** Matches "LAST UPDATE: 11-06-26" inside the header block. */
const LAST_UPDATE_RE = /LAST UPDATE:\s*([0-9][0-9-/]+)/i;

@Injectable({ providedIn: 'root' })
export class ProgParserService {
  private readonly http = inject(HttpClient);

  /** Fetch the schedule text from `url` and parse it. */
  load(url: string): Observable<ProgSchedule> {
    return this.http
      .get(url, { responseType: 'text' })
      .pipe(map((text) => this.parse(text)));
  }

  /** Parse raw schedule text into a structured schedule. */
  parse(text: string): ProgSchedule {
    // Strip a possible UTF-8 BOM, normalize newlines.
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);

    const channelLanguages: Record<string, string> = {};
    let lastUpdate: string | null = null;

    const days: ProgDay[] = [];
    let currentDay: ProgDay | null = null;
    // Groups lines of the same (time + title) into one event within the current day.
    let eventIndex = new Map<string, ProgEvent>();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (lastUpdate === null) {
        const lu = line.match(LAST_UPDATE_RE);
        if (lu) lastUpdate = lu[1].trim();
      }

      const upper = line.toUpperCase();
      if (DAY_NAMES.has(upper)) {
        currentDay = { name: upper, events: [] };
        days.push(currentDay);
        eventIndex = new Map<string, ProgEvent>();
        continue;
      }

      // Event lines contain a pipe separating the title from the URL.
      if (line.includes('|')) {
        const ev = line.match(EVENT_RE);
        if (ev && currentDay) {
          this.addEventLine(currentDay, eventIndex, channelLanguages, ev[1], ev[2], ev[3]);
        }
        continue;
      }

      // Otherwise it may be a channel definition (only meaningful before the days).
      const def = line.match(CHANNEL_DEF_RE);
      if (def) {
        channelLanguages[def[1].toLowerCase()] = def[2].trim().toUpperCase();
      }
    }

    for (const day of days) {
      day.events.sort((a, b) => a.sortKey - b.sortKey);
      for (const event of day.events) {
        event.links.sort(this.compareLinks);
      }
    }

    return { lastUpdate, days };
  }

  private addEventLine(
    day: ProgDay,
    index: Map<string, ProgEvent>,
    channelLanguages: Record<string, string>,
    time: string,
    title: string,
    url: string,
  ): void {
    const cleanTitle = title.trim();
    const key = `${time}__${cleanTitle}`;
    let event = index.get(key);
    if (!event) {
      event = { time, sortKey: this.sortKey(time), title: cleanTitle, links: [] };
      index.set(key, event);
      day.events.push(event);
    }
    event.links.push(this.buildLink(url, channelLanguages));
  }

  /** Derive a ChannelLink (code, group, language) from a URL. */
  private buildLink(url: string, channelLanguages: Record<string, string>): ChannelLink {
    const path = url.split('#')[0].split('?')[0];
    const last = path.substring(path.lastIndexOf('/') + 1);
    const code = last.replace(/\.php$/i, '').toLowerCase();

    const numMatch = code.match(/(\d+)$/);
    const number = numMatch ? parseInt(numMatch[1], 10) : null;

    let group: ChannelLink['group'] = 'OTHER';
    if (code.startsWith('hd')) group = 'HD';
    else if (code.startsWith('br')) group = 'BR';

    let language = channelLanguages[code] ?? '';
    if (!language && group === 'BR') language = 'BRAZILIAN';

    return { code, label: code.toUpperCase(), number, group, language, url };
  }

  /** Minutes from midnight, with early-morning times rolled over to sort after the evening. */
  private sortKey(time: string): number {
    const [h, m] = time.split(':').map((n) => parseInt(n, 10));
    const minutes = (h || 0) * 60 + (m || 0);
    return minutes < ROLLOVER_CUTOFF_MIN ? minutes + 24 * 60 : minutes;
  }

  /** Order links HD -> BR -> OTHER, then by channel number. */
  private compareLinks = (a: ChannelLink, b: ChannelLink): number => {
    const rank = (g: ChannelLink['group']) => (g === 'HD' ? 0 : g === 'BR' ? 1 : 2);
    const byGroup = rank(a.group) - rank(b.group);
    if (byGroup !== 0) return byGroup;
    return (a.number ?? 999) - (b.number ?? 999);
  };
}
