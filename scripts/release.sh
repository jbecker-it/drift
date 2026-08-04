#!/bin/bash
# Drift release script
# Usage: ./scripts/release.sh
#
# Creates release archives (tar.gz + zip) with source + dist/
# Run AFTER: npm run build (or vite build)
# Run AFTER: git commit + git tag

set -e

VERSION=$(node -p "require('./package.json').version")
echo "📦 Building release for v${VERSION}..."

# Ensure dist/ exists
if [ ! -d "dist" ]; then
  echo "❌ dist/ not found. Run 'npm run build' first."
  exit 1
fi

# Clean old release archives
rm -f drift-v*.tar.gz drift-v*.zip

# Create temp staging dir
STAGING="/tmp/drift-release"
rm -rf "$STAGING"
mkdir -p "$STAGING/drift-v${VERSION}"

# Copy source (exclude node_modules, .git, dist, old archives)
tar --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='drift-v*.tar.gz' --exclude='drift-v*.zip' \
  --exclude='scripts' --exclude='.hermes' --exclude='*.plan' \
  -cf - . | tar xf - -C "$STAGING/drift-v${VERSION}/"

# Copy dist/ into staging
cp -r dist "$STAGING/drift-v${VERSION}/dist"

# Create tar.gz
cd "$STAGING"
tar czf "/root/projects/drift/drift-v${VERSION}.tar.gz" "drift-v${VERSION}/"

# Create zip
cd /root/projects/drift
python3 -c "
import zipfile, os
version = '${VERSION}'
project = '/root/projects/drift'
zip_path = f'{project}/drift-v{version}.zip'
exclude_dirs = {'node_modules', '.git', 'dist', 'scripts', '.hermes'}
exclude_files = {f'drift-v{version}.tar.gz', f'drift-v{version}.zip'}
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(project):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for f in files:
            if f in exclude_files or f.endswith('.plan'):
                continue
            filepath = os.path.join(root, f)
            arcname = os.path.join(f'drift-v{version}', os.path.relpath(filepath, project))
            zf.write(filepath, arcname)
    dist_dir = os.path.join(project, 'dist')
    for root, dirs, files in os.walk(dist_dir):
        for f in files:
            filepath = os.path.join(root, f)
            arcname = os.path.join(f'drift-v{version}', 'dist', os.path.relpath(filepath, dist_dir))
            zf.write(filepath, arcname)
"

# Cleanup staging
rm -rf "$STAGING"

echo "✅ Release archives created:"
ls -lh "drift-v${VERSION}.tar.gz" "drift-v${VERSION}.zip"
echo ""
echo "Next steps:"
echo "  1. git add -A && git commit -m 'release: v${VERSION}'"
echo "  2. git tag -a v${VERSION} -m 'v${VERSION}'"
echo "  3. git push origin master --tags"
echo "  4. Create GitHub release and upload archives"
