# Email Roadmap

This document preserves the deferred Resend and Supabase email plan for Eusoff Bandits. It is documentation only; do not treat it as implemented work.

## Current Status

- Resend email work is deferred.
- Supabase Auth remains responsible for registration, password reset, and auth emails.
- Existing reminder subscribers should continue to use `reminder_subscriptions`.
- Do not create a duplicate `subscribers` table.

## Owner Decisions Required

Before implementation, confirm:

- Sending domain or subdomain.
- Sender name.
- Sender email address.
- Email copy and design direction.
- Event reminder timing rules.
- Booking confirmation wording.

## Future Implementation Phases

1. Set up Resend and verify the sending domain.
2. Configure Supabase Auth SMTP to use Resend for auth-controlled emails.
3. Add a Supabase Edge Function for event reminder emails.
4. Add a signed-token unsubscribe flow.
5. Add booking confirmation email sending when an admin approves a booking and the booking contact is an email address.

## Security Guardrails

- Do not create a duplicate `subscribers` table.
- Do not use Vercel Edge Functions for this email system.
- Do not put Resend secrets in frontend environment variables.
- Do not use plain email addresses in unsubscribe URLs.
- Do not modify Supabase Auth emails in app code; configure Auth SMTP in the Supabase dashboard instead.
- Ask for owner approval before making email design or copy choices.

## Future Secrets Checklist

These values should be configured only in secure server-side environments such as Supabase Edge Function secrets:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `SITE_URL`
- `UNSUBSCRIBE_SIGNING_SECRET`
- Supabase Edge Function service-role access

## Notes For Later

- Event reminder emails should query active rows from `reminder_subscriptions`.
- Unsubscribe links should use signed tokens, not raw email addresses.
- Booking confirmation emails should only send when the booking contact value is a valid email address.
- Auth emails such as welcome, confirmation, and password reset should be handled through Supabase Auth SMTP settings.
