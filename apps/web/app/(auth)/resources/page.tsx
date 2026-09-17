import { redirectInSpace } from '@/lib/spaces/spaceRedirect';
import { RESOURCES_HREF } from '@/lib/directory/views';

// The old tool URL keeps answering for bookmarks and the rail rows of spaces
// that had it placed; a file's own page stays at /resources/<id>.
export default async function ResourcesPage() {
  await redirectInSpace(RESOURCES_HREF);
}
