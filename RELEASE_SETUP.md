# Rifler Release Automation Setup Guide

This guide walks through setting up the automated release pipeline for Rifler.

## What's Been Implemented

✅ **GitHub Actions Workflow** (`.github/workflows/release.yml`)
- Validates code (lint, test, build) on every release tag
- Packages extension as VSIX
- Publishes to VS Code Marketplace
- Creates GitHub releases with automatic changelog notes

✅ **Version Management** (`standard-version`)
- Automatic semantic versioning (major.minor.patch)
- Conventional commit parsing (feat:, fix:, BREAKING CHANGE:)
- Automated CHANGELOG.md generation
- Git tag creation

✅ **Configuration Files**
- `.versionrc.json` - Customized changelog format for Rifler
- Release scripts in `package.json`
- Updated `CONTRIBUTING.md` with release process docs

## Setup Steps Required

### Step 1: Install Dependencies Locally

```bash
npm install
```

This will install `standard-version` and all other dependencies.

### Step 2: Create VS Code Marketplace Token

**Why needed:** To authenticate with VS Code Marketplace for publishing.

1. Go to [VS Code Marketplace Publisher Dashboard](https://marketplace.visualstudio.com/manage/publishers)
2. If you don't have a publisher account, create one first
3. Select your publisher (Ori-Roza)
4. Click "Personal access tokens" → "Create new token"
5. Set:
   - Name: `GitHub Release Automation`
   - Scopes: Check `Marketplace > Manage`
   - Expiration: 1 year (or as needed)
6. Copy the token (you won't see it again)

### Step 3: Add Token to GitHub Secrets

1. Go to your GitHub repository: https://github.com/Ori-Roza/Rifler
2. Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `VSCE_PAT`
5. Value: Paste the token from Step 2
6. Click "Add secret"

## How to Use

### Making a Release

1. **Make changes and commit** with conventional commit format:
   ```bash
   git add .
   git commit -m "feat: add new search feature"  # for feature
   git commit -m "fix: resolve search bug"       # for bugfix
   git commit -m "BREAKING CHANGE: refactor API" # for major version
   ```

2. **Generate release**:
   ```bash
   npm run release
   ```
   This will:
   - Determine next version automatically
   - Update `package.json` version
   - Generate/update `CHANGELOG.md`
   - Create a git commit and tag
   
   Or specify version manually:
   ```bash
   npm run release:major    # v0.1.8 → v1.0.0
   npm run release:minor    # v0.1.8 → v0.2.0
   npm run release:patch    # v0.1.8 → v0.1.9
   ```

3. **Push to trigger CI/CD**:
   ```bash
   git push origin master --follow-tags
   ```

4. **Wait for GitHub Actions** to complete:
   - Watch progress: https://github.com/Ori-Roza/Rifler/actions
   - Workflow name: "Release"
   - Should take 2-5 minutes

5. **Verify release**:
   - GitHub Releases: https://github.com/Ori-Roza/Rifler/releases
   - VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=Ori-Roza.rifler
   - Check "Activity" tab for "Published" status

### Manual Publish (if needed)

If the workflow fails, you can manually publish:

```bash
npm run vscode:prepublish
npx vsce publish -p $VSCODE_MARKETPLACE_TOKEN
```

## Testing the Setup

### Test 1: Validate Workflow File

```bash
# Syntax check (if you have GitHub CLI installed)
gh workflow view .github/workflows/release.yml
```

### Test 2: Test Local Version Bump

```bash
# Dry run to see what would happen (without committing)
npx standard-version --dry-run
```

### Test 3: Create a Test Release Tag

Once confident, trigger the workflow manually:

1. Go to: https://github.com/Ori-Roza/Rifler/actions/workflows/release.yml
2. Click "Run workflow"
3. Select branch: `master`
4. Optional: Enter version number
5. Click "Run workflow"

Or manually create a tag:
```bash
git tag v0.1.9
git push origin v0.1.9
```

## Troubleshooting

### Issue: "Marketplace Token not found"

**Solution:** Verify secret is correctly set in GitHub:
- Go to Settings → Secrets → Check `VSCE_PAT` exists
- Check the workflow is referencing it: `${{ secrets.VSCE_PAT }}`

### Issue: "Package already published"

**Solution:** If same version published twice:
```bash
# Increment the patch version
npm run release:patch
git push origin master --follow-tags
```

### Issue: Workflow fails on tests

**Solution:** Run tests locally first:
```bash
npm test              # Unit tests
npm run test:e2e      # E2E tests
npm run lint          # Linting
```

### Issue: CHANGELOG.md not generated

**Solution:** Ensure commits follow conventional format:
- ✅ `feat: description`
- ✅ `fix: description`
- ❌ `updated code` (won't appear in changelog)

## Summary

The release pipeline is now fully automated:

| Step | Before (Manual) | After (Automated) |
|------|-----------------|-------------------|
| 1. Build & Test | Manual: `npm test` | ✅ Automated in CI |
| 2. Version bump | Manual: Edit `package.json` | ✅ `npm run release` |
| 3. CHANGELOG | Manual: Write release notes | ✅ Auto-generated |
| 4. Commit & Tag | Manual: `git commit`, `git tag` | ✅ `npm run release` |
| 5. Package VSIX | Manual: `npm run package` | ✅ Automated in CI |
| 6. Publish | Manual: `vsce publish` | ✅ Automated in CI |
| 7. GitHub Release | Manual: Create on GitHub | ✅ Auto-created with notes |

**Next release process:**
1. Make commits with conventional format
2. Run `npm run release`
3. Run `git push origin master --follow-tags`
4. Done! ✅

## Questions?

See updated `CONTRIBUTING.md` for release process details.
