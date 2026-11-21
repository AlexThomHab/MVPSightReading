import { formGradeDigests } from './regression-digest';

/**
 * Seeded generation must stay reproducible: these digests pin the exact music produced for
 * every form and grade (several seeds and metres each, plus key overrides). They guard
 * refactoring. When the music is changed deliberately, regenerate them with
 * formGradeDigests() and note the reason in the commit.
 */
const EXPECTED: Record<string, string> = {
  'invention/1': '2ba90166', 'invention/2': '18bc804a', 'invention/3': '47ed541a', 'invention/4': 'e16df8c3', 'invention/5': 'a276adbe', 'invention/6': '108de42d', 'invention/7': '78d98bc9', 'invention/8': 'f6ef4ec5',
  'fugue/3': 'a025cb59', 'fugue/4': 'a93f479b', 'fugue/5': 'bbaae703', 'fugue/6': '080809fd', 'fugue/7': '680e8ed7', 'fugue/8': 'cee322a5',
  'chorale/4': '4fcbd986', 'chorale/5': '46570805', 'chorale/6': '660bc6cd', 'chorale/7': '612ec074', 'chorale/8': '41e750ca',
  'minuet/1': '05d8f1a2', 'minuet/2': 'd95d83ce', 'minuet/3': '085819c4', 'minuet/4': '6cd19689', 'minuet/5': '10b67e8a', 'minuet/6': '15621a2a', 'minuet/7': '90845248', 'minuet/8': 'cd03f072',
  'trio/1': '8efdf563', 'trio/2': 'cc5fcf33', 'trio/3': 'f04527a0', 'trio/4': '3b70111b', 'trio/5': 'ec3e9d54', 'trio/6': '8f12ac89', 'trio/7': 'f4dfeeab', 'trio/8': 'e09f92b0',
  'waltz/1': '19f0adcb', 'waltz/2': 'a0048194', 'waltz/3': 'f5119dd8', 'waltz/4': 'fbc23d54', 'waltz/5': '5ce12a99', 'waltz/6': 'c35f050a', 'waltz/7': '7d28ac63', 'waltz/8': '5fafb16c',
  'polonaise/3': '5d8c0b96', 'polonaise/4': '66ad01c0', 'polonaise/5': 'b7b9d0de', 'polonaise/6': '624bb671', 'polonaise/7': '2d3ef0cd', 'polonaise/8': '4ff0b966',
  'gavotte/4': '89d62a42', 'gavotte/5': '321ffeff', 'gavotte/6': '282ba4ac', 'gavotte/7': '405dabc2', 'gavotte/8': 'eeb4c6fd',
  'nocturne/3': '0542bdd6', 'nocturne/4': 'd7f286a1', 'nocturne/5': '6818fac0', 'nocturne/6': 'abaee936', 'nocturne/7': 'd9b4e882', 'nocturne/8': 'b164842e',
  'prelude/3': 'd531d04e', 'prelude/4': 'c0462d3f', 'prelude/5': 'b4d36201', 'prelude/6': '713ce0eb', 'prelude/7': '30dab565', 'prelude/8': '7a4557a9',
};

describe('seeded generation (regression)', () => {
  it('produces exactly the same music for the same settings, in every form and grade', () => {
    expect(formGradeDigests()).toEqual(EXPECTED);
  }, 240_000);
});
