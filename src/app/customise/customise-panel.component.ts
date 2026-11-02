import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  ConstraintIssue,
  Customisation,
  HandIndependence,
  INTERVAL_NAMES,
  MAX_INTERVAL,
  NOTE_VALUES,
  NoteValue,
  NoteValueId,
  PitchRangeSetting,
  RhythmicDifficulty,
  defaultRange,
  isDefault,
  resolveConstraints,
  validateSettings,
} from '../music/constraints';
import { GRADE_SPECS, Grade, TIME_SIGNATURES, TimeSignatureId } from '../music/grades';
import { StyleId } from '../music/styles';
import { loadVexFlow } from '../score/engraving';
import { PitchRangeComponent } from './pitch-range.component';

type Area = ConstraintIssue['area'];
type Toggle = 'accidentals' | 'dynamics' | 'staccato' | 'accents' | 'tenuto' | 'slurs' | 'ornaments' | 'syncopation' | 'ties';

/** SMuFL (Bravura) glyphs: each note value as a note and as a rest, and a dot for dotted values. */
const NOTE_GLYPH: Record<number, string> = { 16: '', 8: '', 4: '', 2: '', 1: '' };
const REST_GLYPH: Record<number, string> = { 16: '', 8: '', 4: '', 2: '', 1: '' };
const DOT = '';
/** Time-signature digits 0–9 (SMuFL timeSig0…timeSig9). */
const timeDigits = (n: number) => [...String(n)].map((d) => String.fromCodePoint(0xe080 + Number(d))).join('');

interface Tile {
  id: NoteValueId;
  name: string;
  ticks: number;
  glyph: string;
  dotted: boolean;
}

function tilesFor(glyphs: Record<number, string>): Tile[] {
  return NOTE_VALUES.map((v: NoteValue) => {
    const dotted = !glyphs[v.ticks];
    return { id: v.id, name: v.name, ticks: v.ticks, glyph: glyphs[dotted ? (v.ticks * 2) / 3 : v.ticks], dotted };
  });
}

/** Which Customisation fields each section of the panel sets (for its "Custom" badge). */
const SECTION_FIELDS: Record<Area, (keyof Customisation)[]> = {
  rhythm: ['noteValues', 'restValues', 'rhythmicDifficulty', 'syncopation', 'ties'],
  metre: ['timeSignatures'],
  range: ['melodyRange', 'separateHands', 'bassRange', 'bassMaxLeap'],
  leaps: ['leapMode', 'maxLeap', 'ascending', 'descending'],
  hands: ['independence'],
  expression: ['accidentals', 'dynamics', 'staccato', 'accents', 'tenuto', 'slurs', 'ornaments'],
};

/**
 * Advanced settings for the generator: note values and rests, metres, pitch ranges, melodic
 * leaps, hand independence and expression. Everything starts at the grade's defaults; changing
 * a control overrides that one setting, and Reset returns to the grade. The panel only edits a
 * draft — the app applies it with the next New piece — and shows, as you go, any combination
 * that cannot work and any way a style will have to adapt.
 */
