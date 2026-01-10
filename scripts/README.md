# Gylde Development Scripts

Scripts for seeding and managing development data.

## Setup

```bash
cd scripts
npm install
```

## Seed Data

Populate the Firebase emulators with sample users:

```bash
# Make sure the Firebase emulator is running first!
npm run seed
```

Clear existing data and re-seed:

```bash
npm run seed:clear
```

## Test Login Credentials

All passwords: `password123`

| Email | Name | City |
|-------|------|------|
| emma@test.com | Emma Wilson | Ann Arbor |
| james@test.com | James Chen | Detroit |
| sofia@test.com | Sofia Martinez | Ypsilanti |
| michael@test.com | Michael Thompson | Royal Oak |
| olivia@test.com | Olivia Johnson | Birmingham |
| david@test.com | David Williams | Troy |
| ava@test.com | Ava Brown | Ferndale |
| sarah@test.com | Sarah Davis | Plymouth |

## What Gets Seeded

### Firebase Auth
- 8 test users with email/password login

### Firestore
- 8 complete user profiles with:
  - Different locations around Southeast Michigan
  - Various gender identities and preferences
  - Different connection types and support orientations
  - Unique bios and values
  - Placeholder profile photos from Unsplash

## Adding More Seed Data

1. Edit `seed-data/users.ts` to add or modify user profiles
2. Create new files in `seed-data/` for other data types (e.g., `favorites.ts`, `activities.ts`)
3. Import and call them from `seed.ts`
