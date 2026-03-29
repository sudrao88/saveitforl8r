# create-pr

Create a pull request for the current branch, subscribe to activity, and handle review comments.

## Usage

```
/create-pr [title]
```

- If a title is provided, use it as the PR title.
- If no title is provided, infer a concise title from the commit history.

## Instructions

Follow these steps exactly:

### 1. Determine the base branch

The default base branch is `native-app`. Only use a different base if the user explicitly specifies one.

To verify, check the branch history:

```bash
git log --oneline --first-parent native-app..HEAD
```

If the user specifies a different base, use that instead.

### 2. Prepare the branch

- Run `git status` to check for uncommitted changes. If there are uncommitted changes, ask the user whether to commit them first.
- Ensure the current branch is pushed to the remote:
  ```bash
  git push -u origin <current-branch>
  ```
- If push fails due to network errors, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s).

### 3. Analyze changes for the PR description

- Run `git log --oneline native-app..HEAD` to see all commits being merged.
- Run `git diff native-app...HEAD --stat` to see a summary of file changes.
- Run `git diff native-app...HEAD` to understand the actual changes.

### 4. Create the pull request

Use the `mcp__github__create_pull_request` tool with:
- **base**: `native-app` (unless user specified otherwise)
- **title**: User-provided title, or a concise (<70 chars) title inferred from the changes
- **body**: Use this format (via the tool's body parameter):

```
## Summary
<1-3 bullet points describing what changed and why>

## Changes
<Brief list of key changes>

## Test plan
- [ ] <Checklist of testing steps>

<session-link>
```

### 5. Subscribe to PR activity

After creating the PR, immediately use the `mcp__github__subscribe_pr_activity` tool to monitor:
- Review comments
- CI status updates
- Other PR events

Tell the user you are now watching the PR for review comments and CI updates.

### 6. Handle PR activity events

When PR activity events arrive (wrapped in `<github-webhook-activity>` tags):

- **Review comments**: Read and understand each comment. If the fix is clear and straightforward, implement it, commit, and push. If ambiguous, ask the user before acting.
- **CI failures**: Investigate the failure, fix the issue, commit, and push.
- **Approvals**: Inform the user the PR has been approved.
- **Change requests**: Summarize the requested changes and ask the user how to proceed if the changes are non-trivial.

For each fix:
1. Make the code change
2. Commit with a descriptive message referencing the review feedback
3. Push to the same branch: `git push -u origin <branch-name>`

### 7. Report back

After creating the PR, provide:
- The PR URL
- A summary of what's included
- Confirmation that you're subscribed to activity