@Component({
  selector: 'app-customise-panel',
  imports: [NgTemplateOutlet, PitchRangeComponent],
  templateUrl: './customise-panel.component.html',
  styleUrl: './customise-panel.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomisePanelComponent {
  readonly grade = input.required<Grade>();
  readonly style = input.required<StyleId>();
  readonly keyId = input<string | undefined>(undefined);
  readonly timeId = input<TimeSignatureId | undefined>(undefined);
  /** The draft customisation being edited. */
  readonly value = input.required<Customisation>();
  /** True when the draft differs from the piece on screen. */
  readonly pending = input(false);

  readonly valueChange = output<Customisation>();
  readonly apply = output<void>();
  readonly closed = output<void>();

  protected readonly noteTiles = tilesFor(NOTE_GLYPH);
  protected readonly restTiles = tilesFor(REST_GLYPH);
  protected readonly dot = DOT;
  protected readonly timeChips = (Object.keys(TIME_SIGNATURES) as TimeSignatureId[]).map((id) => ({
    id,
    num: timeDigits(TIME_SIGNATURES[id].num),
    den: timeDigits(TIME_SIGNATURES[id].den),
  }));
  protected readonly intervalNames = INTERVAL_NAMES;
  /** Interval sizes a leap control offers: a 2nd to an octave. */
  protected readonly sizes = Array.from({ length: MAX_INTERVAL }, (_, i) => i + 1);
  protected readonly independenceOptions: { id: HandIndependence; label: string; hint: string }[] = [
    { id: 'together', label: 'Together', hint: 'Both hands play the same rhythm.' },
    { id: 'partial', label: 'Partial', hint: 'The hands sometimes move independently (the usual setting).' },
    { id: 'full', label: 'Full', hint: 'Each hand has its own rhythm throughout.' },
  ];
  protected readonly difficultyOptions: { id: RhythmicDifficulty; label: string }[] = [
    { id: 'easy', label: 'Easy' },
    { id: 'medium', label: 'Medium' },
    { id: 'difficult', label: 'Difficult' },
  ];
  protected readonly articulationToggles: { id: Toggle; label: string }[] = [
    { id: 'staccato', label: 'Staccato' },
    { id: 'accents', label: 'Accents' },
    { id: 'tenuto', label: 'Tenuto' },
    { id: 'slurs', label: 'Slurs' },
    { id: 'ornaments', label: 'Ornaments' },
  ];

  /** The draft resolved against the grade: what each control currently shows. */
  protected readonly resolved = computed(() => resolveConstraints(this.grade(), this.value()));
  protected readonly customised = computed(() => !isDefault(this.value()));
  protected readonly issues = computed(() =>
    validateSettings(
      { seed: '', grade: this.grade(), style: this.style(), keyId: this.keyId(), timeId: this.timeId(), custom: this.value() },
      this.resolved(),
    ),
  );
  protected readonly errorCount = computed(() => this.issues().filter((i) => i.severity === 'error').length);

  protected readonly melodyRange = computed(() => this.value().melodyRange ?? defaultRange(this.grade(), 'melody'));
  protected readonly bassRange = computed(() => this.value().bassRange ?? defaultRange(this.grade(), 'bass'));
  protected readonly leapMode = computed(() => this.value().leapMode ?? 'max');
  protected readonly gradeTimes = computed(() => GRADE_SPECS[this.grade()].times);

  constructor() {
    // The tiles are drawn in Bravura, which arrives with VexFlow (normally already loaded by the score).
    if (typeof document !== 'undefined' && 'fonts' in document) loadVexFlow().catch(() => undefined);
  }

  protected issuesIn(area: Area): ConstraintIssue[] {
    return this.issues().filter((i) => i.area === area);
  }

  protected isCustom(area: Area): boolean {
    const v = this.value();
    return SECTION_FIELDS[area].some((field) => v[field] !== undefined);
  }

  protected resetSection(area: Area): void {
    const next = { ...this.value() };
    for (const field of SECTION_FIELDS[area]) delete next[field];
    this.valueChange.emit(next);
  }

  protected set<K extends keyof Customisation>(field: K, v: Customisation[K]): void {
    this.valueChange.emit({ ...this.value(), [field]: v });
  }

  protected reset(): void {
    this.valueChange.emit({});
  }

  // Rhythm ------------------------------------------------------------------

  protected noteOn(t: Tile): boolean {
    return this.resolved().noteTicks.includes(t.ticks);
  }

  protected restOn(t: Tile): boolean {
    return this.resolved().restTicks.includes(t.ticks);
  }

  protected toggleNote(t: Tile): void {
    const on = this.resolved().noteTicks;
    this.set('noteValues', this.noteTiles.filter((x) => (x.id === t.id ? !on.includes(x.ticks) : on.includes(x.ticks))).map((x) => x.id));
  }

  protected toggleRest(t: Tile): void {
    const on = this.resolved().restTicks;
    this.set('restValues', this.restTiles.filter((x) => (x.id === t.id ? !on.includes(x.ticks) : on.includes(x.ticks))).map((x) => x.id));
  }

  // Metre -------------------------------------------------------------------

  protected timeOn(id: TimeSignatureId): boolean {
    return this.resolved().times.includes(id);
  }

  protected toggleTime(id: TimeSignatureId): void {
    const on = this.resolved().times;
    this.set('timeSignatures', this.timeChips.map((c) => c.id).filter((t) => (t === id ? !on.includes(t) : on.includes(t))));
  }

  // Ranges ------------------------------------------------------------------

  protected setRange(field: 'melodyRange' | 'bassRange', range: PitchRangeSetting): void {
    this.set(field, range);
  }

  protected setSeparateHands(on: boolean): void {
    const next: Customisation = { ...this.value(), separateHands: on };
    if (!on) {
      delete next.bassRange;
      delete next.bassMaxLeap;
    }
    this.valueChange.emit(next);
  }

  // Leaps -------------------------------------------------------------------

  protected setLeapMode(mode: 'max' | 'custom'): void {
    const next: Customisation = { ...this.value(), leapMode: mode };
    if (mode === 'custom') {
      // Start from what the largest-leap setting allows now.
      const r = this.resolved();
      next.ascending ??= [...r.ascending].sort((a, b) => a - b);
      next.descending ??= [...r.descending].sort((a, b) => a - b);
    } else {
      delete next.ascending;
      delete next.descending;
    }
    this.valueChange.emit(next);
  }

  protected intervalOn(direction: 'ascending' | 'descending', size: number): boolean {
    return this.resolved()[direction].has(size);
  }

  protected toggleInterval(direction: 'ascending' | 'descending', size: number): void {
    const current = [...this.resolved()[direction]];
    const next = current.includes(size) ? current.filter((s) => s !== size) : [...current, size];
    this.set(direction, next.sort((a, b) => a - b));
  }

  protected readonly repeatedNotes = computed(() => this.resolved().ascending.has(0) || this.resolved().descending.has(0));

  protected toggleRepeatedNotes(): void {
    const on = this.repeatedNotes();
    const r = this.resolved();
    const update = (set: ReadonlySet<number>) => (on ? [...set].filter((s) => s !== 0) : [0, ...set].filter((s, i, a) => a.indexOf(s) === i)).sort((a, b) => a - b);
    this.valueChange.emit({ ...this.value(), ascending: update(r.ascending), descending: update(r.descending) });
  }

  // Expression --------------------------------------------------------------

  protected toggleOn(id: Toggle): boolean {
    return this.resolved()[id];
  }

  protected flip(id: Toggle): void {
    this.set(id, !this.resolved()[id]);
  }
}
