# AWS Deployment Architecture

## Decision

별도 Java backend를 두지 않는다. `20261R0136COSE45700`의 Next.js 앱을 EC2에 배포하고, `src/app/api/**` Route Handlers를 backend로 사용한다. 운영 DB는 RDS PostgreSQL을 사용한다.

## Target Topology

```text
User Browser
  -> HTTPS
  -> EC2
     - reverse proxy or direct Node port
     - Next.js production server
     - Python virtualenv for pipelines
     - optional local ADF/mock process or Docker ADF server
  -> RDS PostgreSQL
```

## AWS Resources

- EC2
  - Node.js runtime
  - Python runtime and virtualenv
  - project checkout
  - process manager such as systemd or pm2
  - reverse proxy such as Nginx when using HTTPS/domain
- RDS PostgreSQL
  - private DB instance in the same VPC as EC2
  - security group allowing inbound PostgreSQL only from EC2 security group
  - automated backups enabled
- Security Groups
  - EC2 inbound: 22 from admin IP, 80/443 from public internet if serving web directly
  - RDS inbound: 5432 only from EC2 security group
- Secrets
  - `DATABASE_URL`
  - `GEMINI_API_KEY`
  - `VARCO_API_KEY`
  - `PIPELINE_PYTHON`
  - `ADF_SERVER_URL`

## Environment Variables

Server-only:

```env
DATABASE_URL=postgresql://<user>:<password>@<rds-endpoint>:5432/<db>
GEMINI_API_KEY=<server-only>
VARCO_API_KEY=<server-only>
PIPELINE_PYTHON=/opt/virtual-avatar/venv/bin/python
ADF_SERVER_URL=http://127.0.0.1:8000
```

Client-visible:

```env
NEXT_PUBLIC_API_MODE=remote
```

`DATABASE_URL` and API keys must never use the `NEXT_PUBLIC_` prefix.

## Deployment Steps

1. Create RDS PostgreSQL in the same VPC as EC2.
2. Configure RDS security group to accept PostgreSQL traffic only from the EC2 security group.
3. Provision EC2 and install Node.js, npm, Python, build tools, and image/ML native dependencies.
4. Clone this repository on EC2.
5. Create Python virtualenv and install `face-feature/requirements.txt` and `TexturingPipeline/requirements.txt`.
6. Configure environment variables on EC2.
7. Run DB migrations or schema initialization.
8. Build the Next.js app with `npm ci` and `npm run build`.
9. Start with `npm run start` under systemd/pm2.
10. Put Nginx/HTTPS in front of the app if using a domain.
11. Run smoke tests for web page, pipeline routes, and DB persistence.

## Runtime Process Model

Initial MVP can run as one EC2 deployment unit:

- `next start` for frontend and API routes
- Python subprocesses spawned by API routes
- ADF server as a separate process or Docker container

If requests become slow or concurrent usage grows, move long pipeline jobs to a queue. Keep `pipeline_runs` ready for asynchronous status tracking.

## RDS Backup and Recovery

- Enable automated backups.
- Use a retention window appropriate for the project stage. MVP default: at least 7 days.
- Create manual snapshots before schema changes.
- For production, define point-in-time recovery expectations before launch.

## Security Checklist

- RDS is not publicly accessible.
- EC2 SSH is restricted to trusted IPs.
- DB user used by the app has only required privileges.
- API keys and DB credentials are server-only.
- Uploaded files are written to temp directories and deleted after processing.
- Debug output directories are not served publicly.

## Official AWS References

- EC2 to RDS connectivity and security group setup: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/ec2-rds-connect.html
- RDS security groups and inbound access: https://docs.aws.amazon.com/AmazonRDS/latest/gettingstartedguide/security-groups.html
- RDS backup and recovery: https://docs.aws.amazon.com/prescriptive-guidance/latest/backup-recovery/rds.html
