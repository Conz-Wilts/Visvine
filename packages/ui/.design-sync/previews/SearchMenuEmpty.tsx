import { useState } from 'react';
import { SEARCH_MENU_PANEL, SearchMenuEmpty, SearchMenuInput, SearchMenuList } from '@visvine/ui';

export const NoMatches = () => {
  const [query, setQuery] = useState('zendesk');
  return (
    <div className={`${SEARCH_MENU_PANEL} w-72`}>
      <SearchMenuInput value={query} onChange={setQuery} placeholder="Search connectors…" autoFocus={false} />
      <SearchMenuList>
        <SearchMenuEmpty />
      </SearchMenuList>
    </div>
  );
};

export const CustomMessage = () => {
  const [query, setQuery] = useState('');
  return (
    <div className={`${SEARCH_MENU_PANEL} w-72`}>
      <SearchMenuInput value={query} onChange={setQuery} placeholder="Search agents…" autoFocus={false} />
      <SearchMenuList>
        <SearchMenuEmpty>No agents in Growth team</SearchMenuEmpty>
      </SearchMenuList>
    </div>
  );
};

export const QuotedQuery = () => (
  <div className={`${SEARCH_MENU_PANEL} w-80`}>
    <SearchMenuInput value="Launch retro" onChange={() => {}} placeholder="Link a note…" autoFocus={false} />
    <SearchMenuList>
      <SearchMenuEmpty>Nothing matches “Launch retro”</SearchMenuEmpty>
    </SearchMenuList>
  </div>
);
