'use client';

import { useEffect, useMemo, useState } from 'react';
import { ResultsTable } from './ResultsTable';

interface LinkedIdentity {
  provider_type: string;
  provider_user_id: string;
  confidence_score: number | null;
  match_method: string | null;
}

interface CanonicalEmail {
  email: string;
  is_primary: boolean;
  verified_at: string | null;
}

interface GoogleIdentity {
  id: string;
  google_id: string;
  primary_email: string | null;
  name_full: string | null;
  is_admin: boolean | null;
  suspended: boolean | null;
  last_login_time: string | null;
}

interface AwsIdentityCenterIdentity {
  id: string;
  user_name: string | null;
  display_name: string | null;
  active: boolean | null;
}

interface GithubIdentity {
  id: string;
  login: string | null;
  email: string | null;
  name: string | null;
  type: string | null;
}

interface PersonRecord {
  id: string;
  full_name: string | null;
  primary_email: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  linked_identities: LinkedIdentity[] | null;
  emails: CanonicalEmail[] | null;
  google_identities: GoogleIdentity[] | null;
  aws_idc_identities: AwsIdentityCenterIdentity[] | null;
  github_identities: GithubIdentity[] | null;
}

interface PersonDetailResponse {
  person: PersonRecord;
}

interface AccountAccessRow {
  provider: string;
  account_id: string;
  display_name: string;
  email_or_login: string;
  status: string;
  last_login_time: string;
  access_flags: string;
}

interface PersonDetailProps {
  personId: string;
}

function normalizeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function buildAccountAccessRows(person: PersonRecord): AccountAccessRow[] {
  const rows: AccountAccessRow[] = [];

  for (const identity of normalizeArray(person.google_identities)) {
    rows.push({
      provider: 'Google Workspace',
      account_id: identity.google_id,
      display_name: identity.name_full || '-',
      email_or_login: identity.primary_email || '-',
      status: identity.suspended === null
        ? '-'
        : identity.suspended
          ? 'Suspended'
          : 'Active',
      last_login_time: identity.last_login_time || '-',
      access_flags: identity.is_admin ? 'Admin' : '-',
    });
  }

  for (const identity of normalizeArray(person.aws_idc_identities)) {
    rows.push({
      provider: 'AWS Identity Center',
      account_id: identity.user_name || identity.id,
      display_name: identity.display_name || '-',
      email_or_login: identity.user_name || '-',
      status: identity.active === null
        ? '-'
        : identity.active
          ? 'Active'
          : 'Disabled',
      last_login_time: '-',
      access_flags: '-',
    });
  }

  for (const identity of normalizeArray(person.github_identities)) {
    rows.push({
      provider: 'GitHub',
      account_id: identity.login || identity.id,
      display_name: identity.name || '-',
      email_or_login: identity.email || identity.login || '-',
      status: identity.type || '-',
      last_login_time: '-',
      access_flags: '-',
    });
  }

  return rows;
}

export function PersonDetail({ personId }: PersonDetailProps) {
  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPerson = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/people/${personId}`);
        if (!res.ok) throw new Error('Failed to load person');
        const json = await res.json() as PersonDetailResponse;
        setPerson(json.person);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchPerson();
  }, [personId]);

  const accountRows = useMemo(() => {
    if (!person) return [];
    return buildAccountAccessRows(person);
  }, [person]);

  if (loading) {
    return <p className="text-sm text-gray-500">Loading...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!person) {
    return <p className="text-sm text-gray-500">No person found.</p>;
  }

  const linkedIdentities = normalizeArray(person.linked_identities);
  const emails = normalizeArray(person.emails);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">
          {person.full_name || 'Unnamed person'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {person.primary_email || 'No primary email'}
        </p>
        <div className="text-xs text-gray-400 mt-2">
          Status: {person.status || '-'}
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          Accounts and access
        </h2>
        <ResultsTable data={accountRows as unknown as Record<string, unknown>[]} pageSize={10} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">
          Linked identities
        </h2>
        <ResultsTable data={linkedIdentities as unknown as Record<string, unknown>[]} pageSize={10} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Emails</h2>
        <ResultsTable data={emails as unknown as Record<string, unknown>[]} pageSize={10} />
      </section>
    </div>
  );
}
