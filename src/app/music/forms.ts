/**
 * Eras and the forms written in each: what the menus offer, what each form is called, and the
 * metres it is written in. The compositional rules live with each era's generator:
 *   - Baroque (baroque.ts): counterpoint — the Invention and the Fugue; the Chorale (chorale.ts);
 *   - Classical / Galant (galant.ts): phrases built from galant schemata;
 *   - Romantic (chopin/): lyrical melody over a flowing accompaniment.
 * The menus and the generators read the same metres from here, so the two cannot disagree.
 *
 * The form decides the style and structure; the grade decides the technical difficulty. A form
 * that cannot be written convincingly within a grade (a gavotte needs an upbeat, Grade 4) is
 * unavailable below its `minGrade`, and `unavailableReason` says why.
 */
import { GRADE_SPECS, Grade, TimeSignatureId } from './grades';
import { KEYS, Key } from './theory';

export type EraId = 'baroque' | 'galant' | 'romantic';
export type FormId = 'fugue' | 'invention' | 'chorale' | 'minuet' | 'trio' | 'waltz' | 'polonaise' | 'gavotte' | 'nocturne' | 'prelude';

export interface EraInfo {
  id: EraId;
  name: string;
  /** Its forms, in the order offered; the first is chosen when the era is. */
  forms: readonly FormId[];
}

export interface FormInfo {
  id: FormId;
  era: EraId;
  name: string;
  /** The metres the form is written in, the most typical first. */
  times: readonly TimeSignatureId[];
  /** The first grade at which the form can be written convincingly. */
  minGrade: Grade;
  /** Why it needs that grade, for the menus. */
  needs?: string;
}

export const ERAS: Readonly<Record<EraId, EraInfo>> = {
  baroque: { id: 'baroque', name: 'Baroque', forms: ['invention', 'fugue', 'chorale'] },
  galant: { id: 'galant', name: 'Classical / Galant', forms: ['minuet', 'trio', 'waltz', 'polonaise', 'gavotte'] },
  romantic: { id: 'romantic', name: 'Romantic', forms: ['nocturne', 'prelude'] },
};

export const ERA_IDS: readonly EraId[] = ['baroque', 'galant', 'romantic'];

/*
 * Metres (musical judgement over the suggested lists): a Chorale is in common time, as nearly
 * all of Bach's are (and the chorale generator writes in crotchet beats of 4/4); a Gavotte is
 * duple, written here in 4/4 or 2/4; Chopin's nocturnes are most often in 4/4, some in 12/8;
 * Bach's inventions include one in 9/8 and his gigue fugues are in 12/8. The irregular metres
 * of Grades 6–7 (5/8, 7/8, 5/4, 7/4) belong to the freest form, the Prelude. 2/2 is not yet in
 * the notation model.
 *
 * Grades (from the syllabus): Grade 1 plays each hand separately, so only forms that can pass
 * a line between the hands are offered there — an invention's imitation can, a nocturne's
 * melody-and-accompaniment cannot.
 */
export const FORMS: Readonly<Record<FormId, FormInfo>> = {
  invention: { id: 'invention', era: 'baroque', name: 'Invention', times: ['4/4', '3/4', '2/4', '9/8'], minGrade: 1 },
  fugue: {
    id: 'fugue',
    era: 'baroque',
    name: 'Fugue',
    times: ['4/4', '2/4', '3/4', '6/8', '12/8'],
    minGrade: 3,
    needs: 'its answer comes a fifth away, beyond a five-finger position',
  },
  chorale: { id: 'chorale', era: 'baroque', name: 'Chorale', times: ['4/4'], minGrade: 4, needs: 'a chorale begins on an upbeat and pauses at each phrase end' },
  minuet: { id: 'minuet', era: 'galant', name: 'Minuet', times: ['3/4'], minGrade: 1 },
  trio: { id: 'trio', era: 'galant', name: 'Trio', times: ['3/4', '2/4', '4/4'], minGrade: 1 },
  waltz: { id: 'waltz', era: 'galant', name: 'Waltz', times: ['3/4', '3/8'], minGrade: 1 },
  polonaise: { id: 'polonaise', era: 'galant', name: 'Polonaise', times: ['3/4'], minGrade: 3, needs: 'its rhythm needs semiquavers' },
  gavotte: { id: 'gavotte', era: 'galant', name: 'Gavotte', times: ['4/4', '2/4'], minGrade: 4, needs: 'a gavotte begins with an upbeat (anacrusis)' },
  nocturne: {
    id: 'nocturne',
    era: 'romantic',
    name: 'Nocturne',
    times: ['4/4', '3/4', '6/8', '9/8', '12/8'],
    minGrade: 3,
    needs: 'a singing Romantic melody moves beyond a five-finger position',
  },
  prelude: {
    id: 'prelude',
    era: 'romantic',
    name: 'Prelude',
    times: ['4/4', '3/4', '2/4', '6/8', '9/8', '12/8', '5/4', '5/8', '7/8', '7/4'],
    minGrade: 3,
    needs: 'a singing Romantic melody moves beyond a five-finger position',
  },
};

export const FORM_IDS = Object.keys(FORMS) as FormId[];

export const isEraId = (value: string | null): value is EraId => value !== null && (ERA_IDS as readonly string[]).includes(value);
export const isFormId = (value: string | null): value is FormId => value !== null && Object.prototype.hasOwnProperty.call(FORMS, value);

export const eraOf = (form: FormId): EraId => FORMS[form].era;

/** Whether a form can be written at a grade. */
export const formAvailable = (form: FormId, grade: Grade) => grade >= FORMS[form].minGrade;

/** Why a form is not offered at a grade, or null when it is ("A Gavotte begins … — from Grade 4."). */
export function unavailableReason(form: FormId, grade: Grade): string | null {
  const f = FORMS[form];
  if (formAvailable(form, grade)) return null;
  const why = f.needs ? f.needs[0].toUpperCase() + f.needs.slice(1) : `A ${f.name} needs a higher grade`;
  return `${why}: from Grade ${f.minGrade}.`;
}

/** The forms of an era a grade can write (the menu's enabled entries). */
export const availableForms = (era: EraId, grade: Grade) => ERAS[era].forms.filter((f) => formAvailable(f, grade));

/** Whether an era has any form at a grade, and the first grade at which it does. */
export const eraAvailable = (era: EraId, grade: Grade) => availableForms(era, grade).length > 0;
export const eraMinGrade = (era: EraId): Grade => Math.min(...ERAS[era].forms.map((f) => FORMS[f].minGrade)) as Grade;

/** The keys a grade allows. */
export function keysFor(grade: Grade): Key[] {
  const keys = GRADE_SPECS[grade].keys;
  return KEYS.filter((k) => keys.includes(k.id));
}

/**
 * The metres a piece in this form may be in: the form's own, as far as `allowed` (the grade's
 * metres, or the user's choice of them) permits — and the form's most typical metre if none do.
 */
export function formTimes(form: FormId, allowed: readonly TimeSignatureId[]): TimeSignatureId[] {
  const own = FORMS[form].times;
  const both = own.filter((t) => allowed.includes(t));
  return both.length ? both : [own[0]];
}

/**
 * The metres a form offers at a grade: those both allow (cumulatively, the grade's metres grow).
 * Empty when they share none — the menus then explain, rather than offer an unsuitable metre.
 */
export const timesFor = (grade: Grade, form: FormId): TimeSignatureId[] => FORMS[form].times.filter((t) => GRADE_SPECS[grade].times.includes(t));
