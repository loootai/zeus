# Zeus GTM OS starter

Your own private copy of your Zeus results: target accounts, buying committees, people, plays and rivals,
read from your own Supabase project. Read only. Only the owner email can sign in (Supabase Auth email link).

## Deploy

1. Press **Deploy to Vercel** on your Zeus page ("Take it to the next step"). Vercel clones this folder into
   your Git account, asks you to add the Supabase integration (it creates the project and sets `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and asks for `ZEUS_OWNER_EMAIL`: your email.
2. In Supabase, Authentication, URL Configuration: set Site URL to your Vercel URL and add
   `https://<your-app>.vercel.app/auth/callback` to Redirect URLs.
3. Apply the tables: paste `supabase/migrations/20261125120000_zeus.sql` into the Supabase SQL editor (or
   `supabase db push`). RLS is on with no policy: only the server, with the service role key, can read them.
4. From the folder you ran Zeus in, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your shell:
   `npx looot-zeus import-supabase --dry-run`, then without `--dry-run`.
5. Open your Vercel URL, sign in with the owner email.

The app never needs your looot key. It reads only; it writes nothing to your tables.

## Local

`cp .env.example .env.local`, fill it, `npm install`, `npm run dev`.
