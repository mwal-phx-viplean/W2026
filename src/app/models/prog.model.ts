/** A single clickable channel/language link attached to an event. */
export interface ChannelLink {
  /** Raw channel code parsed from the URL, e.g. "hd1", "br4", "sporttv1". */
  code: string;
  /** Display label, e.g. "HD1", "BR4". */
  label: string;
  /** Channel number when present, e.g. 1, 11. Null otherwise. */
  number: number | null;
  /** Coarse group used for ordering/coloring: "HD" | "BR" | "OTHER". */
  group: 'HD' | 'BR' | 'OTHER';
  /** Resolved language, e.g. "ENGLISH", "ARABIC". Empty when unknown. */
  language: string;
  /** Target URL opened in a new tab. */
  url: string;
}

/** One event at a given time, grouping all its channel links. */
export interface ProgEvent {
  /** Original time string, e.g. "20:00". */
  time: string;
  /** Sort key in minutes (with after-midnight rollover applied). */
  sortKey: number;
  /** Event title, e.g. "Team Alpha x Team Beta". */
  title: string;
  /** All channel links for this event, ordered HD -> BR -> OTHER, then by number. */
  links: ChannelLink[];
}

/** A day tab with its time-sorted events. */
export interface ProgDay {
  /** Day name as found in the file, e.g. "THURSDAY". */
  name: string;
  /** Events sorted by time of day. */
  events: ProgEvent[];
}

/** Full parsed schedule. */
export interface ProgSchedule {
  /** "LAST UPDATE" value if present in the header. */
  lastUpdate: string | null;
  /** Days in file order. */
  days: ProgDay[];
}
