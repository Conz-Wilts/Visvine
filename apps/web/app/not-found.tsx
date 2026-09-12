import PageError from '@/components/ui/PageError';

/** A URL that matches nothing. One line — there is nothing to retry. */
export default function NotFound() {
  return <PageError message="This page doesn't exist." />;
}
