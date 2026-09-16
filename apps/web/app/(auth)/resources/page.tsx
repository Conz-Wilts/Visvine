import { redirectInSpace } from '@/lib/spaces/spaceRedirect';

// Resources is a tab of the Directory now (Grid · Context · Resources). The old
// tool URL keeps answering for bookmarks and the rail rows of spaces that had
// it placed; a file's own page stays at /resources/<id>.
export default async function ResourcesPage() {
  await redirectInSpace('/directory?view=resources');
}
