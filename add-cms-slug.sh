#!/bin/bash
SLUG=$1
if [ -z "$SLUG" ]; then
  echo "Usage: ./add-cms-slug.sh your-story-slug"
  exit 1
fi
FILE="calvary-scribblings-next/app/lib/cms-slugs.json"
node -e "
const fs = require('fs');
const slugs = JSON.parse(fs.readFileSync('$FILE', 'utf8'));
if (!slugs.includes('$SLUG')) {
  slugs.push('$SLUG');
  fs.writeFileSync('$FILE', JSON.stringify(slugs, null, 2));
  console.log('Added: $SLUG');
} else {
  console.log('Already exists: $SLUG');
}
"
git add $FILE
git commit -m "Add CMS slug: $SLUG"
git push origin main
