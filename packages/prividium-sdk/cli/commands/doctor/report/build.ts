import type {
    DoctorContext,
    DoctorReport,
    DoctorStageDefinition,
    ProbeResult,
    ReportBlock,
    ReportStatus
} from '../types.js';

function buildReportStatus(results: ProbeResult[]): ReportStatus {
    if (results.some((result) => result.status === 'fail')) {
        return 'fail';
    }

    if (results.some((result) => result.status === 'warn')) {
        return 'warn';
    }

    if (results.some((result) => result.status === 'pass')) {
        return 'pass';
    }

    return 'skip';
}

function buildSummaryBlock(context: DoctorContext): ReportBlock {
    const failCount = context.results.filter(({ status }) => status === 'fail').length;
    const skipCount = context.results.filter(({ status }) => status === 'skip').length;
    const passCount = context.results.filter(({ status }) => status === 'pass').length;

    return {
        type: 'values',
        id: 'summary',
        title: 'Summary',
        values: [
            { label: 'Status', value: `${failCount} failed, ${skipCount} skipped, ${passCount} passed` },
            { label: 'API', value: context.targets?.apiBaseUrl ?? context.rawRpcUrl },
            ...(context.apiVersion ? [{ label: 'API Version', value: context.apiVersion }] : []),
            ...(context.targets?.userPanelBaseUrl
                ? [{ label: 'User Panel', value: context.targets.userPanelBaseUrl }]
                : []),
            { label: 'Time', value: new Date().toISOString() }
        ]
    };
}

function buildUserContextBlock(context: DoctorContext): ReportBlock | undefined {
    if (!context.reportContext) {
        return undefined;
    }

    return {
        type: 'values',
        id: 'user-context',
        title: 'User Context',
        values: [
            { label: 'Session type', value: context.reportContext.sessionType },
            {
                label: 'User',
                value: `${context.reportContext.userDisplayName} (${context.reportContext.userId})`
            },
            {
                label: 'Roles',
                value: context.reportContext.roles.length > 0 ? context.reportContext.roles.join(', ') : 'none'
            },
            { label: 'Auth expires', value: context.reportContext.authExpiresAt }
        ]
    };
}

function buildSectionBlocks(results: ProbeResult[], stageTitles: Map<string, string>): ReportBlock[] {
    const sectionOrder: string[] = [];
    const sectionMap = new Map<string, Extract<ReportBlock, { type: 'section' }>>();

    for (const result of results) {
        if (!sectionMap.has(result.section)) {
            sectionOrder.push(result.section);
            sectionMap.set(result.section, {
                type: 'section',
                id: result.section,
                title: stageTitles.get(result.section) ?? result.section,
                probes: []
            });
        }
        sectionMap.get(result.section)!.probes.push(result);
    }

    return sectionOrder.map((id) => sectionMap.get(id)!);
}

export function buildDoctorReport(context: DoctorContext, stages: DoctorStageDefinition[]): DoctorReport {
    const stageTitles = new Map(stages.map((s) => [s.id, s.title]));
    const blocks: ReportBlock[] = [buildSummaryBlock(context), ...buildSectionBlocks(context.results, stageTitles)];
    const userContextBlock = buildUserContextBlock(context);
    if (userContextBlock) {
        blocks.push(userContextBlock);
    }

    return {
        status: buildReportStatus(context.results),
        blocks
    };
}
