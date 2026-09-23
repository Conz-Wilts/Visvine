import { Button, IconBase, Row, Stack } from '@visvine/ui';

const Plus = (props: { size?: number; className?: string; title?: string }) => (
  <IconBase {...props}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </IconBase>
);

const ChevronRight = (props: { size?: number; className?: string; title?: string }) => (
  <IconBase {...props}>
    <path d="m9 18 6-6-6-6" />
  </IconBase>
);

const Calendar = (props: { size?: number; className?: string; title?: string }) => (
  <IconBase {...props}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <path d="M3 10h18" />
  </IconBase>
);

const Search = (props: { size?: number; className?: string; title?: string }) => (
  <IconBase {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </IconBase>
);

export const Glyphs = () => (
  <Row gap={6} className="text-fg">
    <Plus />
    <ChevronRight />
    <Calendar />
    <Search />
  </Row>
);

export const Sizes = () => (
  <Row gap={5} align="end" className="text-fg-muted">
    {[12, 16, 20, 24, 32].map((size) => (
      <Stack key={size} gap={1.5} align="center">
        <Calendar size={size} />
        <span className="text-[11px] tabular-nums text-fg-muted">{size}</span>
      </Stack>
    ))}
  </Row>
);

export const Colour = () => (
  <Row gap={6}>
    <Plus size={20} className="text-fg-muted" />
    <Plus size={20} className="text-fg" />
    <Plus size={20} className="text-accent" />
    <Plus size={20} className="text-danger" />
  </Row>
);

export const InContext = () => (
  <Stack gap={3} className="w-64">
    <Button variant="brand">
      <Row gap={1.5}>
        <Plus size={16} />
        New space
      </Row>
    </Button>
    <Row justify="between" className="border-b border-line-subtle pb-2 text-sm">
      <Row gap={2} className="text-fg">
        <Calendar size={16} className="text-fg-muted" />
        Launch night
      </Row>
      <ChevronRight size={16} className="text-fg-muted" />
    </Row>
    <button type="button" aria-label="Search" className="self-start rounded-lg p-1.5 text-fg-muted hover:bg-surface-muted">
      <Search size={18} title="Search" />
    </button>
  </Stack>
);
