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

interface GithubOrgMembership {
  org_login: string;
  org_name: string | null;
  role: string;
  state: string;
}

interface GithubTeamMembership {
  team_id: string;
  team_name: string;
  team_slug: string;
  org_login: string;
  role: string;
  state: string;
}

interface GithubRepoAccess {
  repo_full_name: string;
  repo_name: string;
  permission: string;
  is_outside_collaborator: boolean;
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
  github_org_memberships: GithubOrgMembership[] | null;
  github_team_memberships: GithubTeamMembership[] | null;
  github_repo_access: GithubRepoAccess[] | null;
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

const PERMISSION_COLOR: Record<string, string> = {
  admin: 'bg-red-50 text-red-700 border-red-100',
  maintain: 'bg-orange-50 text-orange-700 border-orange-100',
  push: 'bg-amber-50 text-amber-700 border-amber-100',
  triage: 'bg-blue-50 text-blue-700 border-blue-100',
  pull: 'bg-slate-100 text-slate-600 border-slate-200',
};

const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-purple-50 text-purple-700 border-purple-100',
  admin: 'bg-red-50 text-red-700 border-red-100',
  maintainer: 'bg-orange-50 text-orange-700 border-orange-100',
  member: 'bg-slate-100 text-slate-600 border-slate-200',
};

function Badge({ label, colorMap }: { label: string; colorMap: Record<string, string> }) {
  const cls = colorMap[label.toLowerCase()] || 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
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
    return <p className="text-sm text-slate-500">Loading...</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!person) {
    return <p className="text-sm text-slate-500">No person found.</p>;
  }

  const linkedIdentities = normalizeArray(person.linked_identities);
  const emails = normalizeArray(person.emails);
  const orgMemberships = normalizeArray(person.github_org_memberships);
  const teamMemberships = normalizeArray(person.github_team_memberships);
  const repoAccess = normalizeArray(person.github_repo_access);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          {person.full_name || 'Unnamed person'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {person.primary_email || 'No primary email'}
        </p>
        <div className="text-xs text-slate-400 mt-2">
          Status: {person.status || '-'}
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          Accounts and access
        </h2>
        <ResultsTable data={accountRows as unknown as Record<string, unknown>[]} pageSize={10} />
      </section>

      {orgMemberships.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            GitHub Organisation Memberships
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Organisation</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orgMemberships.map((om, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 text-slate-700 font-medium">
                      {om.org_name || om.org_login}
                      <span className="ml-1.5 text-xs text-slate-400 font-mono">{om.org_login}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge label={om.role} colorMap={ROLE_COLOR} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">{om.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {teamMemberships.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            GitHub Team Memberships
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Organisation</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Team</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamMemberships.map((tm, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{tm.org_login}</td>
                    <td className="px-3 py-2.5">
                      <a
                        href={`/groups/${tm.team_id}?provider=github`}
                        className="text-indigo-600 hover:text-indigo-800 hover:underline font-medium"
                      >
                        {tm.team_name}
                      </a>
                      <span className="ml-1.5 text-xs text-slate-400 font-mono">{tm.team_slug}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge label={tm.role} colorMap={ROLE_COLOR} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">{tm.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {repoAccess.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            GitHub Direct Repository Access
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Repository</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Permission</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {repoAccess.map((ra, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{ra.repo_full_name}</td>
                    <td className="px-3 py-2.5">
                      <Badge label={ra.permission} colorMap={PERMISSION_COLOR} />
                    </td>
                    <td className="px-3 py-2.5">
                      {ra.is_outside_collaborator ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-amber-50 text-amber-700 border-amber-100">
                          Outside Collaborator
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border bg-slate-100 text-slate-600 border-slate-200">
                          Member
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          Linked identities
        </h2>
        <ResultsTable data={linkedIdentities as unknown as Record<string, unknown>[]} pageSize={10} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">Emails</h2>
        <ResultsTable data={emails as unknown as Record<string, unknown>[]} pageSize={10} />
      </section>
    </div>
  );
}
