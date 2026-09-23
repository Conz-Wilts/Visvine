import { Avatar, EmptyState, Row, Stack, UIProvider, type UIImageProps, type UILinkProps } from '@visvine/ui';
import { color } from '@visvine/tokens';

// The app's router link, marked so it is visibly the adapter drawing it.
function SpaceLink({ href, className, children, style, onClick }: UILinkProps) {
  return (
    <a
      href={`/s/growth${href}`}
      onClick={(e) => { e.preventDefault(); onClick?.(); }}
      className={`${className ?? ''} underline underline-offset-4`}
      style={style}
    >
      {children}
    </a>
  );
}

// The app's image component: rings every image it draws.
function RingedImage({ className, ...props }: UIImageProps) {
  return <img {...props} className={`${className ?? ''} ring-2 ring-accent ring-offset-1 ring-offset-surface`} />;
}

const portrait = (bg: string, fg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${bg}"/><circle cx="24" cy="19" r="8" fill="${fg}"/><path d="M8 46c2-10 9-15 16-15s14 5 16 15z" fill="${fg}"/></svg>`,
  )}`;

const ANA = portrait(color.hue.blue.wash, color.hue.blue.default);
const CRAIG = portrait(color.hue.green.wash, color.hue.green.default);

export const LinkAdapter = () => (
  <Row gap={8} align="start">
    <Stack gap={1} align="center" className="w-56">
      <span className="text-xs font-semibold text-fg-muted">Plain</span>
      <EmptyState size="sm" title="No agents" action={{ label: 'Browse connectors', href: '/admin?section=connectors' }} />
    </Stack>
    <Stack gap={1} align="center" className="w-56">
      <span className="text-xs font-semibold text-fg-muted">App link</span>
      <UIProvider link={SpaceLink}>
        <EmptyState size="sm" title="No agents" action={{ label: 'Browse connectors', href: '/admin?section=connectors' }} />
      </UIProvider>
    </Stack>
  </Row>
);

export const ImageAdapter = () => (
  <Row gap={8} align="start">
    <Stack gap={3} align="center">
      <span className="text-xs font-semibold text-fg-muted">Plain</span>
      <Row gap={3}>
        <Avatar name="Ana Ruiz" imageUrl={ANA} size="lg" />
        <Avatar name="Craig Tan" imageUrl={CRAIG} size="lg" />
      </Row>
    </Stack>
    <Stack gap={3} align="center">
      <span className="text-xs font-semibold text-fg-muted">App image</span>
      <UIProvider image={RingedImage}>
        <Row gap={3}>
          <Avatar name="Ana Ruiz" imageUrl={ANA} size="lg" />
          <Avatar name="Craig Tan" imageUrl={CRAIG} size="lg" />
        </Row>
      </UIProvider>
    </Stack>
  </Row>
);

export const BothAdapters = () => (
  <UIProvider link={SpaceLink} image={RingedImage}>
    <Stack gap={4} className="w-72">
      <Row gap={3}>
        <Avatar name="Ana Ruiz" imageUrl={ANA} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">Ana Ruiz</div>
          <div className="truncate text-xs text-fg-muted">Head of growth · Growth team</div>
        </div>
      </Row>
      <div className="border-t border-line-subtle">
        <EmptyState size="sm" title="No events yet" action={{ label: 'See the calendar', href: '/events' }} />
      </div>
    </Stack>
  </UIProvider>
);
