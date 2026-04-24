## Editorial preferences

All UI text and quiz content must use:
- British English
- Single quotes (not double)
- Em dashes with spaces ( — )
- No Oxford comma
- Italicised story/book titles where they appear

## Branding

Match existing admin pages styling:
- Dark background `#0a0a0a`
- Purple accent `#6b2fad`
- Gold accent `#c9a44c`
- Cream text `#f0ead8`
- Serif headings (Georgia)
- Inter for UI labels

## Out of scope for Phase 1

- User-facing quiz flow
- Cinematic animation
- Points wiring
- Quiz analytics

These come in Phase 2 and 3. Do not stub or build placeholder versions.

## Testing checklist

Before considering Phase 1 complete:
- [ ] `/admin/quizzes` page loads, gated by admin UID
- [ ] Story dropdown lists both hardcoded and CMS stories
- [ ] "Generate Quiz" calls `/api/generate-quiz` and returns valid JSON
- [ ] All fields are editable inline
- [ ] "Regenerate" replaces the current draft
- [ ] "Save as draft" persists to Firebase without `approvedAt`
- [ ] "Approve & publish" persists with `approvedAt`
- [ ] Existing quiz can be re-opened and edited
- [ ] localStorage persists work-in-progress through browser refresh