import { PersonSilhouette, Row } from '@visvine/ui';

export const Default = () => (
  <span className="block h-12 w-12 overflow-hidden rounded-xl">
    <PersonSilhouette />
  </span>
);

export const Colors = () => (
  <Row gap={3}>
    {[
      'var(--vv-color-accent)',
      'var(--vv-color-type-person)',
      'var(--vv-color-hue-violet)',
      'var(--vv-color-hue-teal)',
      'var(--vv-color-hue-orange)',
    ].map((c) => (
      <span key={c} className="block h-10 w-10 overflow-hidden rounded-lg">
        <PersonSilhouette color={c} />
      </span>
    ))}
  </Row>
);

export const Shapes = () => (
  <Row gap={3} align="end">
    <span className="block h-4 w-4 overflow-hidden rounded-md"><PersonSilhouette /></span>
    <span className="block h-6 w-6 overflow-hidden rounded-md"><PersonSilhouette /></span>
    <span className="block h-9 w-9 overflow-hidden rounded-lg"><PersonSilhouette /></span>
    <span className="block h-16 w-16 overflow-hidden rounded-full"><PersonSilhouette /></span>
  </Row>
);

export const UploadedBy = () => (
  <div className="flex items-center gap-2 text-sm text-fg-muted">
    <span className="h-4 w-4 overflow-hidden rounded-md"><PersonSilhouette /></span>
    Uploaded by <span className="font-semibold text-fg-secondary">Ana Ruiz</span> · 2h ago
  </div>
);
