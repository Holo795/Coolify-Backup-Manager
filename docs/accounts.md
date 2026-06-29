# Accounts & roles

CBM supports multiple users with three roles. Access is enforced **server-side** on every
mutating action; the UI additionally hides controls (and whole pages) a role can't use, so
people only see what they can actually do.

## The first account

The **first person to register becomes the administrator**, then public sign-up closes
automatically. Everyone else joins through an **invitation** (below) — there is no open
registration and no default password.

## Roles

Roles are cumulative: **admin ⊇ operator ⊇ viewer**.

| Capability | viewer | operator | admin |
| --- | :---: | :---: | :---: |
| View every page (overview, resources, snapshots, destinations, agents) | ✅ | ✅ | ✅ |
| Manage **your own** account (name, email, password) | ✅ | ✅ | ✅ |
| Run **backups** and **restores** (incl. retry / cancel / delete snapshots, re-pin, verify) | ❌ | ✅ | ✅ |
| Toggle a resource's backup settings and per-container hooks | ❌ | ✅ | ✅ |
| **Connect / sync / delete** Coolify instances, reveal install commands | ❌ | ❌ | ✅ |
| Create / test / delete **destinations** | ❌ | ❌ | ✅ |
| Edit **schedules** (instance, server, resource override) | ❌ | ❌ | ✅ |
| Manage **agents** (server pin, delete) | ❌ | ❌ | ✅ |
| Change **Settings** (timezone, alert webhook, SMTP, verification) | ❌ | ❌ | ✅ |
| Manage **users & invitations** | ❌ | ❌ | ✅ |

A **viewer** is read-only — useful for dashboards or stakeholders. An **operator** runs the
day-to-day backups and restores but can't change configuration. An **admin** configures
everything and manages the team.

> Enforcement is server-side: even a direct API call from an under-privileged session is
> rejected. The hidden buttons are a convenience, not the security boundary.

## Inviting people

As an admin, open **Users → Invite a user**:

1. Enter the person's **email** and pick a **role**.
2. Optionally tick **Email the invite link** (needs a working SMTP — see
   [Email](email.md)). Either way, the **one-time link is shown once** for you to copy.
3. The invitee opens the link, sets their name + password, and they're in — with the role
   you chose.

Invitations are:

- **Single-use** and **expire after 48 hours** (revoke a pending one anytime from the same
  page).
- **Bound to the email** you entered, and only the **sha256 hash** of the token is stored —
  the plaintext link can never be re-displayed.
- Gated: a signup is only accepted if it matches a **claimed, pending, unexpired** invite
  for that email (or it's the very first/admin account).

## Managing users

From **Users**, an admin can change anyone's **role** or **remove** an account. Two guard
rails prevent lock-out:

- You can't **demote or delete the last remaining admin**.
- You can't delete **your own** account from here (use it from another admin, or change your
  role first).

Removing a user signs out their sessions immediately; they'd need a fresh invitation to return.

## Forgot a password?

If SMTP is configured, the sign-in page shows **Forgot password?** — it emails a reset link.
Without SMTP, an admin can simply **re-invite** the person (or set up SMTP first). See
[Email](email.md).
