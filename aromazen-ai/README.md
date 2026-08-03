# AROMAZEN AI - Enterprise AI Platform PWA

A premium internal AI workspace for fragrance and cosmetic manufacturing companies, built as a Progressive Web App (PWA) with Next.js 16, TypeScript, and Tailwind CSS.

## Features

- **Premium Dark-Mode Design**: Sophisticated charcoal background with warm amber/gold accents
- **Progressive Web App**: Fully installable on desktop and mobile with offline support
- **Enterprise AI Workspace**: Chat-based interface with source citations and document management
- **Knowledge Management**: Multi-collection document organization with indexed search
- **Analytics Dashboard**: Real-time usage tracking and cost monitoring
- **User Management**: Role-based access control with department-level permissions
- **Settings & Configuration**: Organization branding and security controls
- **Responsive Design**: Mobile-first approach, optimized for all screen sizes

## Quick Start

### Prerequisites
- Node.js 18+ 
- pnpm (recommended) or npm

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Open browser
# Navigate to http://localhost:3000
```

### Default Credentials
- **Email**: pranav@aromazen.com
- **Password**: demo

## Project Structure

```
/app
  ├── page.tsx                    # Redirects to login
  ├── layout.tsx                  # Root layout with PWA setup
  ├── login/                      # Login page
  ├── dashboard/                  # Dashboard with analytics
  ├── workspace/                  # AI chat workspace
  ├── knowledge/                  # Knowledge base and collections
  ├── admin/
  │   ├── users/                  # User management
  │   ├── access/                 # Role & permissions
  │   └── usage/                  # Analytics & usage
  └── settings/                   # Organization settings

/components
  ├── layouts/                    # Main app layout components
  │   ├── app-layout.tsx
  │   ├── sidebar.tsx
  │   └── top-bar.tsx
  ├── ui/                         # Reusable UI components
  │   ├── button.tsx
  │   ├── metric-card.tsx
  │   ├── status-badge.tsx
  │   ├── data-table.tsx
  │   └── page-header.tsx
  └── workspace/                  # Chat components
      ├── chat-message.tsx
      ├── chat-composer.tsx
      └── prompt-suggestions.tsx

/lib
  ├── mock-data.ts                # Mock data (replace with API)
  └── utils.ts                    # Utility functions

/public
  ├── manifest.json               # PWA manifest
  ├── sw.js                        # Service worker
  ├── icon-192.png                # App icon (192x192)
  ├── icon-512.png                # App icon (512x512)
  └── icon.svg                    # Favicon

```

## PWA Features

### Installation
The app can be installed as a PWA on:
- **Desktop**: Chrome, Edge (via "Install app" option in address bar)
- **Mobile iOS**: Safari (via "Add to Home Screen")
- **Mobile Android**: Chrome (via "Install app" option in menu)

### Offline Support
- Service Worker caches routes and assets
- Offline pages fallback to login page
- Automatic cache updates on subsequent visits

### Manifest Configuration
- App name: AROMAZEN AI
- Display: Standalone (full-screen app experience)
- Theme color: Dark charcoal (#1c1c1c)
- Icons: 192x192 and 512x512 PNG assets

## Design System

### Color Palette
- **Background**: Near-black charcoal (#1c1c1c)
- **Surface**: Dark slate (#1a1a1a to #222222)
- **Accent**: Warm amber/gold (#a8704f with 65% lightness)
- **Text**: Soft white (#f5f5f5) and muted grey (#b0b0b0)

### Typography
- **Font Stack**: System fonts (system-ui, Segoe UI, Roboto)
- **Headings**: Semibold/Bold weights, 1.2-3rem sizes
- **Body**: 14-16px regular weight, 1.5 line-height

### Spacing
- **Grid**: 4px base unit
- **Gaps**: 4px, 8px, 12px, 16px, 24px, 32px
- **Padding/Margin**: Multiples of 4px

## API Integration

Currently uses mock data from `/lib/mock-data.ts`. To connect to a real backend:

1. Create API client functions in `/lib/api/`
2. Replace mock data imports with API calls
3. Handle loading and error states
4. Update component prop types as needed

Example API route structure:
```
GET  /api/dashboard          # Dashboard metrics
GET  /api/chats              # Chat history
POST /api/chats              # Create new chat
GET  /api/documents          # Document list
POST /api/documents/upload   # Upload document
GET  /api/users              # User management
```

## Building for Production

```bash
# Build optimized production bundle
pnpm build

# Start production server
pnpm start

# Deploy to Vercel (recommended)
vercel deploy
```

## Security Headers

The app includes secure headers:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=63072000`
- `X-Frame-Options: SAMEORIGIN`

## Browser Support

- Chrome/Edge: Latest 2 versions
- Safari: Latest 2 versions (iOS 12+)
- Firefox: Latest 2 versions

## Performance

- **Lighthouse Score Target**: 90+
- **LCP**: < 2.5s
- **INP**: < 100ms
- **CLS**: < 0.1

## Development Notes

### Adding New Pages
1. Create route in `/app/[route]/page.tsx`
2. Wrap with `<AppLayout>` for sidebar/header
3. Use mock data from `/lib/mock-data.ts`
4. Follow component patterns in existing pages

### Styling
- Uses Tailwind CSS with custom design tokens
- Dark mode always active (`class="dark"` on `<html>`)
- Design tokens defined in `/app/globals.css`

### Component Reusability
- UI components in `/components/ui/` are fully reusable
- Pass data via props (no context/state management yet)
- Use TypeScript interfaces for type safety

## Future Enhancements

- [ ] Real backend API integration
- [ ] Authentication system (email/password + OAuth)
- [ ] Real-time chat with WebSockets
- [ ] File upload and processing
- [ ] Advanced search and filtering
- [ ] User preferences and customization
- [ ] Dark/Light theme toggle
- [ ] Mobile app native features

## License

Proprietary - AROMAZEN Internal Use Only

## Support

For issues or questions about the platform, contact the AI Labs team.
