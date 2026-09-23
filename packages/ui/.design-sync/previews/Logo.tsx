import { Logo, Row } from '@visvine/ui';

export const Mark = () => <Logo variant="mark" size={96} title="Visvine" />;

export const Tile = () => <Logo variant="tile" size={96} title="Visvine" />;

export const Sizes = () => (
  <Row gap={4} align="end">
    {[16, 24, 32, 48, 64].map((size) => (
      <Logo key={size} variant="tile" size={size} />
    ))}
  </Row>
);

export const Wordmark = () => (
  <Row gap={2}>
    <Logo variant="mark" size={28} />
    <span className="font-brand text-2xl font-black text-brand">visvine</span>
  </Row>
);

export const SignIn = () => (
  <div className="flex w-72 flex-col items-center gap-3 py-4">
    <Logo variant="tile" size={56} title="Visvine" />
    <div className="text-lg font-semibold text-fg">Sign in to Visvine</div>
  </div>
);
