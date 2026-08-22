# AROMAZEN AI Portal — HR and R&D Pilot Deployment

This production setup deploys the complete portal, while backend rules restrict HR modules to the HR department and R&D document modules to the R&D department. The `owner` and `super_admin` roles can access both.

## What is already prepared in this repository

- Separate `docker-compose.prod.yml`; local development remains unchanged.
- HTTPS termination through Caddy.
- PostgreSQL, Redis, API and frontend ports are private inside Docker.
- Password-protected Redis and secure production cookies.
- Production API documentation disabled.
- Login attempt rate limiting.
- Twelve-character minimum for newly invited users.
- Backend department enforcement for HR payroll/letters and R&D document generation.
- Consistent 120 MB application upload ceiling.
- Persistent uploads under `/srv/aromazen/uploads`.
- Encrypted database backup, file synchronization and guarded restore scripts.
- Nightly systemd backup timer templates.

## Actions requiring the company or developer account owner

These cannot be completed from the source repository:

1. Create the company-owned AWS account and enable MFA.
2. Purchase/create the Lightsail instance and private storage bucket.
3. Obtain access to the DNS zone for `aromazenind.com`.
4. Obtain a Zoho SMTP app password from the company administrator.
5. Obtain and fund any AI provider API keys.
6. Approve the first Super Admin email address.

Never send these passwords or keys in a PDF or commit them to Git.

## 1. Create the low-cost AWS resources

In the company AWS account:

1. Create an Ubuntu LTS Lightsail instance in Mumbai (`ap-south-1`) with approximately 4 GB RAM and 2 vCPU.
2. Attach a static IP.
3. Configure both IPv4 and IPv6 firewalls:
   - TCP 80 from anywhere.
   - TCP 443 from anywhere.
   - UDP 443 from anywhere (optional HTTP/3).
   - TCP 22 only from the developer's current IP, or use Lightsail browser SSH.
   - Do not open 3000, 3001, 5432, 6379 or 8000.
4. Create a 100 GB Lightsail object-storage bucket in the same region.
5. Keep the bucket private, enable versioning and attach the instance through resource access.
6. Create a storage alert at 70 GB. Move to 250 GB before actual consumption approaches 80–90 GB.
7. Confirm the instance disk has enough free space for the expected 10 GB pilot. Live uploads are stored on the persistent server disk and copied to the private bucket nightly. If live uploads approach 40–50 GB, attach and mount additional Lightsail block storage at `/srv/aromazen` before the disk becomes constrained.

## 2. Prepare the Ubuntu server

Log in through SSH and:

1. Install operating-system security updates.
2. Create a Linux user named `aromazen` and grant only the administration needed for deployment.
3. Install Docker Engine and the Docker Compose plugin from Docker's official Ubuntu repository.
4. Add `aromazen` to the Docker group, then sign out and back in.
5. Install AWS CLI and OpenSSL.
6. Configure AWS CLI/resource access to the private backup bucket.
7. Create the application locations:

   ```bash
   sudo mkdir -p /opt/aromazen-portal /srv/aromazen/uploads /var/backups/aromazen
   sudo chown -R aromazen:aromazen /opt/aromazen-portal /srv/aromazen /var/backups/aromazen
   sudo chmod 700 /srv/aromazen /srv/aromazen/uploads /var/backups/aromazen
   ```

## 3. Transfer the project

Transfer the repository using a private Git repository or a secured archive into `/opt/aromazen-portal`.

Do not transfer local `.env` files, local uploads, database volumes, `node_modules`, `.next`, logs or test payroll documents.

## 4. Create production secrets

On the server:

```bash
cd /opt/aromazen-portal
cp .env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32
```

Run the OpenSSL command separately for the PostgreSQL, Redis, JWT and backup passwords. Hex output is intentional because it is safe inside the Redis connection URL. Edit `.env.production` and replace every `CHANGE_ME` value. Use different values for every secret.

Add the approved first owner email and temporary 12+ character password. Add Zoho and AI credentials only when they are available.

## 5. Configure the subdomain

In the existing DNS provider/Cloudflare zone:

1. Preserve all Zoho MX, SPF, DKIM and DMARC records.
2. Add an `A` record named `ai` pointing to the Lightsail static IP.
3. Use **DNS only / grey cloud** for the pilot.

