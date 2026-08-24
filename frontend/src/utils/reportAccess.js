import { isReportsChildVisible, reportsMenuItems } from '../config/menuConfig';

/** Granular report sections (one sidebar item each — not the umbrella reports_access). */
export const GRANULAR_REPORT_SECTIONS = reportsMenuItems
  .map((item) => item.section)
  .filter((section) => section?.startsWith('report_'));

export function reportSectionForPath(pathname) {
  if (!pathname) return null;
  const item = reportsMenuItems.find((child) => pathname.startsWith(child.path));
  return item?.section || null;
}

/** Can the user open this /reports/* path? */
export function canViewReportPath(pathname, canView) {
  const section = reportSectionForPath(pathname);

  if (section === 'production_qc_report') {
    return canView('production_qc_report') || canView('qc_management');
  }

  if (section) return canView(section);

  return reportsMenuItems.some((child) => isReportsChildVisible(child, canView));
}

/** First sidebar report this user may open (for /reports index redirect). */
export function firstAccessibleReportPath(canView, userRole = null) {
  const visible = reportsMenuItems.filter((child) => isReportsChildVisible(child, canView, userRole));
  return visible[0]?.path || null;
}

export function hasAnyGranularReportAccess(canView) {
  return GRANULAR_REPORT_SECTIONS.some((section) => canView(section))
    || canView('analytics_dashboard')
    || canView('production_qc_report')
    || canView('qc_management');
}
