export const ENCODER_TEETH = 48;

/** Representative radial bearing, stationary outer race and zero contact
 * angle. Rigid no-slip kinematics only: no preload, friction or life model. */
export function hubBearingKinematics({ wheelAngle = 0, wheelOmega = 0, pitchRadius = .0321, ballRadius = .0048 } = {}) {
  for (const value of [wheelAngle, wheelOmega, pitchRadius, ballRadius]) if (!Number.isFinite(value)) throw new TypeError('bearing inputs must be finite');
  if (!(ballRadius > 0 && pitchRadius > ballRadius)) throw new RangeError('bearing requires 0 < ball radius < pitch radius');
  const q = ballRadius / pitchRadius, cageRatio = (1 - q) / 2;
  const ballRelativeRatio = -(1 / q - q) / 2, ballWorldRatio = cageRatio + ballRelativeRatio;
  const innerRpm = wheelOmega * 60 / (Math.PI * 2);
  return { model: 'ideal radial bearing; zero contact angle; no slip', pitchRadius, ballRadius,
    cageRatio, ballRelativeRatio, ballWorldRatio,
    innerAngle: wheelAngle, cageAngle: wheelAngle * cageRatio, ballRelativeAngle: wheelAngle * ballRelativeRatio, ballWorldAngle: wheelAngle * ballWorldRatio,
    innerRpm, outerRpm: 0, cageRpm: innerRpm * cageRatio, ballRelativeRpm: innerRpm * ballRelativeRatio, ballWorldRpm: innerRpm * ballWorldRatio };
}
