# Visvine Mobile

React Native mobile app for Visvine community platform, built with Expo.

## Features

- **Messaging** - Real-time conversations with community members
- **Events** - Browse and RSVP to community events
- **Directory** - Grid view of community members with filtering
- **Profile** - View and edit your profile information

## Tech Stack

- **Expo SDK 53** - React Native framework
- **React Navigation** - Tab and stack navigation
- **TypeScript** - Type safety
- **Shared Packages** - Uses monorepo packages for shared types

## Project Structure

```
apps/mobile/
├── App.tsx                    # App entry point with providers
├── app.json                   # Expo configuration
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
├── src/
│   ├── components/            # Shared UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Loading.tsx
│   │   └── EmptyState.tsx
│   ├── contexts/              # React contexts
│   │   ├── AuthContext.tsx    # Authentication state
│   │   └── CommunityContext.tsx # Community selection
│   ├── hooks/                 # Custom hooks
│   │   └── useApi.ts          # API request hooks
│   ├── navigation/            # Navigation setup
│   │   ├── AppNavigator.tsx   # Root navigator
│   │   ├── TabNavigator.tsx   # Bottom tab navigation
│   │   ├── MessagesStack.tsx  # Messages flow
│   │   ├── EventsStack.tsx   # Events flow
│   │   └── ProfileStack.tsx   # Profile flow
│   ├── screens/               # Screen components
│   │   ├── Auth/
│   │   │   └── LoginScreen.tsx
│   │   ├── Messaging/
│   │   │   ├── ConversationsListScreen.tsx
│   │   │   └── ConversationScreen.tsx
│   │   ├── Events/
│   │   │   ├── EventsListScreen.tsx
│   │   │   └── EventDetailScreen.tsx
│   │   ├── Directory/
│   │   │   └── DirectoryScreen.tsx
│   │   └── Profile/
│   │       ├── ProfileScreen.tsx
│   │       └── EditProfileScreen.tsx
│   ├── services/              # API services
│   │   └── api.ts             # Centralized API client
│   ├── theme/                 # Theme and styling
│   │   ├── colors.ts          # Visvine brand colors
│   │   └── index.ts
│   └── types/                 # TypeScript types
│       └── index.ts           # Mobile-specific types
└── .env.example               # Environment template
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Expo CLI

### Installation

```bash
# From monorepo root
pnpm install
```

### Development

```bash
# Start Expo dev server
pnpm mobile:dev

# Or from this directory
pnpm start

# Platform-specific
pnpm mobile:android
pnpm mobile:ios
```

### Environment Setup

1. Copy `.env.example` to `.env`
2. Set `EXPO_PUBLIC_API_URL` to your backend URL

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

## API Integration

The app connects to the Visvine monolith backend. API calls are centralized in `src/services/api.ts`.

### Authentication

Currently uses session-based auth via the web backend. OAuth integration (Google) is planned.

### Communities

Users can switch between communities via the Directory screen's community picker.

## Navigation

- **Bottom Tabs**: Messages, Events, Directory, Profile
- **Stack Navigators**: Each tab has its own stack for detail screens

## Brand Colors

```typescript
brand: {
  green: '#78d870',
  darkGreen: '#2f7a3e',
  black: '#111827',
  grey: '#6B7280',
  white: '#F9FAFB',
  lightBg: '#eaf9ec',
  bg: '#F5F7F5',
}
```

## Adding New Features

1. Create screen in appropriate `src/screens/` subfolder
2. Add navigation types to stack param lists
3. Update navigator file to include new screen
4. Add API methods to `src/services/api.ts` as needed

## Shared Packages

The app uses monorepo shared packages:

- `@visvine/types` - Type definitions

## Future Enhancements

- [ ] Push notifications
- [ ] Real-time messaging (WebSocket)
- [ ] Offline support
- [ ] Image upload for profile
- [ ] Deep linking
- [ ] Biometric auth