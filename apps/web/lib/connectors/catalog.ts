/**
 * The connector catalog: the services the "Add connector" picker offers,
 * each with the fields a person fills in and the note that comes out.
 *
 * Pure data plus one builder, importable from the client. An entry does not
 * add a vendor to the platform — it is a recipe for an ordinary connector
 * note at connectors/<name>.md whose frontmatter is the perimeter and whose
 * body teaches an agent how to call the service (AGENTS.md#connectors). The
 * permission model is untouched: the note is admin-written, secrets live in
 * the secret store, and `connectors:use` is what lets an agent run it.
 *
 * Three shapes:
 *   - `key`: a static credential (API key, bot token, DSN) stored as a secret
 *     and bound into `env:` — the common case.
 *   - `oauth`: the note carries an `auth:` block; the secret stored here is the
 *     OAuth client, and the account itself is connected afterwards from the
 *     connector's page (lib/connectors/auth.ts).
 *   - `model`: an LLM provider the space's agents run on — never runnable
 *     (lib/connectors/model.ts).
 *
 * A recipe is not a slot. A space may connect one service several times — the
 * team's Drive beside your own, two Slack workspaces — so a connector's NAME
 * (`google-drive`, then `google-drive-2`) no longer says which service it is
 * to. The note's `recipe:` does ({@link catalogEntryFor}). The exception is a
 * model provider, which is one per space by construction
 * ({@link allowsManyConnectors}).
 */

import { SANDBOX_LIMITS } from './config'
import { newModelConnectorNote } from './model'

export type CatalogCategory =
  | 'email'
  | 'meetings'
  | 'messengers'
  | 'productivity'
  | 'development'
  | 'llm'
  | 'data'
  | 'other'

export const CATALOG_CATEGORIES: ReadonlyArray<{ id: CatalogCategory; label: string; description: string }> = [
  { id: 'email', label: 'Email & calendar', description: 'Your own mailbox, calendar, contacts and files.' },
  { id: 'meetings', label: 'Meeting notes', description: 'Transcripts and summaries from your meeting recorder.' },
  { id: 'messengers', label: 'Messengers', description: 'Chat platforms agents can read from and post to.' },
  { id: 'productivity', label: 'Productivity', description: 'Docs, tasks, CRM and the tools work lives in.' },
  { id: 'development', label: 'Development tools', description: 'Code hosting and issue trackers.' },
  { id: 'llm', label: 'LLM keys', description: 'The model provider this space’s agents run on.' },
  { id: 'data', label: 'Data', description: 'Databases and payment data, read directly.' },
  { id: 'other', label: 'Other', description: 'Anything with an HTTP API, an MCP server, or a service not listed.' },
]

interface CatalogField {
  /** Form key; for a secret field this is also the secret NAME (UPPER_SNAKE). */
  key: string
  label: string
  placeholder?: string
  /** Where to find the value — shown under the input. */
  hint?: string
  /** Stored in the secret store and bound as env.<key>; never written into the note. */
  secret?: boolean
  required?: boolean
  /** A multi-line value (e.g. a list of hosts). */
  multiline?: boolean
}

export interface CatalogEntry {
  id: string
  name: string
  description: string
  category: CatalogCategory
  /** Path under /images/connectors. */
  logo: string
  shape: 'key' | 'oauth' | 'model'
  /** `host` or `host:port` entries the isolate may reach. */
  hosts: readonly string[]
  fields: readonly CatalogField[]
  /** `model` entries: the registry provider id. */
  provider?: string
  /** `oauth` entries: the `auth:` block minus the client credentials. */
  oauth?: {
    provider: string
    mode: 'user' | 'space'
    authorizeUrl?: string
    tokenUrl?: string
    discover?: string
    scopes: readonly string[]
    /** Extra authorize params — Google's offline-access dance. */
    params?: Readonly<Record<string, string>>
    /**
     * `platform:<name>` — fall back to the deployment's own OAuth client when
     * the form's credential fields are left blank, making Connect zero-field.
     */
    clientId?: string
  }
  /** Markdown body: how an agent calls the service, with working example code. */
  body: string
}

const apiKey = (hint: string, placeholder = 'paste the key'): CatalogField => ({
  key: 'API_KEY',
  label: 'API key',
  placeholder,
  hint,
  secret: true,
  required: true,
})

const fetchSnippet = (lines: string[]) => ['```js', ...lines, '```'].join('\n')

