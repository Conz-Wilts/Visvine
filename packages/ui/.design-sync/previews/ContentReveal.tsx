import { Avatar, ContentReveal } from '@visvine/ui';

export const Revealed = () => (
  <ContentReveal ready className="w-96">
    <div className="space-y-2">
      <div className="text-base font-semibold text-fg">Standup digest</div>
      <div className="text-sm text-fg-muted">Runs as Ana · sees 73 of 73 notes · next in 5h</div>
    </div>
  </ContentReveal>
);

export const PeoplePanel = () => (
  <ContentReveal ready role="tabpanel" id="panel-people" className="w-80">
    <div className="divide-y divide-line-subtle">
      {[
        ['Ana Ruiz', 'Head of Growth'],
        ['Craig Mathers', 'Partnerships'],
        ['Priya Nair', 'Design'],
      ].map(([name, role]) => (
        <div key={name} className="flex items-center gap-3 py-2.5">
          <Avatar name={name} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-fg">{name}</div>
            <div className="truncate text-xs text-fg-muted">{role}</div>
          </div>
        </div>
      ))}
    </div>
  </ContentReveal>
);

export const EventsTab = () => (
  <ContentReveal ready role="tabpanel" id="panel-events" className="w-96">
    <div className="divide-y divide-line-subtle">
      {[
        ['Founders dinner', 'Thu 12 Oct · 7pm · Auckland Founders'],
        ['Growth review', 'Mon 16 Oct · 10am · Growth team'],
      ].map(([title, meta]) => (
        <div key={title} className="py-3">
          <div className="text-sm font-semibold text-fg">{title}</div>
          <div className="text-xs text-fg-muted">{meta}</div>
        </div>
      ))}
    </div>
  </ContentReveal>
);
