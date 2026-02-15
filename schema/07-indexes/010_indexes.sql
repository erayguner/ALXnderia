-- 07-indexes · All secondary indexes

-- Person
CREATE INDEX IF NOT EXISTS idx_person_tenant   ON person (tenant_id);
CREATE INDEX IF NOT EXISTS idx_person_email    ON person (tenant_id, primary_email);
CREATE INDEX IF NOT EXISTS idx_person_hr_id    ON person (tenant_id, hr_employee_id)
    WHERE hr_employee_id IS NOT NULL;

-- AWS IAM User
CREATE INDEX IF NOT EXISTS idx_aws_iam_user_account ON aws_iam_user (aws_account_id);
CREATE INDEX IF NOT EXISTS idx_aws_iam_user_person  ON aws_iam_user (person_id)
    WHERE person_id IS NOT NULL;

-- AWS IDC User
CREATE INDEX IF NOT EXISTS idx_aws_idc_user_person ON aws_idc_user (person_id)
    WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aws_idc_user_email  ON aws_idc_user (tenant_id, email)
    WHERE email IS NOT NULL;

-- AWS IDC Group Membership
CREATE INDEX IF NOT EXISTS idx_aws_idc_gm_user  ON aws_idc_group_membership (user_id);
CREATE INDEX IF NOT EXISTS idx_aws_idc_gm_group ON aws_idc_group_membership (group_id);

-- AWS IDC Account Assignment
CREATE INDEX IF NOT EXISTS idx_aws_idc_assign_user    ON aws_idc_account_assignment (principal_user_id)
    WHERE principal_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aws_idc_assign_group   ON aws_idc_account_assignment (principal_group_id)
    WHERE principal_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aws_idc_assign_account ON aws_idc_account_assignment (aws_account_id);
CREATE INDEX IF NOT EXISTS idx_aws_idc_assign_ps      ON aws_idc_account_assignment (permission_set_id);
CREATE INDEX IF NOT EXISTS idx_idc_asgn_acct_type     ON aws_idc_account_assignment (aws_account_id, principal_type);

-- AWS IAM User Policy Attachment
CREATE INDEX IF NOT EXISTS idx_iam_user_policy_user ON aws_iam_user_policy_attachment (iam_user_id);

-- GCP Workspace User
CREATE INDEX IF NOT EXISTS idx_gcp_ws_user_person ON gcp_workspace_user (person_id)
    WHERE person_id IS NOT NULL;

-- GCP Workspace Group Membership
CREATE INDEX IF NOT EXISTS idx_gcp_ws_gm_user  ON gcp_workspace_group_membership (user_id);
CREATE INDEX IF NOT EXISTS idx_gcp_ws_gm_group ON gcp_workspace_group_membership (group_id);

-- GCP IAM Binding
CREATE INDEX IF NOT EXISTS idx_gcp_iam_binding_project ON gcp_iam_binding (gcp_project_id);
CREATE INDEX IF NOT EXISTS idx_gcp_binding_proj_type   ON gcp_iam_binding (gcp_project_id, principal_type);
CREATE INDEX IF NOT EXISTS idx_gcp_iam_binding_email   ON gcp_iam_binding (tenant_id, principal_email);
CREATE INDEX IF NOT EXISTS idx_gcp_iam_binding_role    ON gcp_iam_binding (role);
CREATE INDEX IF NOT EXISTS idx_gcp_iam_binding_ws_user ON gcp_iam_binding (workspace_user_id)
    WHERE workspace_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gcp_iam_binding_ws_grp  ON gcp_iam_binding (workspace_group_id)
    WHERE workspace_group_id IS NOT NULL;

-- Person Link
CREATE INDEX IF NOT EXISTS idx_person_link_person   ON person_link (person_id);
CREATE INDEX IF NOT EXISTS idx_person_link_provider ON person_link (identity_type, provider_identity_id);

-- GitHub User
CREATE INDEX IF NOT EXISTS idx_github_user_person ON github_user (person_id)
    WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_github_user_email  ON github_user (tenant_id, lower(email))
    WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_github_user_login  ON github_user (tenant_id, login);

-- GitHub Organisation
CREATE INDEX IF NOT EXISTS idx_github_org_tenant ON github_organisation (tenant_id);

-- GitHub Team
CREATE INDEX IF NOT EXISTS idx_github_team_org ON github_team (org_id);
CREATE INDEX IF NOT EXISTS idx_github_team_parent ON github_team (parent_team_id)
    WHERE parent_team_id IS NOT NULL;

-- GitHub Team Membership
CREATE INDEX IF NOT EXISTS idx_github_tm_user ON github_team_membership (user_id);
CREATE INDEX IF NOT EXISTS idx_github_tm_team ON github_team_membership (team_id);

-- GitHub Org Membership
CREATE INDEX IF NOT EXISTS idx_github_om_user ON github_org_membership (user_id);
CREATE INDEX IF NOT EXISTS idx_github_om_org  ON github_org_membership (org_id);

-- JSONB GIN indexes
CREATE INDEX IF NOT EXISTS idx_aws_account_tags   ON aws_account   USING GIN (tags)
    WHERE tags IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gcp_project_labels ON gcp_project   USING GIN (labels)
    WHERE labels IS NOT NULL;

-- Materialised view
CREATE INDEX IF NOT EXISTS idx_mv_ea_person   ON mv_effective_access (person_id);
CREATE INDEX IF NOT EXISTS idx_mv_ea_account  ON mv_effective_access (account_or_project_id);
CREATE INDEX IF NOT EXISTS idx_mv_ea_tenant   ON mv_effective_access (tenant_id);
CREATE INDEX IF NOT EXISTS idx_mv_ea_provider ON mv_effective_access (cloud_provider);