DNS-only mode is intentional: Cloudflare Free currently limits proxied request bodies to 100 MB, and multipart overhead can cause a nominal 100 MB file to fail. Caddy still provides normal public HTTPS directly on the server. If uploads are later redesigned as multipart/direct-to-object-storage, Cloudflare proxying can be enabled safely.

Wait until `ai.aromazenind.com` resolves to the static IP before the first production start, allowing Caddy to obtain its HTTPS certificate.

## 6. First deployment

On the server:

```bash
cd /opt/aromazen-portal
chmod +x scripts/deployment/*.sh
bash ./scripts/deployment/validate-env.sh
bash ./scripts/deployment/deploy.sh
```

Check:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS https://ai.aromazenind.com/api/v1/health
```

Open `https://ai.aromazenind.com`, sign in as the first Super Admin and immediately change/secure the temporary credentials. Then clear `BOOTSTRAP_OWNER_PASSWORD` in `.env.production` and run `deploy.sh` again. Existing data is preserved.

New files in `/srv/aromazen/uploads` use readable, collision-safe paths organized by purpose, organization, category and version. For example, an HR template is stored as `templates/<organization-id>/hr-letters/<template-key>/<readable-name>--v003--<short-id>.docx`. Keep the database `stored_filename` value as the authoritative relative path; do not rename files directly on the server. Template records remain inside the automatically-created Knowledge Base collection for their department (for example, HR or R&D), and replacements remain available there as superseded versions for audit history.

## 7. Create pilot access

As Super Admin:

1. Create departments named exactly `HR` and `R&D` if they do not already exist.
2. Create one HR test user and one R&D test user.
3. Give HR administration functions only to the selected HR manager.
4. Keep ordinary users on the Employee role.
5. Create separate HR and R&D knowledge collections and attach each to only its department.
6. Upload masked/test documents first.

Verify that an HR token receives HTTP 403 from R&D document endpoints and an R&D token receives HTTP 403 from HR payroll and letter endpoints. Page hiding alone is not the acceptance test.

## 8. Configure nightly backups

First run a manual backup:

```bash
cd /opt/aromazen-portal
bash ./scripts/deployment/backup.sh
```

Confirm that an encrypted database file appears under the bucket's `database/` folder and uploaded files appear under `uploads/current/`.

Enable the nightly timer:

```bash
sudo cp deployment/aromazen-backup.service deployment/aromazen-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aromazen-backup.timer
systemctl list-timers aromazen-backup.timer
```

Configure the bucket lifecycle to retain database backups and old object versions for 90 days. Test a restore before real data is accepted.

## 9. Guarded database restore

Restoration replaces the current production database and intentionally requires an explicit confirmation value:

```bash
RESTORE_CONFIRM=RESTORE_AROMAZEN bash ./scripts/deployment/restore.sh /path/to/aromazen-YYYYMMDDTHHMMSSZ.dump.enc
```

To restore uploaded files, synchronize the bucket's `uploads/current/` folder back into `/srv/aromazen/uploads`, then verify ownership and permissions. Perform restoration during announced downtime and test all critical HR/R&D workflows before reopening access.

## 10. Pilot acceptance checklist

- HTTPS works without warnings and HTTP redirects to HTTPS.
- Ports 3000, 3001, 5432, 6379 and 8000 are unreachable from the internet.
- `/docs`, `/redoc` and `/openapi.json` are unavailable in production.
- Server restart preserves database records and documents.
- HR cannot call R&D document APIs.
- R&D cannot call HR letter, attendance or payroll APIs.
- Logged-out users cannot download copied document URLs.
- 100 MB sample upload succeeds through DNS-only HTTPS.
- Invalid and oversized files are rejected.
- Zoho test email reaches an approved internal address.
- Encrypted database backup succeeds and restores successfully.
- One HR representative and one R&D representative approve sample outputs.

## Updating the portal later

Back up first, transfer/pull the reviewed code, then run:

```bash
cd /opt/aromazen-portal
bash ./scripts/deployment/backup.sh
bash ./scripts/deployment/deploy.sh
```

Do not run destructive Docker volume-removal commands. Database migrations run automatically before the new API becomes healthy.
