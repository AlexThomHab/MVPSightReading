/**
 * Eras and the forms written in each: what the menus offer, what each form is called, and the
 * metres it is written in. The compositional rules live with each era's generator:
 *   - Baroque (baroque.ts): counterpoint — the Invention and the Fugue; the Chorale (chorale.ts);
 *   - Classical / Galant (galant.ts): phrases built from galant schemata;
 *   - Romantic (chopin/): lyrical melody over a flowing accompaniment.
 * The menus and the generators read the same metres from here, so the two cannot disagree.
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
 * duple, written here in 4/4 or 2/4; Chopin's nocturnes are most often in 4/4. 2/2 and 12/8
 * are not yet in the notation model.
 */
export const FORMS: Readonly<Record<FormId, FormInfo>> = {
  invention: { id: 'invention', era: 'baroque', name: 'Invention', times: ['4/4', '3/4', '2/4'] },
  fugue: { id: 'fugue', era: 'baroque', name: 'Fugue', times: ['4/4', '2/4', '3/4', '6/8'] },
  chorale: { id: 'chorale', era: 'baroque', name: 'Chorale', times: ['4/4'] },
  minuet: { id: 'minuet', era: 'galant', name: 'Minuet', times: ['3/4'] },
  trio: { id: 'trio', era: 'galant', name: 'Trio', times: ['3/4', '2/4', '4/4'] },
  waltz: { id: 'waltz', era: 'galant', name: 'Waltz', times: ['3/4', '3/8'] },
  polonaise: { id: 'polonaise', era: 'galant', name: 'Polonaise', times: ['3/4'] },
  gavotte: { id: 'gavotte', era: 'galant', name: 'Gavotte', times: ['4/4', '2/4'] },
  nocturne: { id: 'nocturne', era: 'romantic', name: 'Nocturne', times: ['4/4', '3/4', '6/8', '9/8'] },
  prelude: { id: 'prelude', era: 'romantic', name: 'Prelude', times: ['4/4', '3/4', '2/4', '6/8'] },
};

export const FORM_IDS = Object.keys(FORMS) as FormId[];

export const isEraId = (value: string | null): value is EraId => value !== null && (ERA_IDS as readonly string[]).includes(value);
export const isFormId = (value: string | null): value is FormId => value !== null && Object.prototype.hasOwnProperty.call(FORMS, value);

export const eraOf = (form: FormId): EraId => FORMS[form].era;

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

/** The metres a form offers at a grade. */
export const timesFor = (grade: Grade, form: FormId) => formTimes(form, GRADE_SPECS[grade].times);
