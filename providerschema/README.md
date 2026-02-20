# Extracted Provider Response Schemas

This directory contains machine-extracted response schemas from official provider specifications.

## Source Versions

- Google Workspace Admin SDK Directory API
  - Discovery URL: `https://admin.googleapis.com/$discovery/rest?version=directory_v1`
  - API version: `directory_v1`
  - Discovery revision: `20260217`
- AWS IAM Identity Center (Identity Store)
  - Service model URL: `https://raw.githubusercontent.com/boto/botocore/develop/botocore/data/identitystore/2020-06-15/service-2.json`
  - API version: `2020-06-15`
  - Service: `AWS SSO Identity Store`
- GitHub Organization REST API
  - OpenAPI URL: `https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.2022-11-28.json`
  - REST API version header: `X-GitHub-Api-Version: 2022-11-28`
  - OpenAPI version: `3.0.3`

## Artifacts

- `google_workspace_directory_v1.schemas.json`
  - Directory entities: `User`, `Group`, `Member`
- `aws_identitystore_2020-06-15.schemas.json`
  - Identity entities: `DescribeUserResponse`, `DescribeGroupResponse`, `DescribeGroupMembershipResponse`
  - Plus list response envelopes used in pagination-based ingestion
- `github_org_2022-11-28.schemas.json`
  - Org entities: `simple-user`, `org-membership`, `team`, `team-membership`, `repository`
  - Includes `components.schemas` to resolve nested `$ref`s
- `field_path_index.json`
  - Flattened field path inventory across all extracted schemas for comparison and mapping


