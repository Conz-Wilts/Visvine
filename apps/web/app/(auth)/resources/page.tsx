import { redirect } from 'next/navigation';

// Resources is a tab of the Directory now (Grid · Context · Resources). The old
// tool URL keeps answering for bookmarks and the rail rows of spaces that had
// it placed; a file's own page stays at /resources/<id>.
export default function ResourcesPage() {
  redirect('/directory?view=resources');
}
