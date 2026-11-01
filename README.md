# PPR Field Vaccination Monitoring

An open-source web-based platform for monitoring Peste des Petits Ruminants (PPR) vaccination activities at dispensary and district level.

The project supports departmental field monitoring across an operational area covering **154 villages**. This describes the reported operational area, not a claim that every village has completed vaccination.

## Why this project exists

Veterinary vaccination programmes generate information across villages, vaccinators, daily activities and source records. This application brings relevant information into a central dashboard so authorised departmental personnel can review progress, identify gaps, manage field information and prepare reports.

## Features

Based on the current source code, the application includes:

- Public-facing PPR vaccination progress dashboard.
- Programme progress summaries and vaccination statistics.
- Village-wise, vaccinator-wise and historical progress views.
- Daily vaccination reporting and downloadable reports.
- Vaccination request workflow.
- Administrative area for programme settings and data management.
- Import and validation of vaccination records.
- Allocation, village assignment and duty-roster functionality.
- Authentication and role-aware access controls.
- Convex backend for application data and server-side operations.

The current repository contains PPR-specific implementation. FMD functionality should be documented separately if maintained in another deployment or repository.

## Technology stack

- React 19 and TypeScript
- Vite
- React Router
- Tailwind CSS 4 and shadcn/ui
- Convex
- Convex Auth
- Recharts
- Framer Motion
- ExcelJS and XLSX utilities

## Project structure

```text
src/
  components/
  convex/
  hooks/
  lib/
  pages/
```

## Local development

### Requirements

- Node.js
- npm
- A Convex project and environment configuration

### Installation

Clone the repository:

```bash
git clone https://github.com/neonflicker/ppr-monitor.git
cd ppr-monitor
```

Install dependencies:

```bash
npm install
```

Configure your own Convex environment using `.env.example` as a reference.

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Security and privacy

- Never commit credentials, private keys, tokens or production environment files.
- Use deployment-specific secrets.
- Use anonymised or synthetic data for development and testing.
- Protect administrative operations and production data.
- Rotate any exposed credentials immediately.

See [SECURITY.md](SECURITY.md).

## Contributing

Bug reports, documentation improvements, testing and code contributions are welcome.

Please read [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT License. See [LICENSE](LICENSE).

## Maintainer

Maintained by [@neonflicker](https://github.com/neonflicker).

This is an independent software initiative developed to support practical veterinary field administration and vaccination programme monitoring. Departmental use does not imply official government endorsement.