export const CONNECTOR_CATALOG: readonly CatalogEntry[] = [
  // ── Email & calendar ───────────────────────────────────────────────────────
  {
    id: 'google',
    name: 'Google',
    description: 'Gmail, Calendar, Contacts',
    category: 'email',
    logo: 'google.svg',
    shape: 'oauth',
    hosts: ['gmail.googleapis.com', 'www.googleapis.com', 'people.googleapis.com'],
    oauth: {
      provider: 'google',
      mode: 'user',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/contacts.readonly',
      ],
      // Google issues a refresh token only when asked for offline access, and
      // re-issues one only under prompt=consent — one extra consent screen on
      // reconnect, against connections that otherwise die after an hour.
      params: { access_type: 'offline', prompt: 'consent' },
      clientId: 'platform:google',
    },
    fields: [
      { key: 'extra_scopes', label: 'Extra scopes', required: false,
        hint: 'Optional space-separated additional Google scopes, e.g. https://www.googleapis.com/auth/gmail.send. The defaults are read-only.' },
      { key: 'GOOGLE_CLIENT_ID', label: 'OAuth client ID', placeholder: '…apps.googleusercontent.com', required: false,
        hint: 'Optional — leave blank to use Visvine’s own Google app. To use your own: Google Cloud console → APIs & Services → Credentials → OAuth client (Web application), with this deployment’s /api/connectors/oauth/callback as an authorised redirect URI.' },
      { key: 'GOOGLE_CLIENT_SECRET', label: 'OAuth client secret', placeholder: 'GOCSPX-…', secret: true, required: false },
    ],
    body: [
      'Each member connects their own Google account from this connector’s page; Visvine then sends their bearer on every call to the hosts above.',
      '',
      fetchSnippet([
        "const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=newer_than:7d')",
        'return JSON.parse(res.body).messages',
      ]),
      '',
      'Calendar: `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=<ISO>`. Contacts: `https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses`.',
    ].join('\n'),
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Read and update the files and folders you pick',
    category: 'email',
    logo: 'googledrive.svg',
    shape: 'oauth',
    hosts: ['www.googleapis.com'],
    oauth: {
      provider: 'google-drive',
      mode: 'user',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      params: { access_type: 'offline', prompt: 'consent' },
      clientId: 'platform:google',
    },
    fields: [
      { key: 'GOOGLE_DRIVE_CLIENT_ID', label: 'OAuth client ID', placeholder: '…apps.googleusercontent.com', required: false,
        hint: 'Optional — leave blank to use Visvine’s own Google app. To use your own: Google Cloud console → APIs & Services → Credentials → OAuth client (Web application) with the Drive API enabled and this deployment’s /api/connectors/oauth/callback as an authorised redirect URI.' },
      { key: 'GOOGLE_DRIVE_CLIENT_SECRET', label: 'OAuth client secret', placeholder: 'GOCSPX-…', secret: true, required: false },
    ],
    body: [
      'Members connect their own Drive from this connector’s page. The `drive.file` scope reaches only files the person opened or created through Visvine.',
      '',
      fetchSnippet([
        "const res = await fetch('https://www.googleapis.com/drive/v3/files?pageSize=50&fields=files(id,name,mimeType,modifiedTime)')",
        'return JSON.parse(res.body).files',
      ]),
    ].join('\n'),
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    description: 'Outlook mail, Calendar and OneDrive files',
    category: 'email',
    logo: 'microsoft.svg',
    shape: 'oauth',
    hosts: ['graph.microsoft.com'],
    oauth: {
      provider: 'microsoft',
      mode: 'user',
      authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read', 'Files.Read'],
    },
    fields: [
      { key: 'MICROSOFT_CLIENT_ID', label: 'Application (client) ID', required: true,
        hint: 'Entra admin centre → App registrations → New registration (Web platform) with this space’s callback URL as the redirect URI.' },
      { key: 'MICROSOFT_CLIENT_SECRET', label: 'Client secret', secret: true, required: true },
    ],
    body: [
      'Members connect their own Microsoft account from this connector’s page. Everything goes through Microsoft Graph.',
      '',
      fetchSnippet([
        "const res = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=subject,from,receivedDateTime')",
        'return JSON.parse(res.body).value',
      ]),
      '',
      'Calendar: `/me/calendarview?startDateTime=…&endDateTime=…`. OneDrive: `/me/drive/root/children`.',
    ].join('\n'),
  },
  {
    id: 'resend',
    name: 'Resend',
    description: 'Send email from your own domain',
    category: 'email',
    logo: 'resend.svg',
    shape: 'key',
    hosts: ['api.resend.com'],
    fields: [apiKey('Resend dashboard → API Keys → Create API key.', 're_…')],
    body: [
      'Sends transactional email. The sending domain must be verified in Resend first.',
      '',
      fetchSnippet([
        "const res = await fetch('https://api.resend.com/emails', {",
        "  method: 'POST',",
        "  headers: { Authorization: `Bearer ${env.API_KEY}`, 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ from: 'Visvine <hello@yourdomain.com>', to: ['someone@example.com'], subject: 'Hi', text: 'Hello' }),",
        '})',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },

  // ── Meeting notes ──────────────────────────────────────────────────────────
  {
    id: 'granola',
    name: 'Granola',
    description: 'Pull in your meeting notes and transcripts',
    category: 'meetings',
    logo: 'granola.png',
    shape: 'key',
    hosts: ['public-api.granola.ai'],
    fields: [apiKey('Granola app → Settings → Connectors → API keys → Create new key. Business plan and up.', 'grn_…')],
    body: [
      'Granola only returns notes that already have an AI summary and transcript. Results are cursor-paginated.',
      '',
      fetchSnippet([
        "const res = await fetch('https://public-api.granola.ai/v1/notes?limit=50', {",
        '  headers: { Authorization: `Bearer ${env.API_KEY}` },',
        '})',
        'return JSON.parse(res.body)',
      ]),
      '',
      'Filter with `created_after=<ISO>` or `updated_after=<ISO>`; follow `next_cursor` with `cursor=` for the next page.',
    ].join('\n'),
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    description: 'Meeting transcripts and summaries from Fireflies.ai',
    category: 'meetings',
    logo: 'fireflies.png',
    shape: 'key',
    hosts: ['api.fireflies.ai'],
    fields: [apiKey('Fireflies → Settings → Connectors → Fireflies API → Get API Key.')],
    body: [
      'One GraphQL endpoint, POST `https://api.fireflies.ai/graphql`.',
      '',
      fetchSnippet([
        "const res = await fetch('https://api.fireflies.ai/graphql', {",
        "  method: 'POST',",
        "  headers: { Authorization: `Bearer ${env.API_KEY}`, 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ query: '{ transcripts(limit: 20) { id title date duration summary { overview } } }' }),",
        '})',
        'return JSON.parse(res.body).data.transcripts',
      ]),
    ].join('\n'),
  },

  // ── Messengers ─────────────────────────────────────────────────────────────
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read channels and post as a bot',
    category: 'messengers',
    logo: 'slack.svg',
    shape: 'key',
    hosts: ['slack.com'],
    fields: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot user OAuth token', placeholder: 'xoxb-…', secret: true, required: true,
        hint: 'api.slack.com/apps → your app → OAuth & Permissions → Bot User OAuth Token. Invite the bot to each channel it should see.' },
    ],
    body: [
      'Web API, bearer bot token. Slack wraps every response in `{ ok, … }` — check `ok` before reading.',
      '',
      fetchSnippet([
        "const res = await fetch('https://slack.com/api/conversations.history?channel=C0123456&limit=50', {",
        '  headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },',
        '})',
        'const data = JSON.parse(res.body)',
        'if (!data.ok) throw new Error(data.error)',
        'return data.messages',
      ]),
      '',
      'Post with `chat.postMessage` (`{ channel, text }` as JSON).',
    ].join('\n'),
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Read and post in your server as a bot',
    category: 'messengers',
    logo: 'discord.svg',
    shape: 'key',
    hosts: ['discord.com'],
    fields: [
      { key: 'DISCORD_BOT_TOKEN', label: 'Bot token', secret: true, required: true,
        hint: 'discord.com/developers → your application → Bot → Reset Token. Invite the bot to the server with the scopes it needs.' },
    ],
    body: [
      'REST API v10; the token goes in the header as `Bot <token>`, not `Bearer`.',
      '',
      fetchSnippet([
        "const res = await fetch('https://discord.com/api/v10/channels/<channel-id>/messages?limit=50', {",
        '  headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },',
        '})',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'A bot that reads and sends messages',
    category: 'messengers',
    logo: 'telegram.svg',
    shape: 'key',
    hosts: ['api.telegram.org'],
    fields: [
      { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', placeholder: '123456:ABC-…', secret: true, required: true,
        hint: 'Message @BotFather → /newbot. The token is part of every URL.' },
    ],
    body: [
      'The token is in the path, so every call is `https://api.telegram.org/bot<token>/<method>`.',
      '',
      fetchSnippet([
        'const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {',
        "  method: 'POST',",
        "  headers: { 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ chat_id: '<chat-id>', text: 'Hello' }),",
        '})',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Send messages through the WhatsApp Business API',
    category: 'messengers',
    logo: 'whatsapp.svg',
    shape: 'key',
    hosts: ['graph.facebook.com'],
    fields: [
      { key: 'WHATSAPP_TOKEN', label: 'Access token', secret: true, required: true,
        hint: 'Meta for Developers → your app → WhatsApp → API Setup. A permanent token comes from a System User.' },
      { key: 'WHATSAPP_PHONE_ID', label: 'Phone number ID', required: true, hint: 'Shown on the same API Setup page.' },
    ],
    body: [
      fetchSnippet([
        'const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`, {',
        "  method: 'POST',",
        "  headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ messaging_product: 'whatsapp', to: '<e164 number>', type: 'text', text: { body: 'Hello' } }),",
        '})',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },

  // ── Productivity ───────────────────────────────────────────────────────────
  {
    id: 'notion',
    name: 'Notion',
    description: 'Pages and databases the connector is shared with',
    category: 'productivity',
    logo: 'notion.svg',
    shape: 'key',
    hosts: ['api.notion.com'],
    fields: [
      { key: 'NOTION_TOKEN', label: 'Internal connector secret', placeholder: 'ntn_…', secret: true, required: true,
        hint: 'notion.so/profile/connectors → New connector → Internal. Then share each page or database with it.' },
    ],
    body: [
      'Every request needs a `Notion-Version` header. Search is the way in; the connector only sees what was shared with it.',
      '',
      fetchSnippet([
        "const res = await fetch('https://api.notion.com/v1/search', {",
        "  method: 'POST',",
        "  headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ query: 'roadmap', page_size: 20 }),",
        '})',
        'return JSON.parse(res.body).results',
      ]),
    ].join('\n'),
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Contacts, companies and deals',
    category: 'productivity',
    logo: 'hubspot.svg',
    shape: 'key',
    hosts: ['api.hubapi.com'],
    fields: [
      { key: 'HUBSPOT_TOKEN', label: 'Private app access token', placeholder: 'pat-…', secret: true, required: true,
        hint: 'HubSpot → Settings → Connectors → Private Apps → Create. Tick the CRM scopes you need.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=50&properties=firstname,lastname,email,company', {",
        '  headers: { Authorization: `Bearer ${env.HUBSPOT_TOKEN}` },',
        '})',
        'return JSON.parse(res.body).results',
      ]),
      '',
      'Same shape for `/crm/v3/objects/companies` and `/crm/v3/objects/deals`; search with POST `/crm/v3/objects/<type>/search`.',
    ].join('\n'),
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Read and write records in your bases',
    category: 'productivity',
    logo: 'airtable.svg',
    shape: 'key',
    hosts: ['api.airtable.com'],
    fields: [
      { key: 'AIRTABLE_TOKEN', label: 'Personal access token', placeholder: 'pat…', secret: true, required: true,
        hint: 'airtable.com/create/tokens → add the `data.records:read` scope (and `:write` if needed) and the bases it may see.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://api.airtable.com/v0/<base-id>/<table-name>?maxRecords=50', {",
        '  headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },',
        '})',
        'return JSON.parse(res.body).records',
      ]),
    ].join('\n'),
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Projects and tasks',
    category: 'productivity',
    logo: 'asana.svg',
    shape: 'key',
    hosts: ['app.asana.com'],
    fields: [
      { key: 'ASANA_TOKEN', label: 'Personal access token', secret: true, required: true,
        hint: 'Asana → My settings → Apps → Developer apps → Create personal access token.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://app.asana.com/api/1.0/tasks?project=<project-gid>&opt_fields=name,completed,assignee.name,due_on', {",
        '  headers: { Authorization: `Bearer ${env.ASANA_TOKEN}` },',
        '})',
        'return JSON.parse(res.body).data',
      ]),
    ].join('\n'),
  },
  {
    id: 'trello',
    name: 'Trello',
    description: 'Boards, lists and cards',
    category: 'productivity',
    logo: 'trello.svg',
    shape: 'key',
    hosts: ['api.trello.com'],
    fields: [
      { key: 'TRELLO_KEY', label: 'API key', required: true, hint: 'trello.com/power-ups/admin → your Power-Up → API key.' },
      { key: 'TRELLO_TOKEN', label: 'Token', secret: true, required: true, hint: 'The "Token" link beside the API key generates one for your account.' },
    ],
    body: [
      'Trello authenticates with both values as query parameters.',
      '',
      fetchSnippet([
        'const res = await fetch(`https://api.trello.com/1/boards/<board-id>/cards?key=${env.TRELLO_KEY}&token=${env.TRELLO_TOKEN}`)',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Tasks and projects',
    category: 'productivity',
    logo: 'todoist.svg',
    shape: 'key',
    hosts: ['api.todoist.com'],
    fields: [
      { key: 'TODOIST_TOKEN', label: 'API token', secret: true, required: true, hint: 'Todoist → Settings → Connectors → Developer → API token.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://api.todoist.com/rest/v2/tasks', {",
        '  headers: { Authorization: `Bearer ${env.TODOIST_TOKEN}` },',
        '})',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Tasks across your workspace',
    category: 'productivity',
    logo: 'clickup.svg',
    shape: 'key',
    hosts: ['api.clickup.com'],
    fields: [
      { key: 'CLICKUP_TOKEN', label: 'Personal API token', placeholder: 'pk_…', secret: true, required: true,
        hint: 'ClickUp → Settings → Apps → API Token → Generate.' },
    ],
    body: [
      'ClickUp takes the token bare in `Authorization`, without `Bearer`.',
      '',
      fetchSnippet([
        "const res = await fetch('https://api.clickup.com/api/v2/list/<list-id>/task', {",
        '  headers: { Authorization: env.CLICKUP_TOKEN },',
        '})',
        'return JSON.parse(res.body).tasks',
      ]),
    ].join('\n'),
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Scheduled events and invitees',
    category: 'productivity',
    logo: 'calendly.svg',
    shape: 'key',
    hosts: ['api.calendly.com'],
    fields: [
      { key: 'CALENDLY_TOKEN', label: 'Personal access token', secret: true, required: true,
        hint: 'Calendly → Connectors & apps → API & webhooks → Generate new token.' },
    ],
    body: [
      'Start with `/users/me` to learn your user URI — most list endpoints require it.',
      '',
      fetchSnippet([
        "const me = JSON.parse((await fetch('https://api.calendly.com/users/me', { headers: { Authorization: `Bearer ${env.CALENDLY_TOKEN}` } })).body).resource",
        'const res = await fetch(`https://api.calendly.com/scheduled_events?user=${encodeURIComponent(me.uri)}&count=50`, {',
        '  headers: { Authorization: `Bearer ${env.CALENDLY_TOKEN}` },',
        '})',
        'return JSON.parse(res.body).collection',
      ]),
    ].join('\n'),
  },
  {
    id: 'intercom',
    name: 'Intercom',
    description: 'Conversations and contacts',
    category: 'productivity',
    logo: 'intercom.svg',
    shape: 'key',
    hosts: ['api.intercom.io'],
    fields: [
      { key: 'INTERCOM_TOKEN', label: 'Access token', secret: true, required: true,
        hint: 'Intercom Developer Hub → your app → Authentication → Access token.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://api.intercom.io/conversations?per_page=50', {",
        "  headers: { Authorization: `Bearer ${env.INTERCOM_TOKEN}`, 'Intercom-Version': '2.11', Accept: 'application/json' },",
        '})',
        'return JSON.parse(res.body).conversations',
      ]),
    ].join('\n'),
  },
  {
    id: 'zendesk',
    name: 'Zendesk',
    description: 'Support tickets',
    category: 'productivity',
    logo: 'zendesk.svg',
    shape: 'key',
    hosts: [],
    fields: [
      { key: 'ZENDESK_SUBDOMAIN', label: 'Subdomain', placeholder: 'acme', required: true, hint: 'The part before .zendesk.com.' },
      { key: 'ZENDESK_EMAIL', label: 'Agent email', required: true },
      { key: 'ZENDESK_TOKEN', label: 'API token', secret: true, required: true, hint: 'Admin Center → Apps and connectors → APIs → Zendesk API → Add API token.' },
    ],
    body: [
      'Token auth is HTTP basic with `email/token` as the user.',
      '',
      fetchSnippet([
        'const auth = await visvine.crypto.base64.encode(`${env.ZENDESK_EMAIL}/token:${env.ZENDESK_TOKEN}`)',
        'const res = await fetch(`https://${env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets.json?sort_by=updated_at&sort_order=desc`, {',
        '  headers: { Authorization: `Basic ${auth}` },',
        '})',
        'return JSON.parse(res.body).tickets',
      ]),
    ].join('\n'),
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Files, comments and components',
    category: 'productivity',
    logo: 'figma.svg',
    shape: 'key',
    hosts: ['api.figma.com'],
    fields: [
      { key: 'FIGMA_TOKEN', label: 'Personal access token', placeholder: 'figd_…', secret: true, required: true,
        hint: 'Figma → Settings → Security → Personal access tokens.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://api.figma.com/v1/files/<file-key>?depth=1', {",
        "  headers: { 'X-Figma-Token': env.FIGMA_TOKEN },",
        '})',
        'return JSON.parse(res.body).document.children',
      ]),
    ].join('\n'),
  },

  // ── Development tools ──────────────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, issues and pull requests',
    category: 'development',
    logo: 'github.svg',
    shape: 'key',
    hosts: ['api.github.com'],
    fields: [
      { key: 'GITHUB_TOKEN', label: 'Personal access token', placeholder: 'github_pat_…', secret: true, required: true,
        hint: 'github.com/settings/tokens → Fine-grained token, scoped to the repositories it should see.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://api.github.com/repos/<owner>/<repo>/issues?state=open&per_page=50', {",
        "  headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },",
        '})',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Projects, issues and merge requests',
    category: 'development',
    logo: 'gitlab.svg',
    shape: 'key',
    hosts: ['gitlab.com'],
    fields: [
      { key: 'GITLAB_TOKEN', label: 'Personal access token', placeholder: 'glpat-…', secret: true, required: true,
        hint: 'GitLab → User settings → Access tokens, with the `read_api` scope.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://gitlab.com/api/v4/projects/<id>/merge_requests?state=opened', {",
        "  headers: { 'PRIVATE-TOKEN': env.GITLAB_TOKEN },",
        '})',
        'return JSON.parse(res.body)',
      ]),
    ].join('\n'),
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects and cycles',
    category: 'development',
    logo: 'linear.svg',
    shape: 'key',
    hosts: ['api.linear.app'],
    fields: [
      { key: 'LINEAR_API_KEY', label: 'API key', placeholder: 'lin_api_…', secret: true, required: true,
        hint: 'Linear → Settings → Security & access → Personal API keys.' },
    ],
    body: [
      'GraphQL only; the key goes in `Authorization` bare, without `Bearer`.',
      '',
      fetchSnippet([
        "const res = await fetch('https://api.linear.app/graphql', {",
        "  method: 'POST',",
        "  headers: { Authorization: env.LINEAR_API_KEY, 'Content-Type': 'application/json' },",
        "  body: JSON.stringify({ query: '{ issues(first: 50, filter: { state: { type: { neq: \"completed\" } } }) { nodes { identifier title assignee { name } } } }' }),",
        '})',
        'return JSON.parse(res.body).data.issues.nodes',
      ]),
    ].join('\n'),
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Issues in Jira Cloud',
    category: 'development',
    logo: 'jira.svg',
    shape: 'key',
    hosts: [],
    fields: [
      { key: 'JIRA_SITE', label: 'Site', placeholder: 'acme.atlassian.net', required: true },
      { key: 'JIRA_EMAIL', label: 'Account email', required: true },
      { key: 'JIRA_TOKEN', label: 'API token', secret: true, required: true, hint: 'id.atlassian.com/manage-profile/security/api-tokens → Create API token.' },
    ],
    body: [
      'Jira Cloud uses HTTP basic auth with your email and an API token.',
      '',
      fetchSnippet([
        'const auth = await visvine.crypto.base64.encode(`${env.JIRA_EMAIL}:${env.JIRA_TOKEN}`)',
        'const res = await fetch(`https://${env.JIRA_SITE}/rest/api/3/search?jql=${encodeURIComponent(\'assignee = currentUser() AND resolution = Unresolved\')}&maxResults=50`, {',
        '  headers: { Authorization: `Basic ${auth}` },',
        '})',
        'return JSON.parse(res.body).issues',
      ]),
    ].join('\n'),
  },

  // ── LLM keys ───────────────────────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Run this space’s agents on OpenAI models',
    category: 'llm',
    logo: 'openai.svg',
    shape: 'model',
    provider: 'openai',
    hosts: [],
    fields: [{ key: 'MODEL_KEY_OPENAI', label: 'API key', placeholder: 'sk-…', secret: true, required: true, hint: 'platform.openai.com → API keys.' }],
    body: '',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Run this space’s agents on Claude',
    category: 'llm',
    logo: 'anthropic.svg',
    shape: 'model',
    provider: 'anthropic',
    hosts: [],
    fields: [{ key: 'MODEL_KEY_ANTHROPIC', label: 'API key', placeholder: 'sk-ant-…', secret: true, required: true, hint: 'console.anthropic.com → API keys.' }],
    body: '',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Run this space’s agents on Gemini',
    category: 'llm',
    logo: 'googlegemini.svg',
    shape: 'model',
    provider: 'gemini',
    hosts: [],
    fields: [{ key: 'MODEL_KEY_GEMINI', label: 'API key', placeholder: 'AIza…', secret: true, required: true, hint: 'aistudio.google.com → Get API key.' }],
    body: '',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'One key, hundreds of models from every vendor',
    category: 'llm',
    logo: 'openrouter.svg',
    shape: 'model',
    provider: 'openrouter',
    hosts: [],
    fields: [{ key: 'MODEL_KEY_OPENROUTER', label: 'API key', placeholder: 'sk-or-v1-…', secret: true, required: true, hint: 'openrouter.ai/keys → Create key.' }],
    body: '',
  },
  {
    id: 'custom-model',
    name: 'OpenAI-compatible endpoint',
    description: 'Any provider speaking the OpenAI chat API',
    category: 'llm',
    logo: 'modelcontextprotocol.svg',
    shape: 'model',
    provider: 'custom',
    hosts: [],
    fields: [
      { key: 'base_url', label: 'Base URL', placeholder: 'https://llm.example.com/v1/', required: true, hint: 'An https endpoint; no query or fragment.' },
      { key: 'MODEL_KEY_CUSTOM', label: 'API key', secret: true, required: true },
    ],
    body: '',
  },

  // ── Data ───────────────────────────────────────────────────────────────────
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Customers, payments and subscriptions',
    category: 'data',
    logo: 'stripe.svg',
    shape: 'key',
    hosts: ['api.stripe.com'],
    fields: [
      { key: 'STRIPE_KEY', label: 'Restricted API key', placeholder: 'rk_live_…', secret: true, required: true,
        hint: 'dashboard.stripe.com/apikeys → Create restricted key, read-only on what the agents need.' },
    ],
    body: [
      fetchSnippet([
        "const res = await fetch('https://api.stripe.com/v1/customers?limit=50', {",
        '  headers: { Authorization: `Bearer ${env.STRIPE_KEY}` },',
        '})',
        'return JSON.parse(res.body).data',
      ]),
    ].join('\n'),
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Read-only queries against your own database',
    category: 'data',
    logo: 'postgresql.svg',
    shape: 'key',
    hosts: [],
    fields: [
      { key: 'host', label: 'Host', placeholder: 'db.example.com:5432', required: true, hint: 'Must be publicly routable; private networks are refused.' },
      { key: 'PG_DSN', label: 'Connection string', placeholder: 'postgres://user:pass@db.example.com:5432/app', secret: true, required: true,
        hint: 'A read-only role. Every query runs as a single SELECT in a READ ONLY transaction.' },
    ],
    body: [
      fetchSnippet([
        "const rows = await sql(env.PG_DSN, 'SELECT id, name, created_at FROM customers ORDER BY created_at DESC LIMIT 50')",
        'return rows',
      ]),
    ].join('\n'),
  },
  {
    id: 'mysql',
    name: 'MySQL',
    description: 'Read-only queries against your own database',
    category: 'data',
    logo: 'mysql.svg',
    shape: 'key',
    hosts: [],
    fields: [
      { key: 'host', label: 'Host', placeholder: 'db.example.com:3306', required: true, hint: 'Must be publicly routable; private networks are refused.' },
      { key: 'MYSQL_DSN', label: 'Connection string', placeholder: 'mysql://user:pass@db.example.com:3306/app', secret: true, required: true,
        hint: 'A read-only user. Every query runs as a single SELECT.' },
    ],
    body: [
      fetchSnippet([
        "const rows = await sql(env.MYSQL_DSN, 'SELECT id, name FROM customers LIMIT 50')",
        'return rows',
      ]),
    ].join('\n'),
  },

  // ── Other ──────────────────────────────────────────────────────────────────
  {
    id: 'mcp',
    name: 'MCP server',
    description: 'Any remote MCP server, by URL',
    category: 'other',
    logo: 'modelcontextprotocol.svg',
    shape: 'oauth',
    hosts: [],
    oauth: { provider: '', mode: 'user', scopes: [] },
    fields: [
      { key: 'url', label: 'Server URL', placeholder: 'https://mcp.notion.com/mcp', required: true,
        hint: 'Visvine reads the server’s OAuth metadata and registers itself at first connect — no developer account needed where the server supports it.' },
    ],
    body: [
      'Members connect their account from this connector’s page; the bearer is sent on every call to the server.',
      '',
      fetchSnippet([
        "const client = mcp('<server url>')",
        'const tools = await client.listTools()',
        'return tools',
      ]),
    ].join('\n'),
  },
]

/**
 * The service a connection came from — read for display (its logo, the service
 * line under a connection's name) and to group a space's connections by what
 * they reach.
 *
 * A space may hold SEVERAL connections to one service — two Drives, two Slack
 * workspaces — so the note name cannot be the answer: only the first of them is
 * called `google-drive`. The note carries `recipe:` in its frontmatter, written
 * by {@link connectorFromCatalog}, and that is consulted first. The name, and
 * then the model provider, remain the fallbacks, so a connection written before
 * `recipe:` existed — or by hand — still finds its mark.
 *
 * It stays display-only. A wrong or missing answer costs a plug icon and a row
 * listed on its own; no perimeter, key or permission is read from it.
 */
export function catalogEntryFor(name: string, provider?: string | null, recipe?: string | null): CatalogEntry | null {
  if (recipe) {
    const byRecipe = CONNECTOR_CATALOG.find((e) => e.id === recipe.trim().toLowerCase())
    if (byRecipe) return byRecipe
  }
  const slug = name.trim().toLowerCase()
  const byId = CONNECTOR_CATALOG.find((e) => e.id === slug)
  if (byId) return byId
  if (!provider) return null
  const key = provider.trim().toLowerCase()
  return CONNECTOR_CATALOG.find((e) => e.shape === 'model' && e.provider === key) ?? null
}

/**
 * May the space add ANOTHER connection to this service?
 *
 * For an HTTP or OAuth service, always: a connection is one set of credentials,
 * and two Drives (yours and the team's) or two Slack workspaces are ordinary.
 * For a model provider, no — and not as a policy. Its key is
 * `MODEL_KEY_<PROVIDER>`, one row per space by construction, and a registry
 * provider's endpoint is pinned in code, so a second note would name the same
 * key and the same URL and differ only in its title. `custom` is the same story
 * from the other end: agents resolve ONE custom endpoint per space
 * (lib/agents/providers.ts#findCustomModelEndpoint), so a second URL is a
 * configuration error rather than a second choice.
 */
export function allowsManyConnectors(entry: CatalogEntry): boolean {
  return entry.shape !== 'model'
}

/**
 * What to call the next connector to a service, given the names the space has
 * already used: `google-drive` then `google-drive-2`, titled "Google Drive"
 * then "Google Drive 2". Pure, so the form opens on the note it is about to
 * write; the title is the admin's to change, and the name follows it.
 */
export function suggestConnector(entry: CatalogEntry, taken: readonly string[]): { name: string; title: string } {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()))
  if (!used.has(entry.id)) return { name: entry.id, title: entry.name }
  for (let i = 2; ; i += 1) {
    const name = `${entry.id}-${i}`
    if (!used.has(name)) return { name, title: `${entry.name} ${i}` }
  }
}

/** Entries matching a search by name, description or category; all of them when empty. */
export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...CONNECTOR_CATALOG]
  return CONNECTOR_CATALOG.filter(
    (e) =>
      e.name.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.id.includes(q) ||
      categoryLabel(e.category).toLowerCase().includes(q),
  )
}

function categoryLabel(category: CatalogCategory): string {
  return CATALOG_CATEGORIES.find((c) => c.id === category)?.label ?? category
}

const yamlStr = (s: string) => JSON.stringify(s)
const yamlList = (key: string, items: readonly string[], indent = '') =>
  items.length > 0 ? `${indent}${key}:\n${items.map((i) => `${indent}  - ${i}`).join('\n')}` : `${indent}${key}: []`

/**
 * Turn a picked entry plus its filled-in form into the note to write and the
 * secrets to store. Secret-flagged fields never appear in the note — they are
 * referenced as `{{secret:NAME}}` and bound via `env:`; plain fields are
 * substituted into the frontmatter where the entry reads them and otherwise
 * bound as plain `env:` values an agent can read.
 */
export function connectorFromCatalog(
  entry: CatalogEntry,
  input: { name: string; title: string; description: string; values: Record<string, string> },
): { content: string; secrets: Array<{ name: string; value: string }> } {
  const v = (key: string) => (input.values[key] ?? '').trim()
  const description = input.description.trim() || entry.description

  if (entry.shape === 'model') {
    // A model provider's key is reserved and shared by design — one
    // MODEL_KEY_<PROVIDER> per space — which is the same fact that makes it a
    // one-connector service (allowsManyConnectors).
    return {
      content: newModelConnectorNote({
        name: input.name,
        provider: entry.provider ?? 'custom',
        baseUrl: v('base_url'),
        description,
        recipe: entry.id,
      }),
      secrets: entry.fields.filter((f) => f.secret && v(f.key)).map((f) => ({ name: f.key, value: v(f.key) })),
    }
  }

  // A second connector to a service gets its OWN secrets. The names are the
  // space's namespace, not the note's, so two Slack workspaces both writing
  // SLACK_BOT_TOKEN would leave the first one running on the second's token —
  // silently, since the note still parses. The suffix is the connector's name,
  // which is unique by construction, so `slack-2` binds SLACK_BOT_TOKEN__SLACK_2.
  const suffix = input.name === entry.id ? '' : `__${input.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
  const secretName = (key: string) => `${key}${suffix}`
  const secrets = entry.fields
    .filter((f) => f.secret && v(f.key))
    .map((f) => ({ name: secretName(f.key), value: v(f.key) }))

  const hosts = [...entry.hosts]
  if (v('host')) hosts.push(v('host').toLowerCase())
  if (v('url')) {
    try {
      hosts.push(new URL(v('url')).host.toLowerCase())
    } catch {
      /* the form already refused a bad URL */
    }
  }
  // Jira/Zendesk-style: the host is assembled from a plain field.
  if (v('JIRA_SITE')) hosts.push(v('JIRA_SITE').toLowerCase())
  if (v('ZENDESK_SUBDOMAIN')) hosts.push(`${v('ZENDESK_SUBDOMAIN').toLowerCase()}.zendesk.com`)

  const envLines = entry.fields
    .filter((f) => f.key !== 'host' && f.key !== 'url' && !/^[a-z]/.test(f.key) && v(f.key))
    .map((f) => (f.secret ? `  ${f.key}: "{{secret:${secretName(f.key)}}}"` : `  ${f.key}: ${yamlStr(v(f.key))}`))

  // `recipe:` says which service this connection is to. It is what lets a space
  // hold two of one service — the second is `google-drive-2`, and only this
  // says it is still a Drive (catalogEntryFor). Display only.
  const front = [
    `type: connector`,
    `recipe: ${entry.id}`,
    `title: ${yamlStr(input.title.trim() || entry.name)}`,
    `description: ${yamlStr(description)}`,
  ]
  front.push(yamlList('hosts', Array.from(new Set(hosts))))
  if (envLines.length > 0) front.push(`env:\n${envLines.join('\n')}`)
  front.push(`timeout_ms: ${SANDBOX_LIMITS.timeoutMs.default}`)

  if (entry.oauth) {
    const o = entry.oauth
    // The OAuth provider is the CONNECTOR's name, not the recipe's: linked
    // accounts key on (space, provider, member) — ConnectorConnection — so two
    // Drives sharing a provider would share one linked account each, which is
    // the opposite of why a space connects a service twice.
    const provider = input.name
    const clientId = entry.fields.find((f) => /CLIENT_ID$/.test(f.key) && !f.secret)
    const clientSecret = entry.fields.find((f) => /CLIENT_SECRET$/.test(f.key))
    const ownClient = Boolean(clientId && v(clientId.key))
    const auth = [`auth:`, `  provider: ${provider}`, `  mode: ${o.mode}`]
    if (o.discover) auth.push(`  discover: ${o.discover}`)
    else if (v('url')) auth.push(`  discover: ${v('url')}`)
    else if (o.authorizeUrl && o.tokenUrl) auth.push(`  authorize_url: ${o.authorizeUrl}`, `  token_url: ${o.tokenUrl}`)
    if (ownClient && clientId) auth.push(`  client_id: ${yamlStr(v(clientId.key))}`)
    // Blank credential fields fall back to the deployment's own OAuth client,
    // which is what makes Connect zero-field for Google.
    else if (o.clientId) auth.push(`  client_id: ${o.clientId}`)
    // Only alongside an own client id, and only with a value — an empty field
    // must not leave a dangling {{secret:…}} nothing ever stored.
    if (ownClient && clientSecret && v(clientSecret.key)) auth.push(`  client_secret: "{{secret:${secretName(clientSecret.key)}}}"`)
    const scopes = [...o.scopes, ...v('extra_scopes').split(/\s+/).filter(Boolean)]
    if (scopes.length > 0) auth.push(yamlList('scopes', scopes, '  '))
    if (o.params && Object.keys(o.params).length > 0) {
      auth.push('  params:', ...Object.entries(o.params).map(([k, val]) => `    ${k}: ${yamlStr(val)}`))
    }
    auth.push(yamlList('hosts', Array.from(new Set(hosts)), '  '))
    front.push(auth.join('\n'))
  }

  const body = entry.body.replace(/<server url>/g, v('url') || '<server url>')
  const content = ['---', ...front, '---', '', description, '', body, ''].join('\n')
  return { content, secrets }
}
