import { formGradeDigests } from './regression-digest';

/**
 * Seeded generation must stay reproducible: these digests pin the exact music produced for
 * every form and grade (several seeds and metres each, plus key overrides). They guard
 * refactoring. When the music is changed deliberately, regenerate them with
 * formGradeDigests() and note the reason in the commit.
 */
const EXPECTED: Record<string, string> = {
  'invention/1': '38fe7fa9', 'invention/2': '66e771b9', 'invention/3': '9f9374ba', 'invention/4': '159e57b5', 'invention/5': '2b8e115a',
  'fugue/1': 'a9e6f863', 'fugue/2': '072c4d26', 'fugue/3': 'a187a577', 'fugue/4': '1ca54f06', 'fugue/5': 'cab49b92',
  'chorale/1': '1e86b2a3', 'chorale/2': '351971f1', 'chorale/3': '5b631259', 'chorale/4': '962ce7a4', 'chorale/5': 'd263a240',
  'minuet/1': 'b7729117', 'minuet/2': '0e2f9150', 'minuet/3': '96a3dcd9', 'minuet/4': '03fcfd54', 'minuet/5': 'e8772bea',
  'trio/1': '96d42854', 'trio/2': 'f959cbe6', 'trio/3': 'a6c2717e', 'trio/4': 'e4835e76', 'trio/5': '1cb30c13',
  'waltz/1': '2cc6cadc', 'waltz/2': '0ee877cf', 'waltz/3': 'b449efc7', 'waltz/4': 'e2c0edda', 'waltz/5': 'b7ba131d',
  'polonaise/1': '4ea3c1a7', 'polonaise/2': 'fd9325dd', 'polonaise/3': '8c674b42', 'polonaise/4': '98177eae', 'polonaise/5': 'd7e3035e',
  'gavotte/1': 'fc135383', 'gavotte/2': 'afad5c5d', 'gavotte/3': 'a5173d20', 'gavotte/4': 'fa08fed0', 'gavotte/5': '6a996371',
  'nocturne/1': 'ebaf5da0', 'nocturne/2': '31b293d1', 'nocturne/3': '830bd9f8', 'nocturne/4': 'bf6c1129', 'nocturne/5': 'e419ee51',
  'prelude/1': '4a6f6192', 'prelude/2': '1814ce60', 'prelude/3': 'f680bf79', 'prelude/4': '23c5d936', 'prelude/5': 'd4cbb6f0',
};

describe('seeded generation (regression)', () => {
  it('produces exactly the same music for the same settings, in every form and grade', () => {
    expect(formGradeDigests()).toEqual(EXPECTED);
  }, 120_000);
});
