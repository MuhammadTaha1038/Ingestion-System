import { Pool } from "pg";
import { getDatabasePool } from "../pool.js";

export interface CpanelRecord {
  id: string;
  name: string;
}

export interface SubdomainRecord {
  id: string;
  cpanel_account_id: string;
  name: string;
}

export interface EmailAccountRecord {
  id: string;
  subdomain_id: string;
  address: string;
}

export class HierarchyRepository {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  async createCpanel(name: string): Promise<string> {
    const res = await this.pool.query(
      "INSERT INTO cpanel_accounts (name) VALUES ($1) RETURNING id",
      [name]
    );
    return res.rows[0].id as string;
  }

  async listCpanels(): Promise<CpanelRecord[]> {
    const res = await this.pool.query("SELECT id, name FROM cpanel_accounts ORDER BY created_at DESC");
    return res.rows as CpanelRecord[];
  }

  async createSubdomain(cpanelId: string, name: string): Promise<string> {
    const res = await this.pool.query(
      "INSERT INTO subdomains (cpanel_account_id, name) VALUES ($1, $2) RETURNING id",
      [cpanelId, name]
    );
    return res.rows[0].id as string;
  }

  async listSubdomains(cpanelId?: string): Promise<SubdomainRecord[]> {
    if (cpanelId) {
      const res = await this.pool.query(
        "SELECT id, cpanel_account_id, name FROM subdomains WHERE cpanel_account_id = $1 ORDER BY created_at DESC",
        [cpanelId]
      );
      return res.rows as SubdomainRecord[];
    }

    const res = await this.pool.query("SELECT id, cpanel_account_id, name FROM subdomains ORDER BY created_at DESC");
    return res.rows as SubdomainRecord[];
  }

  async createEmailAccount(subdomainId: string, address: string): Promise<string> {
    const res = await this.pool.query(
      "INSERT INTO email_accounts (subdomain_id, address) VALUES ($1, $2) RETURNING id",
      [subdomainId, address]
    );
    return res.rows[0].id as string;
  }

  async listEmailAccounts(subdomainId?: string): Promise<EmailAccountRecord[]> {
    if (subdomainId) {
      const res = await this.pool.query(
        "SELECT id, subdomain_id, address FROM email_accounts WHERE subdomain_id = $1 ORDER BY created_at DESC",
        [subdomainId]
      );
      return res.rows as EmailAccountRecord[];
    }

    const res = await this.pool.query("SELECT id, subdomain_id, address FROM email_accounts ORDER BY created_at DESC");
    return res.rows as EmailAccountRecord[];
  }
}
