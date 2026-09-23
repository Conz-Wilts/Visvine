import { PageError } from '@visvine/ui';

/** A URL that matches nothing. One line — there is nothing to retry. */
export default function NotFound() {
  return <PageError message="This page doesn't exist." />;
}
