import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { EmptyState } from '../../components/ui/feedback';
import { GlassCard, PageHeader } from '../../components/ui/display';
import type { PageHeaderProps } from '../../components/ui/display';
import type { IconProps } from '../../components/ui/icons';

export const APP_NAME = 'AutoPW3';

/** Sets the document title for the page, so each route has a distinct tab and history title. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} - ${APP_NAME}`;
  }, [title]);
}

/** Standard page frame: document title, page heading (focus target after navigation), then the content grid. */
export function Page({ children, ...header }: PageHeaderProps & { children: ReactNode }) {
  useDocumentTitle(header.title);
  return (
    <>
      <PageHeader {...header} />
      <div className="grid gap-4">{children}</div>
    </>
  );
}

/** Placeholder for a feature a later task builds. It says which task, so nobody mistakes it for a bug. */
export function PlannedFeature({
  title,
  task,
  description,
  icon,
  headingLevel = 2,
}: {
  title: string;
  task: string;
  description: string;
  icon?: (props: IconProps) => ReactNode;
  headingLevel?: 2 | 3;
}) {
  return (
    <GlassCard title={title} headingLevel={headingLevel}>
      <EmptyState
        title={`Built in TASK-${task}`}
        description={description}
        {...(icon !== undefined ? { icon } : {})}
      />
    </GlassCard>
  );
}
