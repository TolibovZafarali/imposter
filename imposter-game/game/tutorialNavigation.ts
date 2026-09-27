type TutorialSwipe = {
  dx: number;
  dy: number;
  vx: number;
  width: number;
};

export function getTutorialSwipeDirection({ dx, dy, vx, width }: TutorialSwipe): -1 | 0 | 1 {
  if (![dx, dy, vx, width].every(Number.isFinite) || width <= 0) return 0;

  const distance = Math.abs(dx);
  if (distance <= Math.abs(dy) * 1.3) return 0;

  const deliberateSwipe = distance >= Math.max(44, width * 0.16);
  const quickFlick = distance >= 20 && Math.abs(vx) > 0.5 && Math.sign(vx) === Math.sign(dx);
  if (!deliberateSwipe && !quickFlick) return 0;

  return dx < 0 ? 1 : -1;
}
