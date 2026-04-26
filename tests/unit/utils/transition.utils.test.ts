import { calcTransitionDelta } from '../../../src/utils/transition.utils';

describe('calcTransitionDelta', () => {
  it('computes delta for normal inputs', () => {
    // (0.8 - 0.3) / (50 - 25) = 0.5 / 25 = 0.02
    expect(calcTransitionDelta(0.3, 0.8, 25, 50)).toBeCloseTo(0.02);
  });

  it('returns null when any input is null', () => {
    expect(calcTransitionDelta(null, 0.8, 25, 50)).toBeNull();
    expect(calcTransitionDelta(0.3, null, 25, 50)).toBeNull();
    expect(calcTransitionDelta(0.3, 0.8, null, 50)).toBeNull();
    expect(calcTransitionDelta(0.3, 0.8, 25, null)).toBeNull();
  });

  it('returns null when denominator is zero', () => {
    expect(calcTransitionDelta(0.3, 0.8, 25, 25)).toBeNull();
  });

  it('returns a negative delta when likelihood decreases (valid)', () => {
    // (0.2 - 0.8) / (20 - 10) = -0.6 / 10 = -0.06
    expect(calcTransitionDelta(0.8, 0.2, 10, 20)).toBeCloseTo(-0.06);
  });
});
