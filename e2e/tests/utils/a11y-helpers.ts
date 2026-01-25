import type { AxeResults, Result } from 'axe-core';

/**
 * Creates a readable summary of accessibility violations for test output.
 */
export function formatViolations(results: AxeResults): string {
  if (results.violations.length === 0) {
    return 'No accessibility violations found.';
  }

  const lines: string[] = [
    `Found ${results.violations.length} accessibility violation(s):`,
    '',
  ];

  results.violations.forEach((violation, index) => {
    lines.push(`${index + 1}. ${violation.id} (${violation.impact})`);
    lines.push(`   ${violation.help}`);
    lines.push(`   WCAG: ${violation.tags.filter(t => t.startsWith('wcag')).join(', ')}`);
    lines.push(`   Help: ${violation.helpUrl}`);
    lines.push(`   Elements affected:`);

    violation.nodes.forEach((node) => {
      lines.push(`     - ${node.target.join(' > ')}`);
      if (node.failureSummary) {
        const summary = node.failureSummary.split('\n')[1]?.trim() || node.failureSummary;
        lines.push(`       ${summary}`);
      }
    });
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Creates a fingerprint of violations for snapshot testing.
 * Only includes rule ID and targets, not implementation details that change frequently.
 */
export function violationFingerprints(results: AxeResults): string {
  const fingerprints = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target),
  }));

  return JSON.stringify(fingerprints, null, 2);
}

/**
 * Summarizes violation counts by rule for quick overview.
 */
export function violationSummary(results: AxeResults): Record<string, number> {
  const summary: Record<string, number> = {};

  results.violations.forEach((violation) => {
    summary[violation.id] = (summary[violation.id] || 0) + violation.nodes.length;
  });

  return summary;
}
