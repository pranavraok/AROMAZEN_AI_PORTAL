# AROMAZEN production deployment pipeline

The workflow in `.github/workflows/production-deploy.yml` validates every commit pushed to `main`. Production deployment stays disabled until the one-time server and GitHub configuration below is complete.

## Pipeline

```text
Push reviewed code to main
        |
        v
Validate shell, Compose and Caddy configuration
        |
        v
Build the production API and frontend images
        |
        v
Wait for approval in the GitHub production environment
        |
        v
Connect with a dedicated SSH key
        |
        v
Encrypted database and upload backup
        |
        v
Verify the exact approved commit and fast-forward main
        |
        v
Build, migrate and restart Docker services
        |
        v
Require https://ai.aromazenind.com/api/v1/health to return status ok
```

Only one production deployment can run at a time. A dirty server checkout, failed backup, unexpected Git commit, failed build, failed migration or failed health check stops the workflow.

## 1. Verify backup configuration first

Before enabling automatic deployment, run this command successfully:

```bash
cd /opt/aromazen-portal
./scripts/deployment/backup.sh
```

When `BACKUP_BUCKET` is empty, the script retains encrypted database backups under
`$APP_DATA_DIR/backups` on the application server. This is sufficient for recovering
from a deployment mistake during low-cost testing, but it does not protect against
complete server or disk loss.

For production disaster recovery, configure a private S3-compatible bucket and AWS
CLI credentials. The same script will then copy encrypted database backups and the
current uploaded files to private object storage automatically.

## 2. Create a dedicated GitHub Actions SSH key

Generate a new Ed25519 key on an administrator computer. Do not reuse a developer's normal SSH key. The CI key must not have an interactive passphrase because GitHub Actions cannot answer a passphrase prompt.

Windows PowerShell:

```powershell
ssh-keygen -t ed25519 -C "github-actions-aromazen-production" -f "$env:USERPROFILE\.ssh\aromazen_github_actions"
```

Press Enter twice when asked for a passphrase so this dedicated automation key has no interactive passphrase.

Add only the `.pub` line to `/home/deploy/.ssh/authorized_keys` on the server. Prefix the line with restrictions that disable interactive shells and forwarding:

```text
no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty PUBLIC_KEY_LINE
```

Keep the private key file off the server and never commit either key to the repository.

## 3. Record the verified server host key

Run this on the server:

```bash
sudo awk '{print "ai.aromazenind.com " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

Confirm that its SHA256 fingerprint matches the fingerprint previously accepted by the administrator. Store the complete output line as the GitHub environment secret `PROD_SSH_KNOWN_HOSTS`.

## 4. Create the GitHub production environment

In the GitHub repository, open **Settings -> Environments** and create an environment named `production`.

Configure:

- Required reviewer: the person authorized to release production changes.
- Deployment branch: `main` only.
- Environment secret `PROD_SSH_PRIVATE_KEY`: complete contents of `aromazen_github_actions` without `.pub`.
- Environment secret `PROD_SSH_KNOWN_HOSTS`: verified host-key line from the previous step.
- Environment variable `PROD_SSH_HOST`: `ai.aromazenind.com`.
- Environment variable `PROD_SSH_PORT`: `22`.
- Environment variable `PROD_SSH_USER`: `deploy`.

Do not store `.env.production`, database passwords, AI keys, Zoho credentials or backup encryption passwords in GitHub. They remain only in the protected server environment file.

## 5. Enable production deployment

In **Settings -> Secrets and variables -> Actions -> Variables**, create the repository variable:

```text
PRODUCTION_DEPLOY_ENABLED=true
```

Until this exact variable exists, pushes still run validation but the production deployment job is skipped.

## 6. Test and operate

Open **Actions -> Validate and deploy production -> Run workflow**. After validation succeeds, review the commit and approve the `production` deployment. Confirm the workflow ends with a healthy status and verify the portal manually.

Normal operation after setup:

1. Test changes locally.
2. Merge reviewed changes into `main`.
3. Wait for validation to pass.
4. Review and approve the production deployment.
5. Confirm the health check and test the affected portal workflow.

To suspend automatic production deployment without deleting secrets, change `PRODUCTION_DEPLOY_ENABLED` to `false`.

## Manual fallback

If GitHub Actions is unavailable, use the existing manual process:

```bash
cd /opt/aromazen-portal
./scripts/deployment/backup.sh
git pull --ff-only origin main
./scripts/deployment/deploy.sh
curl -fsS https://ai.aromazenind.com/api/v1/health
```
