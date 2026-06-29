# VPS Deployment and Database Migration Guide

This guide provides step-by-step instructions for deploying the Ingestion System to the VPS and migrating the database from Neon to the local PostgreSQL instance.

All steps are designed to be run directly on the VPS (`86.48.0.69`) as the `root` user.

## Step 1: Connect to the VPS

SSH into the server from your terminal:
```bash
ssh root@86.48.0.69
```
*(Provide the password when prompted)*

## Step 2: Clone the Repository

If the codebase is not already on the server, clone it to the `/opt` directory:
```bash
mkdir -p /opt
cd /opt
git clone https://github.com/MuhammadTaha1038/Ingestion-System.git ingestion-system
cd ingestion-system
```

If the repository is already cloned, just pull the latest changes:
```bash
cd /opt/ingestion-system
git pull origin main
```

## Step 3: Run the Automation Scripts

We have provided three `.sh` scripts in the `ops/` directory that will handle the setup automatically. Make sure they are executable first:
```bash
chmod +x ops/*.sh
```

### 3.1 Install PostgreSQL and Set Up Local Database
Run the first script to install PostgreSQL, create the `ingestion_db` database, and configure the `ingestion_user` user:
```bash
./ops/1_setup_postgres.sh
```

### 3.2 Migrate Data from Neon to Local Database
Run the second script to securely transfer all data directly from Neon to your local database (this pipes the data directly, without saving any files on the server):
```bash
./ops/2_migrate_neon_to_local.sh
```

## Step 4: Configure the Environment Variables

Create the `.env` file for the application:
```bash
nano .env
```
Paste all your required environment variables into this file. Make sure to update the `DATABASE_URL` to point to the local database:
```env
DATABASE_URL=postgresql://ingestion_user:Ingestion2026!@localhost:5432/ingestion_db
```
Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

## Step 5: Build and Start the Application

Run the third script to install dependencies, build the TypeScript code, and configure/start the systemd service:
```bash
./ops/3_build_and_start.sh
```

### Verification
The script will output the status of the `ingestion-system` service at the end. You can also manually check the logs to ensure everything is running smoothly:
```bash
journalctl -u ingestion-system -f
```
